import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';

const router = Router();
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function dateOnly(value: unknown, field: string): Date {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field} must be YYYY-MM-DD`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}

function shiftData(body: any) {
  const name = String(body.name || '').trim();
  const startTime = String(body.startTime || '').trim();
  const endTime = String(body.endTime || '').trim();
  const roleTarget = String(body.roleTarget || 'GENERAL').trim().toUpperCase();
  const graceMinutes = Number(body.graceMinutes ?? 15);
  if (!name) throw new Error('Shift name is required');
  if (!timePattern.test(startTime) || !timePattern.test(endTime)) throw new Error('Times must use HH:mm format');
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 240) throw new Error('Grace minutes must be between 0 and 240');
  return { name, startTime, endTime, roleTarget, graceMinutes, isOvernight: Boolean(body.isOvernight) };
}

router.get('/', async (_req: Request, res: Response) => {
  const shifts = await prisma.shift.findMany({ where: { isActive: true }, orderBy: [{ roleTarget: 'asc' }, { startTime: 'asc' }, { name: 'asc' }] });
  res.json(shifts);
});

router.get('/employees/:employeeId', async (req: Request, res: Response) => {
  const employeeId = Number(req.params.employeeId);
  const assignments = await prisma.employeeShift.findMany({ where: { employeeId }, include: { shift: true }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
  res.json(assignments);
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const shift = await prisma.shift.create({ data: shiftData(req.body) });
    res.status(201).json(shift);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Shift could not be created' });
  }
});

router.post('/employees/:employeeId', async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const effectiveFrom = dateOnly(req.body.effectiveFrom, 'effectiveFrom');
    const effectiveTo = req.body.effectiveTo ? dateOnly(req.body.effectiveTo, 'effectiveTo') : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new Error('End date must be on or after start date');
    let shiftId = String(req.body.shiftId || '');
    if (req.body.customShift) {
      const created = await prisma.shift.create({ data: shiftData(req.body.customShift) });
      shiftId = created.id;
    }
    if (!shiftId) throw new Error('Select a shift or provide custom times');
    const assignment = await prisma.employeeShift.create({ data: { employeeId, shiftId, effectiveFrom, effectiveTo }, include: { shift: true } });
    res.status(201).json(assignment);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Work time could not be saved' });
  }
});

export default router;
