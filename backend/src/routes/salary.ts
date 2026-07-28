import { Router, Request, Response } from 'express';
import { supabase, getSettings } from '../db/supabase';
import { calculateLOP } from '../services/lopService';

const router = Router();

const PAYMENT_STATUSES = new Set(['pending', 'paid', 'on_hold', 'resigned']);

function mapPayment(row: any) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    periodMonth: row.period_month,
    status: row.status,
    paidAmount: Number(row.paid_amount) || 0,
    paymentDate: row.payment_date || '',
    holdReason: row.hold_reason || '',
    notes: row.notes || '',
    markedBy: row.marked_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/configs', async (req: Request, res: Response) => {
  const { month } = req.query;
  let query = supabase.from('salary_configs').select('*, employee:employees(*)');
  if (month) query = query.eq('effective_month', month as string);
  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const mapped = (data || []).map((c: any) => ({
    id: c.id,
    employeeId: c.employee_id,
    employeeName: c.employee?.name,
    employeeEmail: c.employee?.email,
    basicSalary: c.basic_salary,
    effectiveMonth: c.effective_month,
  }));
  mapped.sort((a: any, b: any) => (a.employeeName || '').localeCompare(b.employeeName || ''));
  res.json(mapped);
});

router.put('/configs', async (req: Request, res: Response) => {
  const { employeeId, basicSalary, effectiveMonth } = req.body;
  const { error } = await supabase
    .from('salary_configs')
    .upsert(
      { employee_id: employeeId, basic_salary: basicSalary, effective_month: effectiveMonth },
      { onConflict: 'employee_id,effective_month' }
    );
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.put('/configs/bulk', async (req: Request, res: Response) => {
  const { configs } = req.body as { configs: Array<{ employeeId: number; basicSalary: number; effectiveMonth: string }> };
  const rows = configs.map((c) => ({
    employee_id: c.employeeId,
    basic_salary: c.basicSalary,
    effective_month: c.effectiveMonth,
  }));
  const { error } = await supabase
    .from('salary_configs')
    .upsert(rows, { onConflict: 'employee_id,effective_month' });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.get('/payments', async (req: Request, res: Response) => {
  const month = String(req.query.month || '').trim();
  if (!month) { res.status(400).json({ error: 'month is required' }); return; }

  const { data, error } = await supabase
    .from('salary_payments')
    .select('*')
    .eq('period_month', month);

  if (error) {
    if (/salary_payments|relation .* does not exist|schema cache/i.test(error.message || '')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }

  res.json((data || []).map(mapPayment));
});

router.put('/payments/:employeeId', async (req: Request, res: Response) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  const {
    periodMonth,
    status,
    paidAmount = 0,
    paymentDate = null,
    holdReason = null,
    notes = null,
    markedBy = 'HR',
  } = req.body || {};

  if (!employeeId || !periodMonth) { res.status(400).json({ error: 'employeeId and periodMonth are required' }); return; }
  if (!PAYMENT_STATUSES.has(status)) { res.status(400).json({ error: 'Invalid salary payment status' }); return; }

  const row = {
    employee_id: employeeId,
    period_month: String(periodMonth),
    status,
    paid_amount: Number(paidAmount) || 0,
    payment_date: paymentDate || null,
    hold_reason: holdReason || null,
    notes: notes || null,
    marked_by: markedBy || 'HR',
  };

  const { data, error } = await supabase
    .from('salary_payments')
    .upsert(row, { onConflict: 'employee_id,period_month' })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(mapPayment(data));
});

router.get('/deductions/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const settings = await getSettings();
  const workingDays = parseFloat(settings['working_days'] || '26');
  const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

  const { data: records, error: rErr } = await supabase
    .from('attendance_records')
    .select('employee_id, status')
    .eq('upload_id', uploadId);
  if (rErr) { res.status(500).json({ error: rErr.message }); return; }

  const employeeIds = [...new Set((records || []).map((r: any) => r.employee_id))];
  const { data: employees } = await supabase.from('employees').select('id, name, monthly_salary').in('id', employeeIds);
  const { data: salaries } = await supabase.from('salary_configs').select('*').in('employee_id', employeeIds);

  const latestSalary: Record<number, { month: string; amount: number }> = {};
  for (const s of (salaries || []) as any[]) {
    if (!latestSalary[s.employee_id] || (s.effective_month || '') > latestSalary[s.employee_id].month) {
      latestSalary[s.employee_id] = { month: s.effective_month || '', amount: Number(s.basic_salary) || 0 };
    }
  }

  const result = (employees || []).map((emp: any) => {
    const empRecords = (records || []).filter((r: any) => r.employee_id === emp.id);
    const absent = empRecords.filter((r: any) => r.status === 'Absent').length;
    const missed = empRecords.filter((r: any) => r.status === 'Missed Swipe').length;
    const basic = Number(emp.monthly_salary) || latestSalary[emp.id]?.amount || 0;
    const { lopDays, lopAmount } = basic
      ? calculateLOP(basic, absent, missed, workingDays, missedSwipeWeight)
      : { lopDays: 0, lopAmount: 0 };
    return { employeeId: emp.id, employeeName: emp.name, basicSalary: basic, absentDays: absent, missedSwipeDays: missed, lopDays, lopAmount, workingDays };
  });

  res.json(result);
});

export default router;
