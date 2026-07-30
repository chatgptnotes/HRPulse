import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { supabase } from '../db/supabase';
import { createEmployeeDocumentSignedUrl, listEmployeeDocuments } from '../services/employeeDocumentService';
import { AuthenticatedRequest, requireRoles } from '../middleware/auth';
import { enqueueForActiveConnectors } from '../services/connectorService';

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
  const res = await supabase.from('employees').select('*').order('name', { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function mapEmployee(e: any) {
  return {
    id: e.id,
    publicUuid: e.public_uuid || '',
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

async function queueEmployeeSync(employee: any, eventType: 'employee.created' | 'employee.updated' | 'employee.deactivated') {
  if (!employee?.public_uuid) return;
  await enqueueForActiveConnectors({
    organizationId: employee.organization_id || null,
    eventType,
    entityUuid: employee.public_uuid,
    data: {
      hrpulse_employee_uuid: employee.public_uuid,
      employee_number: employee.employee_number || '',
      name: { display: employee.name || '' },
      email: employee.email || null,
      mobile_number: employee.mobile || null,
      department: employee.department ? { code: String(employee.department).toUpperCase().replace(/\s+/g, '_'), name: employee.department } : null,
      designation: employee.designation ? { code: String(employee.designation).toUpperCase().replace(/\s+/g, '_'), name: employee.designation } : null,
      joining_date: employee.joining_date || null,
      employment_status: String(employee.status || 'Active').toLowerCase(),
      shift: employee.shift ? { code: String(employee.shift).toUpperCase().replace(/\s+/g, '_'), name: employee.shift } : null,
      source_updated_at: employee.updated_at || new Date().toISOString(),
      version: Number(employee.record_version || 1),
    },
  });
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

router.get('/:id/documents', requireRoles('super_admin', 'hr_admin'), async (req: Request, res: Response) => {
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

router.get('/:id/documents/:documentId/download', requireRoles('super_admin', 'hr_admin'), async (req: Request, res: Response) => {
  try {
    const employeeId = parseInt(req.params.id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      res.status(400).json({ error: 'Valid employee id is required' });
      return;
    }
    const document = await createEmployeeDocumentSignedUrl(employeeId, req.params.documentId);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (document.legacyLocal && document.absolutePath) {
      res.setHeader('Content-Type', document.row.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.row.original_filename)}"`);
      res.sendFile(document.absolutePath);
      return;
    }
    res.redirect(302, document.signedUrl as string);
  } catch (err: any) {
    if (err?.code === 'DOCUMENT_QUARANTINED') {
      res.status(423).json({ error: err.message });
      return;
    }
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

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
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
    const organizationId = req.hrActor?.organizationId
      || (await supabase.from('organizations').select('id').eq('code', 'hope').maybeSingle()).data?.id
      || null;
    payload.organization_id = organizationId;

    const { data, error } = await supabase.from('employees').insert(payload).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    try { await queueEmployeeSync(data, 'employee.created'); } catch (syncError) { console.error('Employee sync queue failed:', syncError); }
    res.status(201).json(mapEmployee(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureMasterColsKnown();
    if (hasMasterCols) {
      await ensurePaidLeaveColKnown();
      await ensureOvertimeColKnown();
      await ensureShiftTimingColsKnown();
    }
    const update = buildMasterPayload(req.body);
    if (req.body.email !== undefined) update.email = (req.body.email || '').trim() || null;
    const current = await supabase.from('employees').select('record_version').eq('id', parseInt(req.params.id)).maybeSingle();
    update.record_version = Number(current.data?.record_version || 1) + 1;
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('employees')
      .update(update)
      .eq('id', parseInt(req.params.id))
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    try { await queueEmployeeSync(data, 'employee.updated'); } catch (syncError) { console.error('Employee sync queue failed:', syncError); }
    res.json(mapEmployee(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const current = await supabase.from('employees').select('*').eq('id', parseInt(req.params.id)).maybeSingle();
  if (current.error || !current.data) { res.status(404).json({ error: 'Employee not found' }); return; }
  const { data, error } = await supabase
    .from('employees')
    .update({
      status: 'Inactive',
      deactivated_at: new Date().toISOString(),
      record_version: Number(current.data.record_version || 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parseInt(req.params.id))
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  try { await queueEmployeeSync(data, 'employee.deactivated'); } catch (syncError) { console.error('Employee sync queue failed:', syncError); }
  res.json({ ok: true, employee: mapEmployee(data) });
});

router.post('/:id/photo', photoUpload.single('photo'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
  const photoUrl = `/uploads/photos/${req.file.filename}`;
  const { data, error } = await supabase.from('employees').update({ photo_url: photoUrl }).eq('id', parseInt(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ photoUrl: data.photo_url });
});

export default router;
