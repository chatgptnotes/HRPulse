import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { computeDeductionsForUpload } from '../services/deductionService';

const router = Router();

async function getSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.get('/configs', async (req: Request, res: Response) => {
  const { month } = req.query;
  const configs = await prisma.salaryConfig.findMany({
    where: month ? { effectiveMonth: month as string } : undefined,
    include: { employee: true },
    orderBy: { employee: { name: 'asc' } },
  });
  // Decimal serialises to a JSON *string*; the frontend expects a number
  // (SalaryPage.tsx calls .toLocaleString() on it), so coerce at the boundary.
  res.json(configs.map(c => ({ id: c.id, employeeId: c.employeeId, employeeName: c.employee.name, employeeEmail: c.employee.email, basicSalary: Number(c.basicSalary), effectiveMonth: c.effectiveMonth })));
});

router.put('/configs', async (req: Request, res: Response) => {
  const { employeeId, basicSalary, effectiveMonth } = req.body;
  await prisma.salaryConfig.upsert({
    where: { employeeId_effectiveMonth: { employeeId, effectiveMonth } },
    update: { basicSalary },
    create: { employeeId, basicSalary, effectiveMonth },
  });
  res.json({ ok: true });
});

router.put('/configs/bulk', async (req: Request, res: Response) => {
  const { configs } = req.body as { configs: Array<{ employeeId: number; basicSalary: number; effectiveMonth: string }> };
  for (const c of configs) {
    await prisma.salaryConfig.upsert({
      where: { employeeId_effectiveMonth: { employeeId: c.employeeId, effectiveMonth: c.effectiveMonth } },
      update: { basicSalary: c.basicSalary },
      create: { employeeId: c.employeeId, basicSalary: c.basicSalary, effectiveMonth: c.effectiveMonth },
    });
  }
  res.json({ ok: true });
});

router.get('/deductions/:uploadId', async (req: Request, res: Response) => {
  const deductions = await computeDeductionsForUpload(parseInt(req.params.uploadId));

  res.json(deductions.map(d => ({
    employeeId: d.employeeId,
    employeeName: d.employeeName,
    basicSalary: d.basicSalary,
    absentDays: d.counts.chargeableAbsentDays, // Unpaid absences only (beyond paid leave allowance)
    paidLeaveDays: d.counts.paidLeaveDays, // Days of paid leave taken
    protectedAbsentDays: d.counts.protectedAbsentDays, // Absences covered by allowance
    leaveLimit: d.leaveLimit,
    missedSwipeDays: d.counts.missedSwipeDays,
    halfDays: d.counts.halfDays,
    lateComingDays: d.counts.lateComingDays,
    earlyLeavingDays: d.counts.earlyLeavingDays,
    baseLopDays: d.baseLopDays,
    ruleLopDays: d.ruleLopDays,
    lopDays: d.lopDays,
    lopAmount: d.lopAmount,
    workingDays: d.workingDays,
    // Which rules added days, so a payslip can explain the deduction.
    lopRules: d.ruleLop ? Object.entries(d.ruleLop.byRuleType).map(([ruleType, v]) => ({ ruleType, ...v })) : [],
  })));
});

export default router;
