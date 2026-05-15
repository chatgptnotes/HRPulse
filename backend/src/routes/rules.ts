import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { evaluateRulesForUpload } from '../services/ruleEngine';
import { calculateLOP } from '../services/lopService';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  res.json(await prisma.attendanceRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] }));
});

router.post('/', async (req: Request, res: Response) => {
  const { name, description, ruleType, conditions, actions, priority } = req.body;
  const rule = await prisma.attendanceRule.create({ data: { name, description, ruleType, conditions, actions, priority: priority || 0 } });
  res.status(201).json(rule);
});

router.put('/:id', async (req: Request, res: Response) => {
  const { name, description, ruleType, conditions, actions, isActive, priority } = req.body;
  const rule = await prisma.attendanceRule.update({
    where: { id: parseInt(req.params.id) },
    data: { name, description, ruleType, conditions, actions, isActive, priority },
  });
  res.json(rule);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.attendanceRule.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ ok: true });
});

router.patch('/:id/toggle', async (req: Request, res: Response) => {
  const rule = await prisma.attendanceRule.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!rule) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(await prisma.attendanceRule.update({ where: { id: rule.id }, data: { isActive: !rule.isActive } }));
});

// Template to use when previous month had an unresolved email
const ESCALATION_MAP: Record<string, 'initial' | 'reminder' | 'escalation'> = {
  initial: 'reminder',
  reminder: 'escalation',
  escalation: 'escalation',
};

// POST /api/rules/evaluate/:uploadId
// Evaluates all active rules against an upload's attendance data.
// Returns rule matches per employee AND auto-creates email drafts based on the highest triggered severity.
// Includes: specific dates in email body, cross-month escalation, Dubai policy citations.
router.post('/evaluate/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const autoCreateDrafts = req.body.autoCreateDrafts !== false;

  const [settings, upload] = await Promise.all([
    prisma.setting.findMany().then(rows => Object.fromEntries(rows.map(r => [r.key, r.value]))),
    prisma.attendanceUpload.findUnique({ where: { id: uploadId } }),
  ]);

  if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

  const periodMonth = upload.periodMonth;
  const workingDays = parseFloat(settings['working_days'] || '26');
  const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

  // Compute previous month string (yyyy-MM)
  const [y, m] = periodMonth.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const employees = await prisma.employee.findMany({
    where: { attendanceRecords: { some: { uploadId } } },
    include: {
      attendanceRecords: { where: { uploadId }, orderBy: { recordDate: 'asc' } },
      salaryConfigs: { orderBy: { effectiveMonth: 'desc' }, take: 1 },
    },
  });

  const summaries = employees.map(emp => {
    let absentDays = 0, missedSwipeDays = 0, lateComingDays = 0, earlyLeavingDays = 0;
    for (const r of emp.attendanceRecords) {
      if (r.status === 'Absent') absentDays++;
      else if (r.status === 'Missed Swipe') missedSwipeDays++;
      else if (r.status === 'Late Coming') lateComingDays++;
      else if (r.status === 'Early Leaving') earlyLeavingDays++;
    }
    const flaggedTotal = absentDays + missedSwipeDays + lateComingDays + earlyLeavingDays;
    const salary = emp.salaryConfigs[0];
    const { lopDays } = salary
      ? calculateLOP(salary.basicSalary, absentDays, missedSwipeDays, workingDays, missedSwipeWeight)
      : { lopDays: 0 };
    return { employeeId: emp.id, employeeName: emp.name, employeeEmail: emp.email, absentDays, missedSwipeDays, lateComingDays, earlyLeavingDays, flaggedTotal, lopDays };
  });

  const matches = await evaluateRulesForUpload(uploadId, summaries);

  let draftsCreated = 0;
  if (autoCreateDrafts) {
    const templates = Object.fromEntries(
      (await prisma.emailTemplate.findMany()).map(t => [t.type, t])
    );

    // Check email history for all matched employees in one query (for cross-month escalation)
    const employeeIds = matches.map(match => match.employeeId);
    const prevHistory = await prisma.emailHistory.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'sent',
        sentAt: { gte: new Date(`${prevMonth}-01`), lt: new Date(`${periodMonth}-01`) },
      },
      select: { employeeId: true },
    });
    const hadPreviousEmail = new Set(prevHistory.map(h => h.employeeId));

    for (const match of matches) {
      const emp = employees.find(e => e.id === match.employeeId)!;
      const summary = summaries.find(s => s.employeeId === match.employeeId)!;

      // Escalate template if employee had an unresolved email last month
      const wasEscalated = hadPreviousEmail.has(match.employeeId);
      const templateKey = wasEscalated ? ESCALATION_MAP[match.recommendedTemplate] : match.recommendedTemplate;
      const tpl = templates[templateKey] || templates['initial'];
      if (!tpl) continue;

      // Build date-by-date attendance table (specific dates, as requested)
      const flaggedRecords = emp.attendanceRecords.filter(r =>
        ['Absent', 'Missed Swipe', 'Late Coming', 'Early Leaving'].includes(r.status)
      );
      const dateTable = flaggedRecords
        .map(r => `  ${String(r.recordDate).substring(0, 10)}  |  ${r.status}`)
        .join('\n');

      const ruleFlags = match.flags.awol ? '\n⚠ AWOL NOTICE: This constitutes Absence Without Official Leave.' : '';
      const disciplinary = match.flags.disciplinaryRisk ? '\n⚠ DISCIPLINARY RISK: This case has been flagged for potential disciplinary action.' : '';
      const managerCC = match.flags.notifyManager ? '\n(HR Manager has been notified)' : '';
      const directorCC = match.flags.notifyHRDirector ? '\n(HR Director has been notified)' : '';
      const escalationNote = wasEscalated
        ? '\n⚠ NOTE: A previous notice was sent last month. This is an escalated reminder as the matter remains unresolved.\n'
        : '';

      const rulesTriggered = match.triggeredRules.map(r => `• ${r.name}`).join('\n');

      const body = `Dear ${emp.name},

This notice is issued in accordance with Dubai Government Human Resources Policy and UAE Federal Civil Service Law No. 11 of 2008.
${escalationNote}
Our records indicate the following attendance issues for the period ${periodMonth}:

Date         | Status
-------------|------------------
${dateTable}

Summary: Absent ${summary.absentDays}d | Missed Biometric ${summary.missedSwipeDays}x | Late Arrival ${summary.lateComingDays}x | Early Departure ${summary.earlyLeavingDays}x

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

      await prisma.emailDraft.upsert({
        where: { uploadId_employeeId: { uploadId, employeeId: emp.id } },
        update: { subject: subjectStr, body, templateType: templateKey, isEdited: false },
        create: { uploadId, employeeId: emp.id, subject: subjectStr, body, templateType: templateKey },
      });
      draftsCreated++;
    }
  }

  res.json({ matches, draftsCreated, employeesEvaluated: summaries.length });
});

export default router;
