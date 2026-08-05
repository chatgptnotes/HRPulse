import { Router, Request, Response } from 'express';
import { supabase, getSettings } from '../db/supabase';
import { generateEmailDraft } from '../services/ollamaService';
import { sendEmail } from '../services/emailService';
import { calculateLOP } from '../services/lopService';
import { format, subMonths, parseISO } from 'date-fns';

const router = Router();

const NON_FLAG_STATUSES = ['Normal', 'Weekend', 'Holiday'];

router.post('/generate/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const settings = await getSettings();
    const workingDays = parseFloat(settings['working_days'] || '30');
    const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

    const { data: uploadRow } = await supabase.from('attendance_uploads').select('*').eq('id', uploadId).single();
    if (!uploadRow) { send({ error: 'Upload not found' }); res.end(); return; }

    const periodMonth = uploadRow.period_month;
    const prevMonth = format(subMonths(parseISO(`${periodMonth}-01`), 1), 'yyyy-MM');

    const { data: templates } = await supabase.from('email_templates').select('*').in('type', ['initial', 'reminder']);
    const tplMap = Object.fromEntries((templates || []).map((t: any) => [t.type, t]));
    const initialTemplate = tplMap['initial'];
    const reminderTemplate = tplMap['reminder'];

    const { data: flaggedEmployeeIds } = await supabase
      .from('attendance_records')
      .select('employee_id')
      .eq('upload_id', uploadId)
      .neq('status', 'Normal')
      .neq('status', 'Weekend')
      .neq('status', 'Holiday');
    const employeeIds = [...new Set((flaggedEmployeeIds || []).map((r: any) => r.employee_id))];

    const { data: employees } = await supabase.from('employees').select('*').in('id', employeeIds);
    const empList = (employees || []) as any[];

    const total = empList.length;
    send({ type: 'start', total });

    for (let i = 0; i < empList.length; i++) {
      const emp = empList[i];
      send({ type: 'progress', completed: i, total, currentEmployee: emp.name });

      const { data: records } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('upload_id', uploadId)
        .eq('employee_id', emp.id)
        .neq('status', 'Normal')
        .neq('status', 'Weekend')
        .neq('status', 'Holiday')
        .order('record_date', { ascending: true });
      const empRecords = (records || []) as any[];

      if (empRecords.length === 0) continue;

      const { data: prevRows } = await supabase
        .from('email_history')
        .select('id')
        .eq('employee_id', emp.id)
        .eq('status', 'sent')
        .gte('sent_at', new Date(`${prevMonth}-01`).toISOString())
        .lt('sent_at', new Date(`${periodMonth}-01`).toISOString())
        .limit(1);
      const prevSent = (prevRows || [])[0];

      const templateType = prevSent ? 'reminder' : 'initial';
      const template = (templateType === 'reminder' ? reminderTemplate : initialTemplate)!;

      const { data: salaryRows } = await supabase
        .from('salary_configs')
        .select('*')
        .eq('employee_id', emp.id)
        .order('effective_month', { ascending: false })
        .limit(1);
      const salary = (salaryRows || [])[0];
      const absentDays = empRecords.filter((r) => r.status === 'Absent').length;
      const missedSwipeDays = empRecords.filter((r) => r.status === 'Missed Swipe').length;
      const { lopAmount } = salary ? calculateLOP(salary.basic_salary, absentDays, missedSwipeDays, workingDays, missedSwipeWeight) : { lopAmount: 0 };

      try {
        const { subject, body } = await generateEmailDraft(
          emp.name, emp.email, periodMonth,
          empRecords.map((r) => ({ recordDate: r.record_date, status: r.status })),
          template.subject, template.body, lopAmount
        );

        await supabase.from('email_drafts').upsert(
          { upload_id: uploadId, employee_id: emp.id, template_type: templateType, subject, body, is_edited: false, status: 'pending' },
          { onConflict: 'upload_id,employee_id' }
        );
      } catch (genErr) {
        console.error(`Error generating draft for ${emp.name}:`, genErr);
        await supabase.from('email_drafts').upsert(
          { upload_id: uploadId, employee_id: emp.id, subject: `Attendance Alert - ${emp.name}`, body: '' },
          { onConflict: 'upload_id,employee_id' }
        );
      }
    }

    send({ type: 'done', total });
    res.end();
  } catch (err) {
    send({ type: 'error', error: String(err) });
    res.end();
  }
});

router.get('/drafts/:uploadId', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('email_drafts')
    .select('*, employee:employees(*)')
    .eq('upload_id', parseInt(req.params.uploadId));
  if (error) { res.status(500).json({ error: error.message }); return; }
  const mapped = (data || []).map((d: any) => ({
    id: d.id, uploadId: d.upload_id, employeeId: d.employee_id,
    employeeName: d.employee?.name, employeeEmail: d.employee?.email,
    templateType: d.template_type, subject: d.subject, body: d.body,
    isEdited: d.is_edited, status: d.status, sentAt: d.sent_at, errorMessage: d.error_message, createdAt: d.created_at,
  }));
  mapped.sort((a: any, b: any) => {
    if (a.status !== b.status) return (a.status || '').localeCompare(b.status || '');
    return (a.employeeName || '').localeCompare(b.employeeName || '');
  });
  res.json(mapped);
});

router.patch('/drafts/:draftId', async (req: Request, res: Response) => {
  const { subject, body } = req.body;
  const { error } = await supabase
    .from('email_drafts')
    .update({ subject, body, is_edited: true })
    .eq('id', parseInt(req.params.draftId));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.post('/send/:draftId', async (req: Request, res: Response) => {
  const { data: draft, error } = await supabase
    .from('email_drafts')
    .select('*, employee:employees(*)')
    .eq('id', parseInt(req.params.draftId))
    .single();
  if (error || !draft) { res.status(404).json({ error: 'Draft not found' }); return; }

  try {
    await sendEmail(draft.employee.email, draft.subject, draft.body);
    const now = new Date();
    await supabase.from('email_drafts').update({ status: 'sent', sent_at: now.toISOString(), error_message: null }).eq('id', draft.id);
    await supabase.from('email_history').insert({
      employee_id: draft.employee_id, upload_id: draft.upload_id, subject: draft.subject, body: draft.body, sent_at: now.toISOString(), status: 'sent',
    });
    res.json({ ok: true, sentAt: now });
  } catch (err) {
    const msg = String(err);
    await supabase.from('email_drafts').update({ status: 'failed', error_message: msg }).eq('id', draft.id);
    res.status(500).json({ error: msg });
  }
});

router.post('/send-bulk', async (req: Request, res: Response) => {
  const { draftIds } = req.body as { draftIds: number[] };
  const results: Array<{ draftId: number; ok: boolean; error?: string }> = [];

  for (const draftId of draftIds) {
    const { data: draft } = await supabase
      .from('email_drafts')
      .select('*, employee:employees(*)')
      .eq('id', draftId)
      .single();
    if (!draft) { results.push({ draftId, ok: false, error: 'Not found' }); continue; }

    try {
      await sendEmail(draft.employee.email, draft.subject, draft.body);
      const now = new Date();
      await supabase.from('email_drafts').update({ status: 'sent', sent_at: now.toISOString(), error_message: null }).eq('id', draftId);
      await supabase.from('email_history').insert({
        employee_id: draft.employee_id, upload_id: draft.upload_id, subject: draft.subject, body: draft.body, sent_at: now.toISOString(), status: 'sent',
      });
      results.push({ draftId, ok: true });
    } catch (err) {
      const msg = String(err);
      await supabase.from('email_drafts').update({ status: 'failed', error_message: msg }).eq('id', draftId);
      results.push({ draftId, ok: false, error: msg });
    }
  }

  res.json({ results });
});

router.post('/remind-pending', async (_req: Request, res: Response) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const { data: reminderTpl } = await supabase.from('email_templates').select('*').eq('type', 'reminder').single();
  if (!reminderTpl) { res.json({ created: 0, checked: 0 }); return; }

  const settings = await getSettings();

  const { data: oldSentRows } = await supabase
    .from('email_history')
    .select('*, employee:employees(*)')
    .eq('status', 'sent')
    .gte('sent_at', thirtyDaysAgo.toISOString())
    .lte('sent_at', sevenDaysAgo.toISOString())
    .order('sent_at', { ascending: false });
  const oldSent = oldSentRows || [];

  const deduped = new Map<number, any>();
  for (const h of oldSent as any[]) {
    if (!deduped.has(h.employee_id)) deduped.set(h.employee_id, h);
  }

  let created = 0;
  for (const hist of deduped.values()) {
    const { data: followUp } = await supabase
      .from('email_history')
      .select('id')
      .eq('employee_id', hist.employee_id)
      .gt('sent_at', hist.sent_at)
      .limit(1);
    if ((followUp || [])[0]) continue;

    const { data: existingDraft } = await supabase
      .from('email_drafts')
      .select('id')
      .eq('employee_id', hist.employee_id)
      .eq('status', 'pending')
      .eq('template_type', 'reminder')
      .limit(1);
    if ((existingDraft || [])[0]) continue;

    const { data: latestRecord } = await supabase
      .from('attendance_records')
      .select('id')
      .eq('employee_id', hist.employee_id)
      .eq('upload_id', hist.upload_id)
      .limit(1);
    if (!(latestRecord || [])[0]) continue;

    const sentDate = new Date(hist.sent_at);
    const periodLabel = sentDate.toLocaleDateString('en-AE', { month: 'long', year: 'numeric' });
    const subject = reminderTpl.subject
      .replace('{{period_month}}', periodLabel)
      .replace('{{flagged_count}}', '');

    const body = `Dear ${hist.employee.name},

This is a formal reminder regarding the attendance notice sent to you on ${sentDate.toLocaleDateString('en-AE', { day: 'numeric', month: 'long', year: 'numeric' })}.

As of today, we have not received any leave application, written justification, or supporting documentation from you in response to that notice.

Original notice summary:
---
${hist.body.split('\n').slice(0, 20).join('\n')}
---

You are hereby requested to respond within 3 working days. Continued non-compliance will result in formal disciplinary action as per Dubai Government HR Policy and UAE Federal Civil Service Law No. 11 of 2008.

Regards,
${settings['hr_name'] || 'HR Department'}
${settings['company_name'] || ''}`;

    await supabase.from('email_drafts').insert({
      upload_id: hist.upload_id,
      employee_id: hist.employee_id,
      subject,
      body,
      template_type: 'reminder',
      status: 'pending',
    });
    created++;
  }

  res.json({ created, checked: deduped.size });
});

router.get('/history', async (req: Request, res: Response) => {
  const { month, employeeId } = req.query;
  let query = supabase.from('email_history').select('*, employee:employees(*)');
  if (month) {
    const [y, m] = (month as string).split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    query = query.gte('sent_at', start.toISOString()).lt('sent_at', end.toISOString());
  }
  if (employeeId) query = query.eq('employee_id', parseInt(employeeId as string));

  const { data, error } = await query.order('sent_at', { ascending: false }).limit(500);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data || []).map((h: any) => ({
    id: h.id, employeeId: h.employee_id, employeeName: h.employee?.name, employeeEmail: h.employee?.email,
    uploadId: h.upload_id, subject: h.subject, body: h.body, sentAt: h.sent_at, status: h.status, errorMessage: h.error_message,
  })));
});

export default router;
