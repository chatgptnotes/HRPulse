import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { calculateLOP } from '../services/lopService';

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
  res.json(configs.map(c => ({ id: c.id, employeeId: c.employeeId, employeeName: c.employee.name, employeeEmail: c.employee.email, basicSalary: c.basicSalary, effectiveMonth: c.effectiveMonth })));
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
  const uploadId = parseInt(req.params.uploadId);
  const settings = await getSettings();
  const workingDays = parseFloat(settings['working_days'] || '26');
  const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

  const employees = await prisma.employee.findMany({
    where: { attendanceRecords: { some: { uploadId } } },
    include: {
      attendanceRecords: { where: { uploadId } },
      salaryConfigs: { orderBy: { effectiveMonth: 'desc' }, take: 1 },
    },
  });

  const result = employees.map(emp => {
    const absent = emp.attendanceRecords.filter(r => r.status === 'Absent').length;
    const missed = emp.attendanceRecords.filter(r => r.status === 'Missed Swipe').length;
    const salary = emp.salaryConfigs[0];
    const { lopDays, lopAmount } = salary ? calculateLOP(salary.basicSalary, absent, missed, workingDays, missedSwipeWeight) : { lopDays: 0, lopAmount: 0 };
    return { employeeId: emp.id, employeeName: emp.name, basicSalary: salary?.basicSalary || 0, absentDays: absent, missedSwipeDays: missed, lopDays, lopAmount, workingDays };
  });

  res.json(result);
});

export default router;
