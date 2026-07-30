import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase';

export type ConnectorContext = {
  id: string;
  connectorKey: string;
  organizationId: string;
  status: string;
  baseUrl: string | null;
  settings: Record<string, unknown>;
  inboundHmacEnv?: string | null;
};

export type DailyAttendanceInput = {
  sourceRecordId: string;
  hrpulseEmployeeUuid: string;
  workDate: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  timezone: string;
  shiftType?: string | null;
  status: string;
  notes?: string | null;
  sourceVersion: number;
  sourceUpdatedAt: string;
  reversed?: boolean;
};

export function integrationEnvelope(input: {
  eventUuid?: string;
  eventType: string;
  entityUuid?: string | null;
  sourceSystem?: string;
  destinationSystem?: string;
  organizationId?: string | null;
  data: Record<string, unknown>;
}) {
  return {
    event_uuid: input.eventUuid || randomUUID(),
    event_type: input.eventType,
    event_version: 1,
    entity_uuid: input.entityUuid || null,
    source_system: input.sourceSystem || 'hrpulse',
    destination_system: input.destinationSystem || 'hims',
    organization_id: input.organizationId || null,
    occurred_at: new Date().toISOString(),
    data: input.data,
  };
}

export async function enqueueConnectorEvent(input: {
  connectorId: string;
  eventType: string;
  entityUuid?: string | null;
  organizationId?: string | null;
  data: Record<string, unknown>;
  eventUuid?: string;
}) {
  const envelope = integrationEnvelope(input);
  const { data, error } = await supabase
    .from('integration_outbox_events')
    .insert({
      connector_id: input.connectorId,
      event_uuid: envelope.event_uuid,
      event_type: input.eventType,
      event_version: 1,
      entity_uuid: input.entityUuid || null,
      payload: envelope,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function enqueueForActiveConnectors(input: {
  organizationId?: string | null;
  eventType: string;
  entityUuid?: string | null;
  data: Record<string, unknown>;
}) {
  let query = supabase
    .from('integration_connectors')
    .select('id, organization_id')
    .in('status', ['shadow', 'active']);
  if (input.organizationId) query = query.eq('organization_id', input.organizationId);
  const { data: connectors, error } = await query;
  if (error) throw new Error(error.message);
  return Promise.all((connectors || []).map((connector: any) => enqueueConnectorEvent({
    connectorId: connector.id,
    eventType: input.eventType,
    entityUuid: input.entityUuid,
    organizationId: connector.organization_id,
    data: input.data,
  })));
}

export async function recordInboxEvent(
  connector: ConnectorContext,
  envelope: {
    event_uuid: string;
    event_type: string;
    event_version?: number;
    entity_uuid?: string | null;
    occurred_at: string;
    data?: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase
    .from('integration_inbox_events')
    .insert({
      connector_id: connector.id,
      event_uuid: envelope.event_uuid,
      event_type: envelope.event_type,
      event_version: envelope.event_version || 1,
      entity_uuid: envelope.entity_uuid || null,
      occurred_at: envelope.occurred_at,
      payload: envelope,
      status: 'received',
    })
    .select('*')
    .single();
  if (!error) return { row: data, duplicate: false };
  if (/duplicate key|unique constraint/i.test(error.message || '')) {
    const existing = await supabase
      .from('integration_inbox_events')
      .select('*')
      .eq('connector_id', connector.id)
      .eq('event_uuid', envelope.event_uuid)
      .single();
    return { row: existing.data, duplicate: true };
  }
  throw new Error(error.message);
}

async function monthlyHimsUpload(connector: ConnectorContext, month: string) {
  const existing = await supabase
    .from('attendance_uploads')
    .select('*')
    .eq('connector_id', connector.id)
    .eq('period_month', month)
    .eq('source_type', 'hims_daily')
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data;
  const inserted = await supabase
    .from('attendance_uploads')
    .insert({
      filename: `Adamrit daily sync ${month}`,
      period_month: month,
      row_count: 0,
      status: 'processed',
      uploaded_by: connector.connectorKey,
      source_type: 'hims_daily',
      connector_id: connector.id,
    })
    .select('*')
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data;
}

function timePart(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function canonicalAttendanceStatus(value: string, reversed?: boolean) {
  if (reversed) return 'Not Attempted';
  const status = value.trim().toLowerCase();
  if (status === 'absent') return 'Absent';
  if (status === 'half_day' || status === 'half day') return 'Half Day';
  if (status === 'on_leave' || status === 'leave') return 'Paid Leave';
  if (status === 'weekly_off' || status === 'weekly off') return 'Weekly Off';
  if (status === 'holiday') return 'Holiday';
  if (status === 'missing_punch' || status === 'missing punch') return 'Missing Punch';
  if (status === 'late' || status === 'late coming') return 'Late Coming';
  return 'Present';
}

export async function ingestDailyAttendance(connector: ConnectorContext, input: DailyAttendanceInput) {
  const employeeResult = await supabase
    .from('employees')
    .select('id, public_uuid, organization_id')
    .eq('public_uuid', input.hrpulseEmployeeUuid)
    .eq('organization_id', connector.organizationId)
    .maybeSingle();
  if (employeeResult.error) throw new Error(employeeResult.error.message);
  if (!employeeResult.data) {
    return { status: 'rejected', code: 'employee_mapping_not_found', sourceRecordId: input.sourceRecordId };
  }

  const employee = employeeResult.data;
  const existingResult = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('record_date', input.workDate)
    .maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data;
  const incomingUpdated = Date.parse(input.sourceUpdatedAt);
  const existingUpdated = Date.parse(existing?.source_updated_at || '1970-01-01T00:00:00Z');
  if (existing && Number.isFinite(existingUpdated) && existingUpdated > incomingUpdated) {
    return { status: 'ignored_stale', sourceRecordId: input.sourceRecordId, attendanceRecordId: existing.id };
  }
  if (existing && existing.source_version === input.sourceVersion && existing.source_record_id === input.sourceRecordId) {
    return { status: 'duplicate', sourceRecordId: input.sourceRecordId, attendanceRecordId: existing.id };
  }

  if (existing) {
    const revision = await supabase.from('attendance_record_revisions').insert({
      attendance_record_id: existing.id,
      employee_id: existing.employee_id,
      record_date: existing.record_date,
      connector_id: existing.connector_id,
      source_type: existing.source_type || 'excel',
      source_record_id: existing.source_record_id,
      source_version: existing.source_version || 1,
      source_updated_at: existing.source_updated_at || new Date(0).toISOString(),
      record_snapshot: existing,
      replaced_by_source: connector.connectorKey,
    });
    if (revision.error) throw new Error(revision.error.message);
  }

  const upload = await monthlyHimsUpload(connector, input.workDate.slice(0, 7));
  const payload = {
    upload_id: upload.id,
    employee_id: employee.id,
    record_date: input.workDate,
    status: canonicalAttendanceStatus(input.status, input.reversed),
    time_in: input.reversed ? null : timePart(input.checkInAt),
    time_out: input.reversed ? null : timePart(input.checkOutAt),
    connector_id: connector.id,
    source_type: 'hims_daily',
    source_record_id: input.sourceRecordId,
    source_version: input.sourceVersion,
    source_updated_at: input.sourceUpdatedAt,
    is_reversed: input.reversed === true,
  };
  const saved = await supabase
    .from('attendance_records')
    .upsert(payload, { onConflict: 'employee_id,record_date' })
    .select('*')
    .single();
  if (saved.error) throw new Error(saved.error.message);

  const count = await supabase
    .from('attendance_records')
    .select('id', { count: 'exact', head: true })
    .eq('upload_id', upload.id);
  await supabase.from('attendance_uploads').update({ row_count: count.count || 0 }).eq('id', upload.id);

  return {
    status: existing ? 'updated' : 'accepted',
    sourceRecordId: input.sourceRecordId,
    attendanceRecordId: saved.data.id,
  };
}

export async function markInboxProcessed(id: number, status: 'processed' | 'failed', errorMessage?: string) {
  const { error } = await supabase
    .from('integration_inbox_events')
    .update({
      status,
      error_message: errorMessage || null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function auditIntegration(input: {
  organizationId?: string | null;
  connectorId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}) {
  await supabase.from('integration_audit_logs').insert({
    organization_id: input.organizationId || null,
    connector_id: input.connectorId || null,
    actor_type: input.actorType,
    actor_id: input.actorId || null,
    action: input.action,
    entity_type: input.entityType || null,
    entity_id: input.entityId || null,
    request_id: input.requestId || null,
    details: input.details || {},
  });
}
