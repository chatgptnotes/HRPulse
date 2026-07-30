import { createHmac, randomUUID } from 'crypto';
import { supabase } from '../db/supabase';
import { ConnectorContext, enqueueForActiveConnectors, ingestDailyAttendance } from '../services/connectorService';

const RETRY_SECONDS = [0, 60, 300, 900, 3600, 21600, 86400];

function connectorToken(connector: any) {
  const envName = String(connector.outbound_token_env || '');
  return envName ? String(process.env[envName] || '') : '';
}

function connectorHmacSecret(connector: any) {
  const envName = String(connector.outbound_hmac_env || '');
  return envName ? String(process.env[envName] || '') : '';
}

function deliveryTarget(event: any) {
  const entity = String(event.entity_uuid || event.payload?.entity_uuid || '');
  switch (event.event_type) {
    case 'employee.created':
      return { method: 'POST', path: '/api/integrations/hrpulse/v1/employees' };
    case 'employee.updated':
      return { method: 'PUT', path: `/api/integrations/hrpulse/v1/employees/${entity}` };
    case 'employee.deactivated':
      return { method: 'POST', path: `/api/integrations/hrpulse/v1/employees/${entity}/deactivate` };
    case 'leave.request.submitted':
      return { method: 'POST', path: '/api/integrations/hrpulse/v1/leave-requests' };
    case 'leave.request.cancelled':
      return { method: 'POST', path: `/api/integrations/hrpulse/v1/leave-requests/${entity}/cancel` };
    case 'leave.request.approved':
    case 'leave.request.rejected':
      return { method: 'POST', path: `/api/integrations/hrpulse/v1/leave-requests/${entity}/decision` };
    case 'leave.balance.updated':
      return { method: 'PUT', path: `/api/integrations/hrpulse/v1/employees/${entity}/leave-balances` };
    case 'payroll.finalized':
      return { method: 'POST', path: '/api/integrations/hrpulse/v1/payroll-runs' };
    case 'document.uploaded':
    case 'document.metadata.updated':
      return { method: 'POST', path: '/api/integrations/hrpulse/v1/employee-documents' };
    default:
      return null;
  }
}

async function completeDelivery(event: any, connector: any, result: {
  requestUrl: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  retryable: boolean;
}) {
  const attemptNumber = Number(event.attempt_count || 0) + 1;
  await supabase.from('integration_delivery_attempts').insert({
    outbox_event_id: event.id,
    attempt_number: attemptNumber,
    request_url: result.requestUrl,
    response_status: result.responseStatus || null,
    response_body: result.responseBody?.slice(0, 10_000) || null,
    error_message: result.error || null,
    finished_at: new Date().toISOString(),
  });

  if (!result.error && result.responseStatus && result.responseStatus >= 200 && result.responseStatus < 300 && result.responseStatus !== 207) {
    await supabase.from('integration_outbox_events').update({
      status: 'delivered',
      attempt_count: attemptNumber,
      delivered_at: new Date().toISOString(),
      locked_at: null,
      last_error: null,
    }).eq('id', event.id);
    await supabase.from('integration_connectors').update({
      last_success_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', connector.id);
    return;
  }

  const exhausted = !result.retryable || attemptNumber >= RETRY_SECONDS.length;
  const delay = RETRY_SECONDS[Math.min(attemptNumber, RETRY_SECONDS.length - 1)];
  const message = result.error || `HTTP ${result.responseStatus}: ${result.responseBody || 'delivery failed'}`;
  await supabase.from('integration_outbox_events').update({
    status: exhausted ? 'dead_letter' : 'retry',
    attempt_count: attemptNumber,
    next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
    locked_at: null,
    last_error: message.slice(0, 4000),
  }).eq('id', event.id);
  await supabase.from('integration_connectors').update({
    last_error_at: new Date().toISOString(),
    last_error: message.slice(0, 1000),
  }).eq('id', connector.id);
}

async function deliverEvent(event: any) {
  const connectorResult = await supabase.from('integration_connectors').select('*').eq('id', event.connector_id).maybeSingle();
  const connector = connectorResult.data;
  const target = deliveryTarget(event);
  if (!connector || !target || !connector.base_url || !['shadow', 'active'].includes(connector.status)) {
    await completeDelivery(event, connector || { id: event.connector_id }, {
      requestUrl: connector?.base_url || '',
      error: !target ? `Unsupported event type ${event.event_type}` : 'Connector is disabled or missing base URL',
      retryable: false,
    });
    return;
  }
  const body = JSON.stringify(event.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hmacSecret = connectorHmacSecret(connector);
  const signature = hmacSecret
    ? createHmac('sha256', hmacSecret).update(`${timestamp}.${body}`).digest('hex')
    : '';
  const url = `${String(connector.base_url).replace(/\/$/, '')}${target.path}`;
  try {
    const response = await fetch(url, {
      method: target.method,
      headers: {
        Authorization: `Bearer ${connectorToken(connector)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': String(event.event_uuid),
        'X-HRPulse-Event-Id': String(event.event_uuid),
        'X-HRPulse-Timestamp': timestamp,
        'X-HRPulse-Mode': connector.status,
        ...(signature ? { 'X-HRPulse-Signature': `v1=${signature}` } : {}),
      },
      body,
    });
    const responseBody = await response.text();
    if (response.ok && ['employee.created', 'employee.updated'].includes(event.event_type)) {
      try {
        const parsed = JSON.parse(responseBody || '{}');
        const external = parsed.data || parsed;
        const employeeUuid = String(event.entity_uuid || event.payload?.entity_uuid || '');
        const employee = await supabase.from('employees').select('id').eq('public_uuid', employeeUuid).maybeSingle();
        if (employee.data && external.hims_employee_id) {
          await supabase.from('employee_integration_mappings').upsert({
            connector_id: connector.id,
            employee_id: employee.data.id,
            external_employee_id: String(external.hims_employee_id),
            external_user_id: external.hims_user_id ? String(external.hims_user_id) : null,
            external_employee_number: external.employee_number ? String(external.employee_number) : null,
            source_version: Number(event.payload?.data?.version || 1),
            is_active: true,
            last_synced_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'connector_id,employee_id' });
        }
      } catch {
        // A valid receiver may acknowledge with an empty body. Reconciliation
        // will surface the missing mapping instead of failing an otherwise
        // accepted delivery.
      }
    }
    await completeDelivery(event, connector, {
      requestUrl: url,
      responseStatus: response.status,
      responseBody,
      retryable: response.status === 207 || response.status === 429 || response.status >= 500,
    });
  } catch (error) {
    await completeDelivery(event, connector, {
      requestUrl: url,
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }
}

async function processOutbox() {
  const claimed = await supabase.rpc('claim_integration_outbox_events', { batch_size: 25 });
  if (claimed.error) throw new Error(claimed.error.message);
  for (const event of claimed.data || []) await deliverEvent(event);
}

async function pollAttendanceConnector(connector: any) {
  if (connector.status !== 'active' || !connector.base_url) return;
  const checkpoint = await supabase
    .from('integration_checkpoints')
    .select('*')
    .eq('connector_id', connector.id)
    .eq('domain', 'attendance_daily')
    .maybeSingle();
  const query = new URLSearchParams({ limit: '500' });
  if (checkpoint.data?.cursor_value) query.set('cursor', checkpoint.data.cursor_value);
  else {
    const now = new Date();
    const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    query.set('updated_since', checkpoint.data?.watermark_at || previousMonthStart.toISOString());
  }
  const url = `${String(connector.base_url).replace(/\/$/, '')}/api/integrations/hrpulse/v1/attendance-records?${query}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${connectorToken(connector)}`,
      'X-HRPulse-Request-Id': randomUUID(),
    },
  });
  if (!response.ok) throw new Error(`Attendance poll failed: ${response.status}`);
  const payload: any = await response.json();
  const records = payload.data?.records || payload.records || [];
  const context: ConnectorContext = {
    id: connector.id,
    connectorKey: connector.connector_key,
    organizationId: connector.organization_id,
    status: connector.status,
    baseUrl: connector.base_url,
    settings: connector.settings || {},
  };
  for (const record of records) await ingestDailyAttendance(context, record);
  await supabase.from('integration_checkpoints').upsert({
    connector_id: connector.id,
    domain: 'attendance_daily',
    cursor_value: payload.data?.nextCursor || payload.nextCursor || checkpoint.data?.cursor_value || null,
    watermark_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'connector_id,domain' });
}

async function pollAttendance() {
  const connectors = await supabase.from('integration_connectors').select('*').eq('status', 'active');
  if (connectors.error) throw new Error(connectors.error.message);
  for (const connector of connectors.data || []) {
    try {
      await pollAttendanceConnector(connector);
    } catch (error) {
      await supabase.from('integration_connectors').update({
        last_error_at: new Date().toISOString(),
        last_error: error instanceof Error ? error.message : String(error),
      }).eq('id', connector.id);
    }
  }
}

async function scanDocuments() {
  const scannerUrl = String(process.env.CLAMAV_SCAN_URL || '').trim();
  if (!scannerUrl) return;
  const documents = await supabase
    .from('employee_documents')
    .select('*, employees(public_uuid, organization_id)')
    .eq('scan_status', 'quarantined')
    .not('storage_path', 'is', null)
    .limit(5);
  if (documents.error) throw new Error(documents.error.message);
  for (const document of documents.data || []) {
    await supabase.from('employee_documents').update({ scan_status: 'scanning' }).eq('id', document.id);
    try {
      const file = await supabase.storage.from(document.storage_bucket).download(document.storage_path);
      if (file.error || !file.data) throw new Error(file.error?.message || 'Stored document is missing');
      const bytes = Buffer.from(await file.data.arrayBuffer());
      const response = await fetch(scannerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': encodeURIComponent(document.original_filename),
          ...(process.env.CLAMAV_SCAN_TOKEN ? { Authorization: `Bearer ${process.env.CLAMAV_SCAN_TOKEN}` } : {}),
        },
        body: bytes,
      });
      const result: any = await response.json();
      if (!response.ok) throw new Error(result?.message || `Scanner HTTP ${response.status}`);
      const nextStatus = result.clean === true ? 'clean' : 'infected';
      await supabase.from('employee_documents').update({
        scan_status: nextStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', document.id);
      if (nextStatus === 'clean' && document.employees?.public_uuid) {
        await enqueueForActiveConnectors({
          organizationId: document.employees.organization_id,
          eventType: 'document.uploaded',
          entityUuid: document.public_uuid || document.id,
          data: {
            hrpulse_document_uuid: document.public_uuid || document.id,
            hrpulse_employee_uuid: document.employees.public_uuid,
            document_type: document.document_type,
            original_filename: document.original_filename,
            mime_type: document.mime_type,
            file_size: document.file_size,
            sha256: document.sha256,
            uploaded_at: document.created_at,
            expiry_date: document.expiry_date,
            verification_status: document.verification_status,
            scan_status: 'clean',
            version: Number(document.version || 1),
          },
        });
      }
    } catch (error) {
      await supabase.from('employee_documents').update({
        scan_status: 'scan_failed',
        updated_at: new Date().toISOString(),
      }).eq('id', document.id);
    }
  }
}

export async function runIntegrationWorkerOnce() {
  await processOutbox();
  await pollAttendance();
  await scanDocuments();
}

async function main() {
  const once = process.argv.includes('--once');
  do {
    try {
      await runIntegrationWorkerOnce();
    } catch (error) {
      console.error('[integration-worker]', error instanceof Error ? error.message : error);
    }
    if (!once) await new Promise(resolve => setTimeout(resolve, 15_000));
  } while (!once);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
