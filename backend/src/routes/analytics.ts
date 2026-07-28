import { Router, Request, Response } from 'express';
import { supabase } from '../db/supabase';

const router = Router();

const NON_FLAG_STATUSES = ['Normal', 'Weekend', 'Holiday'];

router.get('/overview', async (_req: Request, res: Response) => {
  const [emp, uploads, drafts, sent] = await Promise.all([
    supabase.from('employees').select('*', { count: 'exact', head: true }),
    supabase.from('attendance_uploads').select('*', { count: 'exact', head: true }),
    supabase.from('email_drafts').select('*', { count: 'exact', head: true }),
    supabase.from('email_history').select('*', { count: 'exact', head: true }).eq('status', 'sent'),
  ]);
  res.json({
    totalEmployees: emp.count || 0,
    totalUploads: uploads.count || 0,
    totalEmails: drafts.count || 0,
    totalSent: sent.count || 0,
  });
});

router.get('/trends/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const { data, error } = await supabase
    .from('attendance_records')
    .select('record_date, status, employee:employees(name)')
    .eq('upload_id', uploadId)
    .neq('status', 'Normal')
    .neq('status', 'Weekend')
    .neq('status', 'Holiday');
  if (error) { res.status(500).json({ error: error.message }); return; }
  const records = (data || []) as any[];

  const byStatus: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const byEmployee: Record<number, { name: string; count: number }> = {};

  for (const r of records) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byDate[r.record_date] = (byDate[r.record_date] || 0) + 1;
    const name = r.employee?.name || 'Unknown';
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = { name, count: 0 };
    byEmployee[r.employee_id].count++;
  }

  const topOffenders = Object.entries(byEmployee)
    .map(([id, v]) => ({ employeeId: Number(id), name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  res.json({
    byStatus,
    byDate: Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count })),
    topOffenders,
  });
});

router.get('/monthly-comparison', async (_req: Request, res: Response) => {
  const { data: uploads, error } = await supabase
    .from('attendance_uploads')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(6);
  if (error) { res.status(500).json({ error: error.message }); return; }

  const result = [];
  for (const u of (uploads || []) as any[]) {
    const { count: flagged } = await supabase
      .from('attendance_records')
      .select('*', { count: 'exact', head: true })
      .eq('upload_id', u.id)
      .neq('status', 'Normal')
      .neq('status', 'Weekend')
      .neq('status', 'Holiday');
    const { count: sent } = await supabase
      .from('email_history')
      .select('*', { count: 'exact', head: true })
      .eq('upload_id', u.id)
      .eq('status', 'sent');
    result.push({ month: u.period_month, flagged: flagged || 0, sent: sent || 0, employees: u.row_count });
  }
  res.json(result.reverse());
});

export default router;
