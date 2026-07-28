import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../db/supabase';
import { insertHrNotification, updateHrNotificationAndPush } from '../services/hrNotificationService';

const router = Router();

function sendError(res: Response, err: any) {
  const message = String(err?.message || err || 'Leave request failed');
  if (/leave_requests|leave_balances|hr_notifications|schema cache|does not exist/i.test(message)) {
    res.status(503).json({
      error: 'Leave management tables are not installed. Run backend/supabase/migrations/20260722_ess_integration.sql in the HRPulse Supabase SQL Editor.',
    });
    return;
  }
  res.status(500).json({ error: message });
}

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  approverNotes: z.string().trim().max(1000).optional().default(''),
  decidedBy: z.string().trim().min(1).max(120).optional().default('HR Admin'),
});

const balanceSchema = z.object({
  leaveType: z.string().trim().min(1).max(80),
  periodYear: z.coerce.number().int().min(2000).max(2200),
  available: z.coerce.number().min(0),
  openingBalance: z.coerce.number().min(0).optional(),
  accrued: z.coerce.number().min(0).optional(),
});

function inclusiveDays(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function mapBalance(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type,
    openingBalance: Number(row.opening_balance) || 0,
    accrued: Number(row.accrued) || 0,
    used: Number(row.used) || 0,
    pending: Number(row.pending) || 0,
    available: Number(row.available) || 0,
    periodYear: row.period_year,
  };
}

function mapRequest(row: any, balances: any[] = []) {
  const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
  const year = Number(String(row.start_date).slice(0, 4));
  const balance = balances.find((item) =>
    item.employee_id === row.employee_id &&
    item.leave_type === row.leave_type &&
    item.period_year === year
  );
  return {
    id: row.id,
    employeeId: row.employee_id,
    employee: employee ? {
      id: employee.id,
      employeeNumber: employee.employee_number || '',
      name: employee.name,
      email: employee.email || '',
      department: employee.department || '',
      designation: employee.designation || '',
      paidLeavesEligible: employee.paid_leaves_eligible === true,
    } : null,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    days: inclusiveDays(row.start_date, row.end_date),
    reason: row.reason || '',
    status: row.status,
    source: row.source || 'hrpulse',
    approverNotes: row.approver_notes || '',
    decidedBy: row.decided_by || '',
    decidedAt: row.decided_at || null,
    requestedAt: row.created_at,
    balance: mapBalance(balance),
  };
}

async function loadRequests(employeeId?: number) {
  let query = supabase
    .from('leave_requests')
    .select('*, employees(id, employee_number, name, email, department, designation, paid_leaves_eligible)')
    .order('created_at', { ascending: false });
  if (employeeId) query = query.eq('employee_id', employeeId);
  const { data: requests, error } = await query;
  if (error) throw new Error(error.message);

  const employeeIds = [...new Set((requests || []).map((row: any) => row.employee_id))];
  let balances: any[] = [];
  if (employeeIds.length) {
    const result = await supabase.from('leave_balances').select('*').in('employee_id', employeeIds);
    if (result.error) throw new Error(result.error.message);
    balances = result.data || [];
  }
  return (requests || []).map((row: any) => mapRequest(row, balances));
}

async function syncDecisionNotification(request: any, requestId: number, days: number, decision: 'approved' | 'rejected', approverNotes: string, decidedBy: string) {
  const submittedKey = `leave:${requestId}:submitted`;
  const decisionKey = `leave:${requestId}:${decision}`;
  const submittedResult = await supabase
    .from('hr_notifications')
    .select('id')
    .eq('employee_id', request.employee_id)
    .eq('notification_key', submittedKey)
    .maybeSingle();
  if (submittedResult.error) throw new Error(submittedResult.error.message);

  let notificationId = submittedResult.data?.id;
  if (!notificationId) {
    const decisionResult = await supabase
      .from('hr_notifications')
      .select('id')
      .eq('employee_id', request.employee_id)
      .eq('notification_key', decisionKey)
      .maybeSingle();
    if (decisionResult.error) throw new Error(decisionResult.error.message);
    notificationId = decisionResult.data?.id;
  }

  const notification = {
    type: `leave_request_${decision}`,
    title: `Leave request ${decision}`,
    body: decision === 'approved'
      ? `Your ${request.leave_type} request for ${days} day${days === 1 ? '' : 's'} was approved.${approverNotes ? ` ${approverNotes}` : ''}`
      : `Your ${request.leave_type} request was rejected.${approverNotes ? ` ${approverNotes}` : ''}`,
    severity: decision === 'approved' ? 'success' : 'warning',
    source: 'hrpulse',
    metadata: { leaveRequestId: requestId, decidedBy },
    read_at: null,
    created_at: new Date().toISOString(),
  };

  if (notificationId) {
    await updateHrNotificationAndPush(notificationId, notification);
  } else {
    await insertHrNotification({
        employee_id: request.employee_id,
        notification_key: decisionKey,
        ...notification,
      });
  }
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    const status = String(req.query.status || 'all').toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();
    let rows = await loadRequests(Number.isInteger(employeeId) ? employeeId : undefined);
    if (status !== 'all') rows = rows.filter((row: any) => row.status === status);
    if (search) {
      rows = rows.filter((row: any) =>
        `${row.employee?.name || ''} ${row.employee?.employeeNumber || ''} ${row.employee?.department || ''} ${row.leaveType}`
          .toLowerCase()
          .includes(search)
      );
    }
    res.json(rows);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.get('/employee/:employeeId', async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      res.status(400).json({ error: 'Valid employeeId is required' });
      return;
    }
    const [requests, balanceResult] = await Promise.all([
      loadRequests(employeeId),
      supabase.from('leave_balances').select('*').eq('employee_id', employeeId).order('period_year', { ascending: false }),
    ]);
    if (balanceResult.error) throw new Error(balanceResult.error.message);
    res.json({ requests, balances: (balanceResult.data || []).map(mapBalance) });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.put('/balances/:employeeId', async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const parsed = balanceSchema.safeParse(req.body || {});
    if (!Number.isInteger(employeeId) || employeeId <= 0 || !parsed.success) {
      res.status(400).json({ error: parsed.success ? 'Valid employeeId is required' : parsed.error.flatten() });
      return;
    }

    const currentResult = await supabase
      .from('leave_balances')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('leave_type', parsed.data.leaveType)
      .eq('period_year', parsed.data.periodYear)
      .maybeSingle();
    if (currentResult.error) throw new Error(currentResult.error.message);
    const current = currentResult.data;
    const { data, error } = await supabase
      .from('leave_balances')
      .upsert({
        employee_id: employeeId,
        leave_type: parsed.data.leaveType,
        period_year: parsed.data.periodYear,
        opening_balance: parsed.data.openingBalance ?? (Number(current?.opening_balance) || parsed.data.available),
        accrued: parsed.data.accrued ?? (Number(current?.accrued) || 0),
        used: Number(current?.used) || 0,
        pending: Number(current?.pending) || 0,
        available: parsed.data.available,
      }, { onConflict: 'employee_id,leave_type,period_year' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(mapBalance(data));
  } catch (err: any) {
    sendError(res, err);
  }
});

router.patch('/:id/decision', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = decisionSchema.safeParse(req.body || {});
    if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
      res.status(400).json({ error: parsed.success ? 'Valid request id is required' : parsed.error.flatten() });
      return;
    }

    const requestResult = await supabase.from('leave_requests').select('*').eq('id', id).single();
    if (requestResult.error || !requestResult.data) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    const request = requestResult.data;
    if (request.status !== 'pending') {
      res.status(409).json({ error: `This request is already ${request.status}` });
      return;
    }

    const days = inclusiveDays(request.start_date, request.end_date);
    const year = Number(String(request.start_date).slice(0, 4));
    const balanceResult = await supabase
      .from('leave_balances')
      .select('*')
      .eq('employee_id', request.employee_id)
      .eq('leave_type', request.leave_type)
      .eq('period_year', year)
      .maybeSingle();
    if (balanceResult.error) throw new Error(balanceResult.error.message);
    const balance = balanceResult.data;

    if (parsed.data.decision === 'approved') {
      if (!balance) {
        res.status(409).json({ error: `Configure the ${request.leave_type} balance for ${year} before approval` });
        return;
      }
      if (Number(balance.available) < days) {
        res.status(409).json({ error: `Insufficient leave balance: ${Number(balance.available) || 0} available, ${days} required` });
        return;
      }
    }

    const decidedAt = new Date().toISOString();
    const updateResult = await supabase
      .from('leave_requests')
      .update({
        status: parsed.data.decision,
        approver_notes: parsed.data.approverNotes || null,
        decided_by: parsed.data.decidedBy,
        decided_at: decidedAt,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (updateResult.error) throw new Error(updateResult.error.message);
    if (!updateResult.data) {
      res.status(409).json({ error: 'This request was decided by another user' });
      return;
    }

    let updatedBalance = balance;
    if (balance) {
      const balanceUpdate = await supabase
        .from('leave_balances')
        .update({
          available: parsed.data.decision === 'approved' ? Number(balance.available) - days : Number(balance.available),
          used: parsed.data.decision === 'approved' ? Number(balance.used) + days : Number(balance.used),
          pending: Math.max(0, Number(balance.pending) - days),
        })
        .eq('id', balance.id)
        .select()
        .single();
      if (balanceUpdate.error) {
        await supabase.from('leave_requests').update({ status: 'pending', approver_notes: null, decided_by: null, decided_at: null }).eq('id', id);
        throw new Error(`Balance update failed: ${balanceUpdate.error.message}`);
      }
      updatedBalance = balanceUpdate.data;
    }

    try {
      await syncDecisionNotification(
        request,
        id,
        days,
        parsed.data.decision,
        parsed.data.approverNotes,
        parsed.data.decidedBy,
      );
    } catch (notificationError) {
      console.error(`Leave request ${id} was decided, but its employee notification could not be updated:`, notificationError);
    }

    const rows = await loadRequests(request.employee_id);
    res.json({ request: rows.find((row: any) => row.id === id), balance: mapBalance(updatedBalance) });
  } catch (err: any) {
    sendError(res, err);
  }
});

export default router;
