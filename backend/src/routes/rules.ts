import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { evaluateRulesForUpload } from '../services/ruleEngine';
import { computeDeductionsForUpload } from '../services/deductionService';
import { FLAGGED_STATUSES } from '../services/attendanceStatus';
import { toDateOnly } from '../utils/date';
import { generateRuleFromPolicy } from '../services/geminiService';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  res.json(await prisma.attendanceRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] }));
});

router.post('/generate', async (req: Request, res: Response) => {
  const policy = typeof req.body?.policy === 'string' ? req.body.policy.trim() : '';
  if (policy.length < 10 || policy.length > 5000) {
    res.status(400).json({ error: 'Describe the policy in 10 to 5000 characters' });
    return;
  }
  try {
    res.json(await generateRuleFromPolicy(policy));
  } catch (error) {
    console.error('Gemini rule generation failed:', error);
    const message = error instanceof Error ? error.message : 'Unable to generate rule';
    res.status(message.includes('not configured') ? 503 : 502).json({ error: message });
  }
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

  const [upload, deductions, settings] = await Promise.all([
    prisma.attendanceUpload.findUnique({ where: { id: uploadId } }),
    computeDeductionsForUpload(uploadId),
    prisma.setting.findMany().then(rows => Object.fromEntries(rows.map(r => [r.key, r.value]))),
  ]);

  if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

  const periodMonth = upload.periodMonth;

  // Compute previous month string (yyyy-MM)
  const [y, m] = periodMonth.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const deductionByEmployee = new Map(deductions.map(d => [d.employeeId, d]));
  const matches = deductions.map(d => d.ruleMatch).filter((m): m is NonNullable<typeof m> => m !== null);

  const employees = await prisma.employee.findMany({
    where: { id: { in: matches.map(match => match.employeeId) } },
    include: { attendanceRecords: { where: { uploadId }, orderBy: { recordDate: 'asc' } } },
  });

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
      const deduction = deductionByEmployee.get(match.employeeId)!;
      const summary = deduction.counts;

      // Escalate template if employee had an unresolved email last month
      const wasEscalated = hadPreviousEmail.has(match.employeeId);
      const templateKey = wasEscalated ? ESCALATION_MAP[match.recommendedTemplate] : match.recommendedTemplate;
      const tpl = templates[templateKey] || templates['initial'];
      if (!tpl) continue;

      // Build date-by-date attendance table (specific dates, as requested)
      const flaggedRecords = emp.attendanceRecords.filter(r => FLAGGED_STATUSES.includes(r.status));
      const dateTable = flaggedRecords
        .map(r => `  ${toDateOnly(r.recordDate)}  |  ${r.status}`)
        .join('\n');

      const ruleFlags = match.flags.awol ? '\n⚠ AWOL NOTICE: This constitutes Absence Without Official Leave.' : '';
      const disciplinary = match.flags.disciplinaryRisk ? '\n⚠ DISCIPLINARY RISK: This case has been flagged for potential disciplinary action.' : '';
      const managerCC = match.flags.notifyManager ? '\n(HR Manager has been notified)' : '';
      const directorCC = match.flags.notifyHRDirector ? '\n(HR Director has been notified)' : '';
      const escalationNote = wasEscalated
        ? '\n⚠ NOTE: A previous notice was sent last month. This is an escalated reminder as the matter remains unresolved.\n'
        : '';

      const rulesTriggered = match.triggeredRules.map(r => `• ${r.name}`).join('\n');

      // Spell out any rule-imposed deduction, so the notice matches the payslip.
      const ruleLopLines = deduction.ruleLop
        ? Object.entries(deduction.ruleLop.byRuleType).map(([, v]) => `• ${v.ruleName}: ${v.lopDays} day(s)`)
        : [];
      const lopNotice = deduction.lopDays > 0
        ? `\nLoss of Pay for this period: ${deduction.lopDays} day(s)`
          + (deduction.ruleLopDays > 0 ? ` (${deduction.baseLopDays} from attendance, ${deduction.ruleLopDays} from policy rules)\n${ruleLopLines.join('\n')}` : '')
          + '\n'
        : '';

      const body = `Dear ${emp.name},

This notice is issued in accordance with Dubai Government Human Resources Policy and UAE Federal Civil Service Law No. 11 of 2008.
${escalationNote}
Our records indicate the following attendance issues for the period ${periodMonth}:

Date         | Status
-------------|------------------
${dateTable}

Summary: Absent ${summary.absentDays}d | Missed Biometric ${summary.missedSwipeDays}x | Late Arrival ${summary.lateComingDays}x | Early Departure ${summary.earlyLeavingDays}x | Half Day ${summary.halfDays}x
${lopNotice}
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

  res.json({
    matches,
    draftsCreated,
    employeesEvaluated: deductions.length,
    // Rule-imposed LOP, so the caller can see policy penalties separately from
    // the attendance-derived base.
    lopAdjustments: deductions
      .filter(d => d.ruleLopDays > 0)
      .map(d => ({
        employeeId: d.employeeId,
        employeeName: d.employeeName,
        baseLopDays: d.baseLopDays,
        ruleLopDays: d.ruleLopDays,
        lopDays: d.lopDays,
        lopAmount: d.lopAmount,
        rules: Object.entries(d.ruleLop?.byRuleType ?? {}).map(([ruleType, v]) => ({ ruleType, ...v })),
      })),
    // Rules declaring lopMultiplier, which is intentionally not applied.
    ignoredMultipliers: deductions.flatMap(d =>
      (d.ruleLop?.ignoredMultipliers ?? []).map(m => ({ employeeId: d.employeeId, ...m }))
    ),
  });
});

export default router;
