import { Router, Request, Response } from 'express';
import { supabase, getSettings } from '../db/supabase';
import { evaluateRulesForUpload } from '../services/ruleEngine';
import { calculateLOP } from '../services/lopService';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('attendance_rules')
    .select('*')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.post('/', async (req: Request, res: Response) => {
  const { name, description, ruleType, conditions, actions, priority } = req.body;
  const { data, error } = await supabase
    .from('attendance_rules')
    .insert({ name, description, rule_type: ruleType, conditions, actions, priority: priority || 0 })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

router.put('/:id', async (req: Request, res: Response) => {
  const { name, description, ruleType, conditions, actions, isActive, priority } = req.body;
  const { data, error } = await supabase
    .from('attendance_rules')
    .update({ name, description, rule_type: ruleType, conditions, actions, is_active: isActive, priority })
    .eq('id', parseInt(req.params.id))
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const { error } = await supabase.from('attendance_rules').delete().eq('id', parseInt(req.params.id));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.patch('/:id/toggle', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { data: rule, error: fErr } = await supabase.from('attendance_rules').select('is_active').eq('id', id).single();
  if (fErr || !rule) { res.status(404).json({ error: 'Not found' }); return; }
  const { data: updated, error } = await supabase
    .from('attendance_rules')
    .update({ is_active: !rule.is_active })
    .eq('id', id)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(updated);
});

const ESCALATION_MAP: Record<string, 'initial' | 'reminder' | 'escalation'> = {
  initial: 'reminder',
  reminder: 'escalation',
  escalation: 'escalation',
};

function timeToMinutes(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value > 0 && value < 1) return Math.round(value * 24 * 60);
    if (value >= 1 && value < 100000) {
      const whole = Math.floor(value);
      const frac = value - whole;
      const h = whole < 24 ? whole : Math.floor(whole / 100);
      const m = whole < 24 ? Math.round(frac * 60) : whole % 100;
      return h * 60 + m;
    }
  }
  const str = String(value).trim();
  const m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[4]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return h * 60 + min;
  }
  if (/^\d{3,4}$/.test(str)) {
    const n = parseInt(str, 10);
    const h = Math.floor(n / 100);
    const min = n % 100;
    if (h < 24 && min < 60) return h * 60 + min;
  }
  return null;
}

router.post('/evaluate/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const autoCreateDrafts = req.body.autoCreateDrafts !== false;

  const [settings, { data: upload }] = await Promise.all([
    getSettings(),
    supabase.from('attendance_uploads').select('*').eq('id', uploadId).single(),
  ]);

  if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

  const periodMonth = upload.period_month;
  const workingDays = parseFloat(settings['working_days'] || '26');
  const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');
  const halfDayHours = parseFloat(settings['half_day_hours'] || '4');

  const [y, m] = periodMonth.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const { data: records } = await supabase.from('attendance_records').select('*').eq('upload_id', uploadId).order('record_date', { ascending: true });
  const allRecords = (records || []) as any[];

  const employeeIds = [...new Set(allRecords.map((r) => r.employee_id))];
  const [{ data: employees }, { data: salaries }] = await Promise.all([
    supabase.from('employees').select('*').in('id', employeeIds),
    supabase.from('salary_configs').select('*').in('employee_id', employeeIds),
  ]);

  const latestSalary: Record<number, any> = {};
  for (const s of (salaries || []) as any[]) {
    const cur = latestSalary[s.employee_id];
    if (!cur || (s.effective_month || '') > (cur.effective_month || '')) latestSalary[s.employee_id] = s;
  }

  const summaries = (employees || []).map((emp: any) => {
    let absentDays = 0, missedSwipeDays = 0, lateComingDays = 0, earlyLeavingDays = 0, halfDays = 0, overtimeDays = 0, overtimeHours = 0;
    for (const r of allRecords) {
      if (r.employee_id !== emp.id) continue;
      const inMin = timeToMinutes(r.time_in);
      const outMin = timeToMinutes(r.time_out);
      const shiftEndMin = timeToMinutes(emp.shift_end_time) ?? 1080;
      const workingHours = inMin != null && outMin != null && outMin >= inMin ? (outMin - inMin) / 60 : 0;
      const overtimeMinutes = emp.overtime_eligible === true && shiftEndMin != null && outMin != null ? outMin - shiftEndMin : 0;
      const dayOvertime = overtimeMinutes > 120 ? overtimeMinutes / 60 : 0;
      if (r.status === 'Absent') absentDays++;
      else if (r.status === 'Missed Swipe') missedSwipeDays++;
      else if (r.status === 'Half Day' || r.status === 'Half' || (workingHours > 0 && workingHours < halfDayHours)) halfDays++;
      else if (r.status === 'Late Coming') lateComingDays++;
      else if (r.status === 'Early Leaving') earlyLeavingDays++;
      if (dayOvertime > 0) {
        overtimeDays++;
        overtimeHours += dayOvertime;
      }
    }
    const flaggedTotal = absentDays + missedSwipeDays + lateComingDays + earlyLeavingDays + halfDays;
    const salary = latestSalary[emp.id];
    const { lopDays } = salary ? calculateLOP(salary.basic_salary, absentDays, missedSwipeDays, workingDays, missedSwipeWeight) : { lopDays: 0 };
    return { employeeId: emp.id, employeeName: emp.name, employeeEmail: emp.email, shift: emp.shift || null, absentDays, missedSwipeDays, lateComingDays, earlyLeavingDays, halfDays, overtimeDays, overtimeHours: Math.round(overtimeHours * 10) / 10, flaggedTotal, lopDays };
  });

  const matches = await evaluateRulesForUpload(uploadId, summaries);

  let draftsCreated = 0;
  if (autoCreateDrafts && matches.length > 0) {
    const { data: tplRows } = await supabase.from('email_templates').select('*');
    const templates = Object.fromEntries((tplRows || []).map((t: any) => [t.type, t]));

    const matchedIds = matches.map((m) => m.employeeId);
    const { data: prevHistory } = await supabase
      .from('email_history')
      .select('employee_id')
      .in('employee_id', matchedIds)
      .eq('status', 'sent')
      .gte('sent_at', new Date(`${prevMonth}-01`).toISOString())
      .lt('sent_at', new Date(`${periodMonth}-01`).toISOString());
    const hadPreviousEmail = new Set((prevHistory || []).map((h: any) => h.employee_id));

    for (const match of matches) {
      const emp = (employees || []).find((e: any) => e.id === match.employeeId)!;
      const summary = summaries.find((s: any) => s.employeeId === match.employeeId)!;

      const wasEscalated = hadPreviousEmail.has(match.employeeId);
      const templateKey = wasEscalated ? ESCALATION_MAP[match.recommendedTemplate] : match.recommendedTemplate;
      const tpl = templates[templateKey] || templates['initial'];
      if (!tpl) continue;

      const empRecords = allRecords.filter((r) => r.employee_id === emp.id &&
        ['Absent', 'Missed Swipe', 'Late Coming', 'Early Leaving'].includes(r.status));
      const dateTable = empRecords.map((r) => `  ${String(r.record_date).substring(0, 10)}  |  ${r.status}`).join('\n');

      const ruleFlags = match.flags.awol ? '\n⚠ AWOL NOTICE: This constitutes Absence Without Official Leave.' : '';
      const disciplinary = match.flags.disciplinaryRisk ? '\n⚠ DISCIPLINARY RISK: This case has been flagged for potential disciplinary action.' : '';
      const managerCC = match.flags.notifyManager ? '\n(HR Manager has been notified)' : '';
      const directorCC = match.flags.notifyHRDirector ? '\n(HR Director has been notified)' : '';
      const escalationNote = wasEscalated
        ? '\n⚠ NOTE: A previous notice was sent last month. This is an escalated reminder as the matter remains unresolved.\n'
        : '';

      const rulesTriggered = match.triggeredRules.map((r) => `• ${r.name}`).join('\n');

      const body = `Dear ${emp.name},

This notice is issued in accordance with Dubai Government Human Resources Policy and UAE Federal Civil Service Law No. 11 of 2008.
${escalationNote}
Our records indicate the following attendance issues for the period ${periodMonth}:

Date         | Status
-------------|------------------
${dateTable}

Summary: Absent ${summary.absentDays}d | Missed Biometric ${summary.missedSwipeDays}x | Late Arrival ${summary.lateComingDays}x | Early Departure ${summary.earlyLeavingDays}x | Half Day ${summary.halfDays}x | Overtime ${summary.overtimeHours}h

Policy Rules Triggered:
${rulesTriggered}
${ruleFlags}${disciplinary}

You are requested to:
1. Provide written justification within 3 working days
2. Submit supporting documentation (medical certificate, leave application, etc.)
3. Ensure regularization of attendance going forward

Failure to respond or repeat occurrences will result in escalated action including salary deduction and/or formal disciplinary proceedings.
${managerCC}${directorCC}

This communication is generated automatically by HRPulse in compliance with Dubai Government HR Policy.

Regards,
${settings['hr_name'] || 'HR Department'}
${settings['company_name'] || ''}`;

      const subjectStr = tpl.subject
        .replace('{{flagged_count}}', String(summary.flaggedTotal))
        .replace('{{period_month}}', periodMonth);

      await supabase.from('email_drafts').upsert(
        { upload_id: uploadId, employee_id: emp.id, subject: subjectStr, body, template_type: templateKey, is_edited: false },
        { onConflict: 'upload_id,employee_id' }
      );
      draftsCreated++;
    }
  }

  res.json({ matches, draftsCreated, employeesEvaluated: summaries.length });
});

export default router;
