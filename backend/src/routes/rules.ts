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

// POST /api/rules/evaluate/:uploadId
// Evaluates all active rules against an upload's attendance data.
// Returns rule matches per employee AND auto-creates email drafts based on the highest triggered severity.
router.post('/evaluate/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const autoCreateDrafts = req.body.autoCreateDrafts !== false;

  const settings = Object.fromEntries(
    (await prisma.setting.findMany()).map(r => [r.key, r.value])
  );
  const workingDays = parseFloat(settings['working_days'] || '26');
  const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

  // Build summaries from DB
  const employees = await prisma.employee.findMany({
    where: { attendanceRecords: { some: { uploadId } } },
    include: {
      attendanceRecords: { where: { uploadId } },
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
      : { lopDays: 0, lopAmount: 0 };
    return { employeeId: emp.id, employeeName: emp.name, employeeEmail: emp.email, absentDays, missedSwipeDays, lateComingDays, earlyLeavingDays, flaggedTotal, lopDays };
  });

  const matches = await evaluateRulesForUpload(uploadId, summaries);

  // Auto-create email drafts based on rule evaluation
  let draftsCreated = 0;
  if (autoCreateDrafts) {
    const templates = Object.fromEntries(
      (await prisma.emailTemplate.findMany()).map(t => [t.type, t])
    );

    for (const match of matches) {
      const tpl = templates[match.recommendedTemplate] || templates['initial'];
      if (!tpl) continue;

      const emp = employees.find(e => e.id === match.employeeId)!;
      const summary = summaries.find(s => s.employeeId === match.employeeId)!;

      const ruleFlags = match.flags.awol ? '\n⚠ AWOL NOTICE: This constitutes Absence Without Official Leave.' : '';
      const disciplinary = match.flags.disciplinaryRisk ? '\n⚠ DISCIPLINARY RISK: This case has been flagged for potential disciplinary action.' : '';
      const managerCC = match.flags.notifyManager ? '\n(HR Manager has been notified)' : '';
      const directorCC = match.flags.notifyHRDirector ? '\n(HR Director has been notified)' : '';

      const rulesTriggered = match.triggeredRules.map(r => `• ${r.name}`).join('\n');
      const flagsSummary = [
        summary.absentDays > 0 ? `Absent: ${summary.absentDays} day(s)` : '',
        summary.missedSwipeDays > 0 ? `Missed Biometric: ${summary.missedSwipeDays} time(s)` : '',
        summary.lateComingDays > 0 ? `Late Arrival: ${summary.lateComingDays} time(s)` : '',
        summary.earlyLeavingDays > 0 ? `Early Departure: ${summary.earlyLeavingDays} time(s)` : '',
      ].filter(Boolean).join('\n');

      const body = `Dear ${emp.name},

This notice is issued in accordance with Dubai Government Human Resources Policy and UAE Federal Civil Service Law No. 11 of 2008.

Our records indicate the following attendance issues for the period ${new Date().toLocaleDateString('en-AE', { month: 'long', year: 'numeric' })}:

${flagsSummary}

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

      await prisma.emailDraft.upsert({
        where: { uploadId_employeeId: { uploadId, employeeId: emp.id } },
        update: { subject: tpl.subject.replace('{{flagged_count}}', String(summary.flaggedTotal)).replace('{{period_month}}', new Date().toLocaleDateString('en-AE', { month: 'long', year: 'numeric' })), body, templateType: match.recommendedTemplate, isEdited: false },
        create: { uploadId, employeeId: emp.id, subject: tpl.subject.replace('{{flagged_count}}', String(summary.flaggedTotal)).replace('{{period_month}}', new Date().toLocaleDateString('en-AE', { month: 'long', year: 'numeric' })), body, templateType: match.recommendedTemplate },
      });
      draftsCreated++;
    }
  }

  res.json({ matches, draftsCreated, employeesEvaluated: summaries.length });
});

export default router;
