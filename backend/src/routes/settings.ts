import { Router, Request, Response } from 'express';
import { supabase, getSettings } from '../db/supabase';
import { testSmtp } from '../services/emailService';
import { testOllamaConnection } from '../services/ollamaService';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const settings = await getSettings();
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    masked[k] = k === 'smtp_pass' ? '••••••••' : v;
  }
  res.json(masked);
});

router.put('/', async (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;
  const rows = Object.entries(updates).map(([key, value]) => ({ key, value }));
  const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.get('/templates', async (_req: Request, res: Response) => {
  const { data, error } = await supabase.from('email_templates').select('*').order('id', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.put('/templates/:type', async (req: Request, res: Response) => {
  const { subject, body } = req.body;
  const { error } = await supabase.from('email_templates').update({ subject, body }).eq('type', req.params.type);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.post('/test-smtp', async (_req: Request, res: Response) => {
  res.json(await testSmtp());
});

router.post('/test-ollama', async (_req: Request, res: Response) => {
  res.json(await testOllamaConnection());
});

export default router;
