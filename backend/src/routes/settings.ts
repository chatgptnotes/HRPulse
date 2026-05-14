import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { testSmtp } from '../services/emailService';
import { testOllamaConnection } from '../services/ollamaService';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const rows = await prisma.setting.findMany();
  const settings: Record<string, string> = {};
  for (const r of rows) {
    settings[r.key] = r.key === 'smtp_pass' ? '••••••••' : r.value;
  }
  res.json(settings);
});

router.put('/', async (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(updates)) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  res.json({ ok: true });
});

router.get('/templates', async (_req: Request, res: Response) => {
  res.json(await prisma.emailTemplate.findMany({ orderBy: { id: 'asc' } }));
});

router.put('/templates/:type', async (req: Request, res: Response) => {
  const { subject, body } = req.body;
  await prisma.emailTemplate.update({ where: { type: req.params.type }, data: { subject, body } });
  res.json({ ok: true });
});

router.post('/test-smtp', async (_req: Request, res: Response) => {
  res.json(await testSmtp());
});

router.post('/test-ollama', async (_req: Request, res: Response) => {
  res.json(await testOllamaConnection());
});

export default router;
