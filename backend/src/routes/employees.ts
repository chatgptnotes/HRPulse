import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const employees = await prisma.employee.findMany({ orderBy: { name: 'asc' } });
  res.json(employees);
});

router.get('/:id', async (req: Request, res: Response) => {
  const emp = await prisma.employee.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!emp) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(emp);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { name, email, department, designation } = req.body;
  const emp = await prisma.employee.update({
    where: { id: parseInt(req.params.id) },
    data: { ...(name && { name }), ...(email && { email }), ...(department && { department }), ...(designation && { designation }) },
  });
  res.json(emp);
});

export default router;
