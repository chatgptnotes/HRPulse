import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase';

export type HrNotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export type HrNotificationRow = {
  id?: number | string | null;
  employee_id: number;
  employee_email?: string | null;
  email?: string | null;
  notification_key?: string | null;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  severity?: HrNotificationSeverity | string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at?: string | null;
};

export type HrNotificationSyncResult = {
  notification: Record<string, unknown>;
  adamritSynced: boolean;
  adamritWarning?: string;
};

function isMissingNotificationTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /hr_notifications|schema cache|does not exist/i.test(message);
}

function isMissingConflictConstraint(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || '');
  return /no unique or exclusion constraint matching the ON CONFLICT specification/i.test(message);
}

function notificationDbRow(row: HrNotificationRow) {
  const { employee_email: _employeeEmail, email: _email, ...dbRow } = row;
  return dbRow;
}

function notificationForPush(saved: Record<string, unknown> | null | undefined, original: HrNotificationRow): HrNotificationRow {
  return {
    ...original,
    ...(saved || {}),
    employee_email: original.employee_email || original.email || null,
  } as HrNotificationRow;
}

async function pushWithoutLocalNotificationTable(row: HrNotificationRow): Promise<HrNotificationSyncResult> {
  const notification = {
    ...row,
    id: row.id || row.notification_key || `hrpulse:${row.employee_id}:${Date.now()}`,
    created_at: row.created_at || new Date().toISOString(),
  };
  const sync = await pushNotificationToAdamrit(notification as HrNotificationRow);
  return {
    notification,
    adamritSynced: sync.synced,
    adamritWarning: sync.warning || 'HRPulse hr_notifications table is not installed; pushed directly to Adamrit',
  };
}

function adamritNotificationWebhookUrl() {
  return (process.env.ADAMRIT_HR_NOTIFICATIONS_URL || '').trim();
}

function adamritNotificationWebhookToken() {
  return (
    process.env.ADAMRIT_HR_NOTIFICATIONS_TOKEN ||
    process.env.HRPULSE_NOTIFICATION_WEBHOOK_TOKEN ||
    process.env.HRPULSE_ESS_TOKEN ||
    ''
  ).trim();
}

async function employeeEmailForNotification(row: HrNotificationRow) {
  if (row.employee_email || row.email) return String(row.employee_email || row.email).trim().toLowerCase();
  const employeeId = Number(row.employee_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return '';
  const { data } = await supabase.from('employees').select('email').eq('id', employeeId).maybeSingle();
  return String(data?.email || '').trim().toLowerCase();
}

export async function pushNotificationToAdamrit(row: HrNotificationRow) {
  const url = adamritNotificationWebhookUrl();
  const token = adamritNotificationWebhookToken();
  if (!url || !token) return { synced: false, warning: 'Adamrit notification webhook is not configured' };

  const employeeEmail = await employeeEmailForNotification(row);
  if (!employeeEmail) return { synced: false, warning: 'Employee email is required for Adamrit notification sync' };

  const sourceEventId = String(
    row.notification_key ? `hrpulse:${row.employee_id}:${row.notification_key}` : row.id ? `hrpulse:${row.id}` : '',
  );
  if (!sourceEventId) return { synced: false, warning: 'Notification source event id is missing' };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        employee_email: employeeEmail,
        hrpulse_employee_id: row.employee_id == null ? null : String(row.employee_id),
        source_event_id: sourceEventId,
        type: row.type || 'hrpulse_notification',
        title: row.title || 'HRPulse notification',
        message: row.body || row.message || '',
        severity: row.severity || 'info',
        metadata: {
          ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
          hrpulseNotificationId: row.id || null,
          notificationKey: row.notification_key || null,
          source: row.source || 'hrpulse',
        },
      }),
    });
    if (!response.ok) {
      return { synced: false, warning: `Adamrit notification sync failed: ${response.status}` };
    }
    return { synced: true };
  } catch (error) {
    return {
      synced: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function insertHrNotification(row: HrNotificationRow): Promise<HrNotificationSyncResult> {
  const { data, error } = await supabase.from('hr_notifications').insert(notificationDbRow(row)).select('*').single();
  if (error) {
    if (isMissingNotificationTable(error.message)) return pushWithoutLocalNotificationTable(row);
    throw new Error(error.message);
  }
  const notification = notificationForPush(data, row);
  const sync = await pushNotificationToAdamrit(notification);
  return { notification, adamritSynced: sync.synced, adamritWarning: sync.warning };
}

export async function upsertHrNotification(row: HrNotificationRow): Promise<HrNotificationSyncResult> {
  const { data, error } = await supabase
    .from('hr_notifications')
    .upsert(notificationDbRow(row), { onConflict: 'employee_id,notification_key' })
    .select('*')
    .single();
  if (error) {
    if (isMissingNotificationTable(error.message)) return pushWithoutLocalNotificationTable(row);
    if (isMissingConflictConstraint(error)) {
      if (row.notification_key) {
        const { error: deleteError } = await supabase
          .from('hr_notifications')
          .delete()
          .eq('employee_id', row.employee_id)
          .eq('notification_key', row.notification_key);
        if (deleteError) throw new Error(deleteError.message);
      }

      const inserted = await insertHrNotification(row);
      return {
        ...inserted,
        adamritWarning: inserted.adamritWarning || 'HRPulse notification upsert constraint is missing; used replace-insert compatibility mode',
      };
    }
    throw new Error(error.message);
  }
  const notification = notificationForPush(data, row);
  const sync = await pushNotificationToAdamrit(notification);
  return { notification, adamritSynced: sync.synced, adamritWarning: sync.warning };
}

export async function updateHrNotificationAndPush(
  notificationId: number | string,
  row: Omit<HrNotificationRow, 'employee_id'> & { employee_id?: number },
): Promise<HrNotificationSyncResult> {
  const { data, error } = await supabase
    .from('hr_notifications')
    .update(notificationDbRow(row as HrNotificationRow))
    .eq('id', notificationId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const notification = notificationForPush(data, row as HrNotificationRow);
  const sync = await pushNotificationToAdamrit(notification);
  return { notification, adamritSynced: sync.synced, adamritWarning: sync.warning };
}

export async function sendManualHrNotification(input: {
  employeeId: number;
  type?: string;
  title: string;
  body: string;
  severity?: HrNotificationSeverity;
  sentBy?: string;
}) {
  const { data: employee, error } = await supabase
    .from('employees')
    .select('id, name, email, employee_number')
    .eq('id', input.employeeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!employee) throw new Error('Employee not found');
  if (!String(employee.email || '').trim()) {
    throw new Error('Employee email is required for Adamrit notification sync');
  }

  return insertHrNotification({
    employee_id: input.employeeId,
    employee_email: String(employee.email).trim().toLowerCase(),
    notification_key: `manual:${input.employeeId}:${Date.now()}:${randomUUID().slice(0, 8)}`,
    type: input.type || 'personal',
    title: input.title,
    body: input.body,
    severity: input.severity || 'info',
    source: 'hrpulse_manual',
    metadata: {
      sentBy: input.sentBy || 'HR Admin',
      employeeName: employee.name || '',
      employeeNumber: employee.employee_number || '',
    },
    read_at: null,
    created_at: new Date().toISOString(),
  });
}
