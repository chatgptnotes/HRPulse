import { Router, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../db/supabase';
import { AuthenticatedRequest, requireRoles } from '../middleware/auth';
import { auditIntegration, enqueueConnectorEvent } from '../services/connectorService';

const router = Router();

const connectorUpdateSchema = z.object({
  status: z.enum(['disabled', 'shadow', 'active', 'error']).optional(),
  baseUrl: z.string().url().nullable().optional(),
  pollIntervalSeconds: z.coerce.number().int().min(60).max(86400).optional(),
});

const mappingSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  externalEmployeeId: z.string().trim().min(1).max(200),
  externalUserId: z.string().trim().max(200).nullable().optional(),
  externalEmployeeNumber: z.string().trim().max(120).nullable().optional(),
});

router.get('/overview', async (_req: AuthenticatedRequest, res: Response) => {
  const connectors = await supabase
    .from('integration_connectors')
    .select('*, organizations(code, name, timezone)')
    .order('display_name');
  if (connectors.error) {
    res.status(500).json({ error: connectors.error.message });
    return;
  }

  const rows = await Promise.all((connectors.data || []).map(async (connector: any) => {
    const [mappings, pending, dead, failedInbox] = await Promise.all([
      supabase.from('employee_integration_mappings').select('id', { count: 'exact', head: true }).eq('connector_id', connector.id),
      supabase.from('integration_outbox_events').select('id', { count: 'exact', head: true }).eq('connector_id', connector.id).in('status', ['pending', 'retry', 'processing']),
      supabase.from('integration_outbox_events').select('id', { count: 'exact', head: true }).eq('connector_id', connector.id).eq('status', 'dead_letter'),
      supabase.from('integration_inbox_events').select('id', { count: 'exact', head: true }).eq('connector_id', connector.id).eq('status', 'failed'),
    ]);
    return {
      id: connector.id,
      connectorKey: connector.connector_key,
      displayName: connector.display_name,
      status: connector.status,
      baseUrl: connector.base_url,
      pollIntervalSeconds: connector.poll_interval_seconds,
      lastSuccessAt: connector.last_success_at,
      lastErrorAt: connector.last_error_at,
      lastError: connector.last_error,
      organization: connector.organizations,
      counts: {
        mappings: mappings.count || 0,
        pending: pending.count || 0,
        deadLetters: dead.count || 0,
        failedInbound: failedInbox.count || 0,
      },
    };
  }));
  res.json({ connectors: rows });
});

router.patch('/connectors/:connectorKey', requireRoles('super_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = connectorUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.baseUrl !== undefined) update.base_url = parsed.data.baseUrl;
  if (parsed.data.pollIntervalSeconds !== undefined) update.poll_interval_seconds = parsed.data.pollIntervalSeconds;
  const saved = await supabase
    .from('integration_connectors')
    .update(update)
    .eq('connector_key', req.params.connectorKey)
    .select('*')
    .maybeSingle();
  if (saved.error || !saved.data) {
    res.status(404).json({ error: saved.error?.message || 'Connector not found' });
    return;
  }
  await auditIntegration({
    organizationId: saved.data.organization_id,
    connectorId: saved.data.id,
    actorType: 'hr_user',
    actorId: req.hrActor?.authUserId,
    action: 'connector.updated',
    entityType: 'integration_connector',
    entityId: saved.data.id,
    details: parsed.data,
  });
  res.json(saved.data);
});

router.get('/connectors/:connectorKey/mappings', async (req: AuthenticatedRequest, res: Response) => {
  const result = await supabase
    .from('employee_integration_mappings')
    .select('*, integration_connectors!inner(connector_key), employees(id, public_uuid, employee_number, name, email, status)')
    .eq('integration_connectors.connector_key', req.params.connectorKey)
    .order('updated_at', { ascending: false });
  if (result.error) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.json(result.data || []);
});

router.put('/connectors/:connectorKey/mappings', requireRoles('super_admin', 'hr_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = mappingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const connector = await supabase.from('integration_connectors').select('*').eq('connector_key', req.params.connectorKey).maybeSingle();
  if (connector.error || !connector.data) {
    res.status(404).json({ error: 'Connector not found' });
    return;
  }
  const employee = await supabase.from('employees').select('id, organization_id').eq('id', parsed.data.employeeId).maybeSingle();
  if (!employee.data || employee.data.organization_id !== connector.data.organization_id) {
    res.status(422).json({ error: 'Employee does not belong to the connector organization' });
    return;
  }
  const saved = await supabase.from('employee_integration_mappings').upsert({
    connector_id: connector.data.id,
    employee_id: parsed.data.employeeId,
    external_employee_id: parsed.data.externalEmployeeId,
    external_user_id: parsed.data.externalUserId || null,
    external_employee_number: parsed.data.externalEmployeeNumber || null,
    is_active: true,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'connector_id,employee_id' }).select('*').single();
  if (saved.error) {
    res.status(409).json({ error: saved.error.message });
    return;
  }
  res.json(saved.data);
});

router.post('/connectors/:connectorKey/backfill-employees', requireRoles('super_admin', 'hr_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const connector = await supabase.from('integration_connectors').select('*').eq('connector_key', req.params.connectorKey).maybeSingle();
  if (connector.error || !connector.data) {
    res.status(404).json({ error: 'Connector not found' });
    return;
  }
  if (!['shadow', 'active'].includes(connector.data.status)) {
    res.status(409).json({ error: 'Enable shadow mode before queuing an employee backfill' });
    return;
  }
  const employees = await supabase
    .from('employees')
    .select('*')
    .eq('organization_id', connector.data.organization_id)
    .order('id');
  if (employees.error) {
    res.status(500).json({ error: employees.error.message });
    return;
  }
  let queued = 0;
  for (const employee of employees.data || []) {
    if (!employee.public_uuid) continue;
    await enqueueConnectorEvent({
      connectorId: connector.data.id,
      eventType: String(employee.status || 'Active').toLowerCase() === 'inactive' ? 'employee.deactivated' : 'employee.created',
      entityUuid: employee.public_uuid,
      organizationId: connector.data.organization_id,
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
    queued++;
  }
  res.status(202).json({ connectorKey: req.params.connectorKey, queued });
});

router.get('/events', async (req: AuthenticatedRequest, res: Response) => {
  const status = String(req.query.status || '').trim();
  const direction = String(req.query.direction || 'outbound');
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const table = direction === 'inbound' ? 'integration_inbox_events' : 'integration_outbox_events';
  let query = supabase.from(table).select('*, integration_connectors(connector_key, display_name)').order('created_at', { ascending: false }).limit(limit);
  if (direction === 'inbound') query = supabase.from(table).select('*, integration_connectors(connector_key, display_name)').order('received_at', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  const result = await query;
  if (result.error) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.json(result.data || []);
});

router.post('/events/:id/retry', requireRoles('super_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const id = Number(req.params.id);
  const saved = await supabase
    .from('integration_outbox_events')
    .update({ status: 'retry', next_attempt_at: new Date().toISOString(), locked_at: null, last_error: null })
    .eq('id', id)
    .in('status', ['dead_letter', 'retry', 'failed'])
    .select('*')
    .maybeSingle();
  if (saved.error || !saved.data) {
    res.status(409).json({ error: saved.error?.message || 'Event cannot be retried' });
    return;
  }
  res.json(saved.data);
});

export default router;
