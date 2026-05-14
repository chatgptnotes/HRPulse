import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';

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

export default router;
