import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { supabase } from '../db/supabase';
import { listEmployeeDocuments } from '../services/employeeDocumentService';

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'photos');
fs.mkdirSync(uploadDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, _file, cb) => cb(null, `emp-${req.params.id}-${Date.now()}.jpg`),
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// Columns introduced by the Employee Master migration. Probed lazily so the API
// keeps working before the SQL migration has been applied.
let masterColsKnown = false;
let hasMasterCols = false;
let paidLeaveColKnown = false;
let hasPaidLeaveCol = false;
let overtimeColKnown = false;
let hasOvertimeCol = false;
let shiftTimingColsKnown = false;
let hasShiftTimingCols = false;
const BASE_COLS = 'id, employee_number, name, email, department, designation, created_at';
const MASTER_COLS = BASE_COLS + ', mobile, shift, monthly_salary, status, photo_url';

async function ensureMasterColsKnown() {
  if (masterColsKnown) return;
  const res = await supabase.from('employees').select(MASTER_COLS).limit(1);
  masterColsKnown = true;
  // Core master columns are present unless the DB explicitly says one is missing.
  hasMasterCols = !res.error || !/mobile|shift|monthly_salary|status|does not exist|schema cache/i.test(res.error.message);
}

// The paid-leave eligibility column is probed independently so that a missing
// column never regresses the core master fields.
async function ensurePaidLeaveColKnown() {
  if (paidLeaveColKnown) return;
  const res = await supabase.from('employees').select('id, paid_leaves_eligible').limit(1);
  paidLeaveColKnown = true;
  hasPaidLeaveCol = !res.error;
}

async function ensureOvertimeColKnown() {
  // Re-probe while missing so a server started before the SQL migration can
  // recover after HR runs ALTER TABLE without needing a code change.
  if (overtimeColKnown && hasOvertimeCol) return;
  const res = await supabase.from('employees').select('id, overtime_eligible').limit(1);
  overtimeColKnown = true;
  hasOvertimeCol = !res.error;
}

async function ensureShiftTimingColsKnown() {
  if (shiftTimingColsKnown) return;
  const res = await supabase.from('employees').select('id, shift_start_time, shift_end_time').limit(1);
  shiftTimingColsKnown = true;
  hasShiftTimingCols = !res.error;
}

function masterSelectCols() {
  let cols = MASTER_COLS;
  if (hasPaidLeaveCol) cols += ', paid_leaves_eligible';
  if (hasOvertimeCol) cols += ', overtime_eligible';
  if (hasShiftTimingCols) cols += ', shift_start_time, shift_end_time';
  return cols;
}

async function selectAll() {
  await ensureMasterColsKnown();
  if (hasMasterCols) {
    await ensurePaidLeaveColKnown();
    await ensureOvertimeColKnown();
    await ensureShiftTimingColsKnown();
  }
  const cols = hasMasterCols ? masterSelectCols() : BASE_COLS;
  const res = await supabase.from('employees').select(cols).order('name', { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function mapEmployee(e: any) {
  return {
    id: e.id,
    employeeNumber: e.employee_number || '',
    name: e.name,
    email: e.email || '',
    mobile: e.mobile || '',
    department: e.department || '',
    designation: e.designation || '',
    shift: e.shift || '',
    shiftStartTime: e.shift_start_time || '',
    shiftEndTime: e.shift_end_time || '',
    monthlySalary: Number(e.monthly_salary) || 0,
    status: e.status || 'Active',
    paidLeavesEligible: e.paid_leaves_eligible === true,
    overtimeEligible: e.overtime_eligible === true,
    photoUrl: e.photo_url || null,
    createdAt: e.created_at,
  };
}

function normalizeTimeValue(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  const meridiem = raw.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const data = await selectAll();
    res.json((data || []).map(mapEmployee));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase.from('employees').select('*').eq('id', parseInt(req.params.id)).single();
  if (error) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(mapEmployee(data));
});

router.get('/:id/documents', async (req: Request, res: Response) => {
  try {
    const employeeId = parseInt(req.params.id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      res.status(400).json({ error: 'Valid employee id is required' });
      return;
    }
    res.json(await listEmployeeDocuments(employeeId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function buildMasterPayload(body: any): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name: (body.name || '').trim(),
    employee_number: (body.employeeNumber || '').trim() || null,
    department: (body.department || '').trim() || null,
    designation: (body.designation || '').trim() || null,
  };
  if (hasMasterCols) {
    p.mobile = (body.mobile || '').trim() || null;
    p.shift = (body.shift || '').trim() || null;
    p.monthly_salary = Number(body.monthlySalary) || 0;
    p.status = body.status === 'Inactive' ? 'Inactive' : 'Active';
    if (hasShiftTimingCols) {
      p.shift_start_time = normalizeTimeValue(body.shiftStartTime);
      p.shift_end_time = normalizeTimeValue(body.shiftEndTime);
    }
    if (hasPaidLeaveCol) {
      p.paid_leaves_eligible = body.paidLeavesEligible === true;
    }
    if (hasOvertimeCol) {
      p.overtime_eligible = body.overtimeEligible === true;
    }
  }
  return p;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) { res.status(400).json({ error: 'Employee name is required' }); return; }

    await ensureMasterColsKnown();
    if (hasMasterCols) {
      await ensurePaidLeaveColKnown();
      await ensureOvertimeColKnown();
      await ensureShiftTimingColsKnown();
    }
    const payload = buildMasterPayload(req.body);
    // email is required by the legacy schema; auto-generate a unique one when not supplied.
    const slug = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'employee';
    payload.email = (req.body.email || `${slug}_${Date.now()}@hrpulse.local`).trim();

    const { data, error } = await supabase.from('employees').insert(payload).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(mapEmployee(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    await ensureMasterColsKnown();
    if (hasMasterCols) {
      await ensurePaidLeaveColKnown();
      await ensureOvertimeColKnown();
      await ensureShiftTimingColsKnown();
    }
    const update = buildMasterPayload(req.body);
    if (req.body.email !== undefined) update.email = (req.body.email || '').trim() || null;

    const { data, error } = await supabase
      .from('employees')
      .update(update)
      .eq('id', parseInt(req.params.id))
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(mapEmployee(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const { error } = await supabase.from('employees').delete().eq('id', parseInt(req.params.id));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

router.post('/:id/photo', photoUpload.single('photo'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
  const photoUrl = `/uploads/photos/${req.file.filename}`;
  const { data, error } = await supabase.from('employees').update({ photo_url: photoUrl }).eq('id', parseInt(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ photoUrl: data.photo_url });
});

export default router;
