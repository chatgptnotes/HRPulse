import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { category, search } = req.query;
  const sops = await prisma.sop.findMany({
    where: {
      isActive: true,
      ...(category ? { category: category as string } : {}),
      ...(search ? { OR: [{ title: { contains: search as string, mode: 'insensitive' } }, { content: { contains: search as string, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  });
  res.json(sops);
});

router.get('/categories', async (_req: Request, res: Response) => {
  const sops = await prisma.sop.findMany({ select: { category: true }, distinct: ['category'] });
  res.json(sops.map(s => s.category));
});

router.get('/:id', async (req: Request, res: Response) => {
  const sop = await prisma.sop.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!sop) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(sop);
});

router.post('/', async (req: Request, res: Response) => {
  const { title, category, content, tags } = req.body;
  const sop = await prisma.sop.create({ data: { title, category, content, tags: tags || [] } });
  res.status(201).json(sop);
});

router.put('/:id', async (req: Request, res: Response) => {
  const { title, category, content, tags } = req.body;
  const current = await prisma.sop.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!current) { res.status(404).json({ error: 'Not found' }); return; }
  const sop = await prisma.sop.update({
    where: { id: parseInt(req.params.id) },
    data: { title, category, content, tags: tags || [], version: current.version + 1 },
  });
  res.json(sop);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.sop.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
  res.json({ ok: true });
});

export default router;
