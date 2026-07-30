import { createHash, randomUUID } from 'crypto';
import { Router, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../db/supabase';
import { AuthenticatedRequest, connectorAuth, verifyHimsSignature } from '../middleware/auth';
import {
  auditIntegration,
  ConnectorContext,
  ingestDailyAttendance,
  markInboxProcessed,
  recordInboxEvent,
} from '../services/connectorService';

const router = Router();

const attendanceSchema = z.object({
  sourceRecordId: z.string().trim().min(1).max(200),
  hrpulseEmployeeUuid: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInAt: z.string().datetime({ offset: true }).nullable().optional(),
  checkOutAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().trim().min(1).max(80).default('Asia/Kolkata'),
  shiftType: z.string().trim().max(80).nullable().optional(),
  status: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(1000).nullable().optional(),
  sourceVersion: z.coerce.number().int().positive(),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
  reversed: z.boolean().optional().default(false),
});

const attendanceBatchSchema = z.object({
  eventUuid: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  records: z.array(attendanceSchema).min(1).max(500),
});

const leaveSchema = z.object({
  requestUuid: z.string().uuid(),
  externalRequestId: z.string().trim().min(1).max(200),
  hrpulseEmployeeUuid: z.string().uuid(),
  leaveType: z.enum(['CASUAL', 'SICK', 'EMERGENCY']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startDayPart: z.enum(['full', 'first_half', 'second_half']).default('full'),
  endDayPart: z.enum(['full', 'first_half', 'second_half']).default('full'),
  reason: z.string().trim().max(1000).nullable().optional(),
  sourceVersion: z.coerce.number().int().positive(),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
});

const leaveUpdateSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startDayPart: z.enum(['full', 'first_half', 'second_half']).optional(),
  endDayPart: z.enum(['full', 'first_half', 'second_half']).optional(),
  reason: z.string().trim().max(1000).nullable().optional(),
  sourceVersion: z.coerce.number().int().positive(),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
});

const leaveCancelSchema = z.object({
  reason: z.string().trim().max(1000).nullable().optional(),
  sourceVersion: z.coerce.number().int().positive(),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
});

const webhookSchema = z.object({
  event_uuid: z.string().uuid(),
  event_type: z.string().min(1),
  event_version: z.coerce.number().int().positive().default(1),
  entity_uuid: z.string().uuid().nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }),
  data: z.record(z.unknown()),
});

const uploadSessionSchema = z.object({
  hrpulseEmployeeUuid: z.string().uuid(),
  documentType: z.enum([
    'RESUME_CV',
    'EDUCATIONAL_QUALIFICATION',
    'IDENTITY_DOCUMENT',
    'PROFESSIONAL_REGISTRATION',
    'EXPERIENCE_CERTIFICATE',
    'EMPLOYMENT_CONTRACT',
    'PAYSLIP',
    'GENERAL_HR_DOCUMENT',
  ]),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.enum([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),
  fileSize: z.coerce.number().int().positive().max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function connector(req: AuthenticatedRequest) {
  return req.connector as ConnectorContext;
}

function requestId(req: AuthenticatedRequest) {
  return String(req.headers['x-request-id'] || randomUUID());
}

function enumerateDates(start: string, end: string, startPart: string, endPart: string) {
  const out: Array<{ leave_date: string; day_fraction: number; day_part: string }> = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    const isStart = date === start;
    const isEnd = date === end;
    let part = 'full';
    if (isStart && startPart !== 'full') part = startPart;
    if (isEnd && endPart !== 'full') part = endPart;
    out.push({ leave_date: date, day_fraction: part === 'full' ? 1 : 0.5, day_part: part });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

async function saveExternalLeave(ctx: ConnectorContext, input: z.infer<typeof leaveSchema>) {
  const employee = await supabase
    .from('employees')
    .select('id')
    .eq('public_uuid', input.hrpulseEmployeeUuid)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (employee.error) throw new Error(employee.error.message);
  if (!employee.data) return { status: 'rejected', code: 'employee_mapping_not_found' };

  const existing = await supabase.from('leave_requests').select('*').eq('request_uuid', input.requestUuid).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    if ((existing.data.source_version || 1) > input.sourceVersion) {
      return { status: 'ignored_stale', requestUuid: input.requestUuid };
    }
    return { status: 'duplicate', requestUuid: input.requestUuid, id: existing.data.id };
  }
  if (input.endDate < input.startDate) return { status: 'rejected', code: 'invalid_date_range' };

  const inserted = await supabase
    .from('leave_requests')
    .insert({
      employee_id: employee.data.id,
      request_uuid: input.requestUuid,
      leave_type: input.leaveType,
      start_date: input.startDate,
      end_date: input.endDate,
      start_day_part: input.startDayPart,
      end_day_part: input.endDayPart,
      reason: input.reason || null,
      status: 'pending',
      source: ctx.connectorKey,
      source_system: 'hims',
      external_request_id: input.externalRequestId,
      source_version: input.sourceVersion,
      updated_at: input.sourceUpdatedAt,
    })
    .select('*')
    .single();
  if (inserted.error) throw new Error(inserted.error.message);

  const days = enumerateDates(input.startDate, input.endDate, input.startDayPart, input.endDayPart);
  const dayInsert = await supabase.from('leave_request_days').insert(days.map(day => ({
    leave_request_id: inserted.data.id,
    ...day,
    is_paid: true,
  })));
  if (dayInsert.error) throw new Error(dayInsert.error.message);

  const totalDays = days.reduce((sum, day) => sum + day.day_fraction, 0);
  const year = Number(input.startDate.slice(0, 4));
  const balance = await supabase
    .from('leave_balances')
    .select('*')
    .eq('employee_id', employee.data.id)
    .eq('leave_type', input.leaveType)
    .eq('period_year', year)
    .maybeSingle();
  if (!balance.error && balance.data) {
    await supabase
      .from('leave_balances')
      .update({ pending: Number(balance.data.pending || 0) + totalDays })
      .eq('id', balance.data.id);
  }
  return { status: 'accepted', requestUuid: input.requestUuid, id: inserted.data.id };
}

router.use(connectorAuth);

router.post('/attendance/daily/batch', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = attendanceBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'invalid_attendance_batch', details: parsed.error.flatten() } });
    return;
  }
  const ctx = connector(req);
  const inbox = await recordInboxEvent(ctx, {
    event_uuid: parsed.data.eventUuid,
    event_type: 'attendance.daily.batch',
    event_version: 1,
    occurred_at: parsed.data.occurredAt,
    data: { recordCount: parsed.data.records.length },
  });
  if (inbox.duplicate) {
    res.json({ data: { eventUuid: parsed.data.eventUuid, status: 'duplicate', results: [] } });
    return;
  }
  try {
    const results = [];
    for (const record of parsed.data.records) results.push(await ingestDailyAttendance(ctx, record));
    await markInboxProcessed(inbox.row.id, 'processed');
    const rejected = results.filter(result => result.status === 'rejected').length;
    res.status(rejected ? 207 : 202).json({
      data: {
        eventUuid: parsed.data.eventUuid,
        accepted: results.length - rejected,
        rejected,
        results,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markInboxProcessed(inbox.row.id, 'failed', message);
    res.status(500).json({ error: { code: 'attendance_ingestion_failed', message } });
  }
});

router.post('/leave-requests', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = leaveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'invalid_leave_request', details: parsed.error.flatten() } });
    return;
  }
  try {
    const result = await saveExternalLeave(connector(req), parsed.data);
    const status = result.status === 'rejected' ? 422 : result.status === 'accepted' ? 201 : 200;
    res.status(status).json({ data: result });
  } catch (error) {
    res.status(500).json({ error: { code: 'leave_sync_failed', message: error instanceof Error ? error.message : String(error) } });
  }
});

router.patch('/leave-requests/:requestUuid', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = leaveUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'invalid_leave_update', details: parsed.error.flatten() } });
    return;
  }
  const existing = await supabase
    .from('leave_requests')
    .select('*')
    .eq('request_uuid', req.params.requestUuid)
    .maybeSingle();
  if (existing.error || !existing.data) {
    res.status(404).json({ error: { code: 'leave_request_not_found', message: 'Leave request was not found' } });
    return;
  }
  if (existing.data.status !== 'pending') {
    res.status(409).json({ error: { code: 'leave_not_pending', message: 'Only a pending request can be edited' } });
    return;
  }
  if (Number(existing.data.source_version || 1) >= parsed.data.sourceVersion) {
    res.status(409).json({ error: { code: 'version_conflict', message: 'Leave update version is stale' } });
    return;
  }
  const startDate = parsed.data.startDate || existing.data.start_date;
  const endDate = parsed.data.endDate || existing.data.end_date;
  if (endDate < startDate) {
    res.status(422).json({ error: { code: 'invalid_date_range', message: 'endDate must be on or after startDate' } });
    return;
  }
  const startPart = parsed.data.startDayPart || existing.data.start_day_part || 'full';
  const endPart = parsed.data.endDayPart || existing.data.end_day_part || 'full';
  const previousDays = enumerateDates(
    existing.data.start_date,
    existing.data.end_date,
    existing.data.start_day_part || 'full',
    existing.data.end_day_part || 'full',
  ).reduce((sum, day) => sum + day.day_fraction, 0);
  const saved = await supabase.from('leave_requests').update({
    start_date: startDate,
    end_date: endDate,
    start_day_part: startPart,
    end_day_part: endPart,
    reason: parsed.data.reason !== undefined ? parsed.data.reason : existing.data.reason,
    source_version: parsed.data.sourceVersion,
    updated_at: parsed.data.sourceUpdatedAt,
  }).eq('id', existing.data.id).select('*').single();
  if (saved.error) {
    res.status(500).json({ error: { code: 'leave_update_failed', message: saved.error.message } });
    return;
  }
  await supabase.from('leave_request_days').delete().eq('leave_request_id', existing.data.id);
  const days = enumerateDates(startDate, endDate, startPart, endPart);
  const dayResult = await supabase.from('leave_request_days').insert(days.map(day => ({
    leave_request_id: existing.data.id,
    ...day,
    is_paid: true,
  })));
  if (dayResult.error) {
    res.status(500).json({ error: { code: 'leave_day_update_failed', message: dayResult.error.message } });
    return;
  }
  const nextDays = days.reduce((sum, day) => sum + day.day_fraction, 0);
  const balance = await supabase
    .from('leave_balances')
    .select('id, pending')
    .eq('employee_id', existing.data.employee_id)
    .eq('leave_type', existing.data.leave_type)
    .eq('period_year', Number(String(startDate).slice(0, 4)))
    .maybeSingle();
  if (balance.data) {
    await supabase
      .from('leave_balances')
      .update({ pending: Math.max(0, Number(balance.data.pending || 0) - previousDays + nextDays) })
      .eq('id', balance.data.id);
  }
  res.json({ data: { requestUuid: req.params.requestUuid, status: 'updated', version: parsed.data.sourceVersion } });
});

router.post('/leave-requests/:requestUuid/cancel', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = leaveCancelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'invalid_leave_cancellation', details: parsed.error.flatten() } });
    return;
  }
  const existing = await supabase.from('leave_requests').select('*').eq('request_uuid', req.params.requestUuid).maybeSingle();
  if (existing.error || !existing.data) {
    res.status(404).json({ error: { code: 'leave_request_not_found', message: 'Leave request was not found' } });
    return;
  }
  if (existing.data.status === 'cancelled') {
    res.json({ data: { requestUuid: req.params.requestUuid, status: 'duplicate' } });
    return;
  }
  if (existing.data.status !== 'pending') {
    res.status(409).json({ error: { code: 'leave_not_pending', message: 'Only a pending request can be cancelled' } });
    return;
  }
  if (Number(existing.data.source_version || 1) >= parsed.data.sourceVersion) {
    res.status(409).json({ error: { code: 'version_conflict', message: 'Cancellation version is stale' } });
    return;
  }
  const daysResult = await supabase.from('leave_request_days').select('day_fraction').eq('leave_request_id', existing.data.id);
  const days = (daysResult.data || []).reduce((sum: number, day: any) => sum + Number(day.day_fraction || 0), 0)
    || enumerateDates(existing.data.start_date, existing.data.end_date, existing.data.start_day_part || 'full', existing.data.end_day_part || 'full')
      .reduce((sum, day) => sum + day.day_fraction, 0);
  const saved = await supabase.from('leave_requests').update({
    status: 'cancelled',
    approver_notes: parsed.data.reason || null,
    source_version: parsed.data.sourceVersion,
    updated_at: parsed.data.sourceUpdatedAt,
  }).eq('id', existing.data.id).select('*').single();
  if (saved.error) {
    res.status(500).json({ error: { code: 'leave_cancellation_failed', message: saved.error.message } });
    return;
  }
  const balance = await supabase
    .from('leave_balances')
    .select('id, pending')
    .eq('employee_id', existing.data.employee_id)
    .eq('leave_type', existing.data.leave_type)
    .eq('period_year', Number(String(existing.data.start_date).slice(0, 4)))
    .maybeSingle();
  if (balance.data) {
    await supabase.from('leave_balances').update({ pending: Math.max(0, Number(balance.data.pending || 0) - days) }).eq('id', balance.data.id);
  }
  res.json({ data: { requestUuid: req.params.requestUuid, status: 'cancelled', version: parsed.data.sourceVersion } });
});

router.post('/webhooks/adamrit', verifyHimsSignature, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'invalid_event', details: parsed.error.flatten() } });
    return;
  }
  const ctx = connector(req);
  const inbox = await recordInboxEvent(ctx, parsed.data);
  if (inbox.duplicate) {
    res.json({ data: { eventUuid: parsed.data.event_uuid, status: 'duplicate' } });
    return;
  }
  try {
    let result: unknown;
    if (parsed.data.event_type === 'attendance.daily.upserted' || parsed.data.event_type === 'attendance.daily.reversed') {
      const attendance = attendanceSchema.parse({
        ...parsed.data.data,
        reversed: parsed.data.event_type === 'attendance.daily.reversed',
      });
      result = await ingestDailyAttendance(ctx, attendance);
    } else if (parsed.data.event_type === 'leave.request.submitted') {
      result = await saveExternalLeave(ctx, leaveSchema.parse(parsed.data.data));
    } else {
      throw new Error(`Unsupported event type: ${parsed.data.event_type}`);
    }
    await markInboxProcessed(inbox.row.id, 'processed');
    res.status(202).json({ data: { eventUuid: parsed.data.event_uuid, status: 'accepted', result } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markInboxProcessed(inbox.row.id, 'failed', message);
    res.status(400).json({ error: { code: 'event_processing_failed', message } });
  }
});

router.post('/employee-documents/upload-sessions', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = uploadSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'invalid_document', details: parsed.error.flatten() } });
    return;
  }
  const ctx = connector(req);
  const employee = await supabase
    .from('employees')
    .select('id')
    .eq('public_uuid', parsed.data.hrpulseEmployeeUuid)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  if (employee.error || !employee.data) {
    res.status(404).json({ error: { code: 'employee_mapping_not_found', message: 'Employee is not mapped' } });
    return;
  }
  const documentUuid = randomUUID();
  const safeName = parsed.data.originalFilename.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const storagePath = `${ctx.organizationId}/${parsed.data.hrpulseEmployeeUuid}/${documentUuid}/${safeName}`;
  const signed = await supabase.storage.from('employee-documents-private').createSignedUploadUrl(storagePath);
  if (signed.error) {
    res.status(500).json({ error: { code: 'upload_session_failed', message: signed.error.message } });
    return;
  }
  const inserted = await supabase.from('employee_documents').insert({
    employee_id: employee.data.id,
    public_uuid: documentUuid,
    document_type: parsed.data.documentType,
    original_filename: parsed.data.originalFilename,
    stored_filename: safeName,
    mime_type: parsed.data.mimeType,
    file_size: parsed.data.fileSize,
    file_path: storagePath,
    storage_bucket: 'employee-documents-private',
    storage_path: storagePath,
    sha256: parsed.data.sha256.toLowerCase(),
    source: ctx.connectorKey,
    uploaded_by: ctx.connectorKey,
    scan_status: 'quarantined',
    verification_status: 'pending',
    expiry_date: parsed.data.expiryDate || null,
  });
  if (inserted.error) {
    res.status(500).json({ error: { code: 'document_metadata_failed', message: inserted.error.message } });
    return;
  }
  res.status(201).json({
    data: {
      documentUuid,
      uploadUrl: signed.data.signedUrl,
      uploadToken: signed.data.token,
      expiresInSeconds: 120,
      scanStatus: 'quarantined',
    },
  });
});

router.post('/employee-documents/:documentUuid/complete', async (req: AuthenticatedRequest, res: Response) => {
  const ctx = connector(req);
  const document = await supabase
    .from('employee_documents')
    .select('*, employees!inner(organization_id)')
    .eq('public_uuid', req.params.documentUuid)
    .eq('employees.organization_id', ctx.organizationId)
    .maybeSingle();
  if (document.error || !document.data) {
    res.status(404).json({ error: { code: 'document_not_found', message: 'Document metadata was not found' } });
    return;
  }
  const downloaded = await supabase.storage
    .from(document.data.storage_bucket)
    .download(document.data.storage_path);
  if (downloaded.error || !downloaded.data) {
    res.status(409).json({ error: { code: 'upload_not_complete', message: 'Uploaded file is not available' } });
    return;
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== document.data.sha256 || bytes.length !== Number(document.data.file_size)) {
    await supabase.from('employee_documents').update({ scan_status: 'revoked' }).eq('id', document.data.id);
    res.status(422).json({ error: { code: 'document_integrity_failed', message: 'Size or checksum does not match' } });
    return;
  }
  await supabase.from('employee_documents').update({ scan_status: 'quarantined' }).eq('id', document.data.id);
  await auditIntegration({
    organizationId: ctx.organizationId,
    connectorId: ctx.id,
    actorType: 'connector',
    actorId: ctx.connectorKey,
    action: 'document.upload.completed',
    entityType: 'employee_document',
    entityId: req.params.documentUuid,
    requestId: requestId(req),
  });
  res.status(202).json({ data: { documentUuid: req.params.documentUuid, scanStatus: 'quarantined' } });
});

router.post('/employee-documents/:documentUuid/download-link', async (req: AuthenticatedRequest, res: Response) => {
  const ctx = connector(req);
  const document = await supabase
    .from('employee_documents')
    .select('*, employees!inner(organization_id)')
    .eq('public_uuid', req.params.documentUuid)
    .eq('employees.organization_id', ctx.organizationId)
    .maybeSingle();
  if (document.error || !document.data) {
    res.status(404).json({ error: { code: 'document_not_found', message: 'Document was not found' } });
    return;
  }
  if (document.data.scan_status !== 'clean') {
    res.status(423).json({ error: { code: 'document_quarantined', message: 'Document is not available until malware scanning passes' } });
    return;
  }
  const signed = await supabase.storage
    .from(document.data.storage_bucket)
    .createSignedUrl(document.data.storage_path, 300);
  if (signed.error) {
    res.status(500).json({ error: { code: 'download_link_failed', message: signed.error.message } });
    return;
  }
  res.json({ data: { downloadUrl: signed.data.signedUrl, expiresAt: new Date(Date.now() + 300_000).toISOString() } });
});

export default router;
