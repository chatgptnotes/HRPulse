import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { category, search } = req.query;
  let query = supabase.from('sops').select('*').eq('is_active', true);
  if (category) query = query.eq('category', category as string);
  if (search) {
    const s = search as string;
    query = query.or(`title.ilike.%${s}%,content.ilike.%${s}%`);
  }
  const { data, error } = await query.order('category', { ascending: true }).order('title', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.get('/categories', async (_req: Request, res: Response) => {
  const { data, error } = await supabase.from('sops').select('category').eq('is_active', true);
  if (error) { res.status(500).json({ error: error.message }); return; }
  const categories = [...new Set((data || []).map((s: { category: string }) => s.category))];
  res.json(categories);
});

router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase.from('sops').select('*').eq('id', parseInt(req.params.id)).single();
  if (error) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(data);
});

router.post('/', async (req: Request, res: Response) => {
  const { title, category, content, tags } = req.body;
  const { data, error } = await supabase
    .from('sops')
    .insert({ title, category, content, tags: tags || [] })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

router.put('/:id', async (req: Request, res: Response) => {
  const { title, category, content, tags } = req.body;
  const id = parseInt(req.params.id);
  const { data: current, error: curErr } = await supabase.from('sops').select('version').eq('id', id).single();
  if (curErr) { res.status(404).json({ error: 'Not found' }); return; }
  const { data, error } = await supabase
    .from('sops')
    .update({ title, category, content, tags: tags || [], version: (current.version || 0) + 1 })
    .eq('id', id)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const { error } = await supabase.from('sops').update({ is_active: false }).eq('id', parseInt(req.params.id));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

export default router;
