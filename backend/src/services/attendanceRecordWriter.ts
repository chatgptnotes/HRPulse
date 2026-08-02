import { supabase } from '../db/supabase';

export type AttendanceRecordWriteRow = {
  upload_id: number;
  employee_id: number;
  record_date: string;
  status: string;
  time_in: string | null;
  time_out: string | null;
  connector_id?: string | null;
  source_type?: string;
  source_record_id?: string | null;
  source_version?: number;
  source_updated_at?: string;
  is_reversed?: boolean;
};

function isMissingConflictConstraint(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || '');
  return /no unique or exclusion constraint matching the ON CONFLICT specification/i.test(message);
}

function isMissingEnhancementColumn(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || '');
  return /connector_id|source_type|source_record_id|source_version|source_updated_at|is_reversed/i.test(message)
    && /attendance_records|schema cache|column|does not exist|could not find/i.test(message);
}

function legacyRows(rows: AttendanceRecordWriteRow[]) {
  return rows.map(row => ({
    upload_id: row.upload_id,
    employee_id: row.employee_id,
    record_date: row.record_date,
    status: row.status,
    time_in: row.time_in,
    time_out: row.time_out,
  }));
}

function uniqueRows(rows: AttendanceRecordWriteRow[]) {
  const byEmployeeDate = new Map<string, AttendanceRecordWriteRow>();
  for (const row of rows) {
    byEmployeeDate.set(`${row.employee_id}:${row.record_date}`, row);
  }
  return [...byEmployeeDate.values()];
}

let legacyAttendanceSchema: boolean | null = null;

async function usesLegacyAttendanceSchema() {
  if (legacyAttendanceSchema != null) return legacyAttendanceSchema;
  const probe = await supabase.from('attendance_records')
    .select('id, connector_id, source_type, source_record_id, source_version, source_updated_at, is_reversed')
    .limit(1);
  if (!probe.error) {
    legacyAttendanceSchema = false;
    return false;
  }
  if (isMissingEnhancementColumn(probe.error)) {
    legacyAttendanceSchema = true;
    return true;
  }
  throw new Error(probe.error.message);
}

async function writeLegacyBatch(rows: AttendanceRecordWriteRow[]) {
  const compatibleBatch = legacyRows(rows);
  const result = await supabase.from('attendance_records')
    .upsert(compatibleBatch, { onConflict: 'employee_id,record_date' });
  if (!result.error) return { count: compatibleBatch.length, usedCompatibilityMode: true };
  if (!isMissingConflictConstraint(result.error)) throw new Error(result.error.message);
  await replaceRowsByEmployeeDate(compatibleBatch);
  return { count: compatibleBatch.length, usedCompatibilityMode: true };
}

async function replaceRowsByEmployeeDate(rows: AttendanceRecordWriteRow[]) {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const ids = byDate.get(row.record_date) || [];
    ids.push(row.employee_id);
    byDate.set(row.record_date, ids);
  }

  for (const [date, ids] of byDate) {
    const uniqueIds = [...new Set(ids)];
    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .eq('record_date', date)
      .in('employee_id', uniqueIds);
    if (error) throw new Error(error.message);
  }

  const { error } = await supabase.from('attendance_records').insert(rows);
  if (error) throw new Error(error.message);
}

export async function writeAttendanceRecordBatch(rows: AttendanceRecordWriteRow[]) {
  const now = new Date().toISOString();
  const batch = uniqueRows(rows).map(row => ({
    ...row,
    connector_id: row.connector_id || null,
    source_type: row.source_type || 'excel',
    source_record_id: row.source_record_id || `excel:${row.upload_id}:${row.employee_id}:${row.record_date}`,
    source_version: row.source_version || 1,
    source_updated_at: row.source_updated_at || now,
    is_reversed: row.is_reversed === true,
  }));
  if (!batch.length) return { count: 0, usedCompatibilityMode: false };
  if (await usesLegacyAttendanceSchema()) return writeLegacyBatch(batch);

  const employeeIds = [...new Set(batch.map(row => row.employee_id))];
  const dates = [...new Set(batch.map(row => row.record_date))];
  const existingResult = await supabase
    .from('attendance_records')
    .select('*')
    .in('employee_id', employeeIds)
    .in('record_date', dates);
  if (!existingResult.error && existingResult.data?.length) {
    const incomingKeys = new Set(batch.map(row => `${row.employee_id}:${row.record_date}`));
    const revisions = existingResult.data
      .filter((row: any) => incomingKeys.has(`${row.employee_id}:${row.record_date}`))
      .map((row: any) => ({
        attendance_record_id: row.id,
        employee_id: row.employee_id,
        record_date: row.record_date,
        connector_id: row.connector_id || null,
        source_type: row.source_type || 'excel',
        source_record_id: row.source_record_id || null,
        source_version: row.source_version || 1,
        source_updated_at: row.source_updated_at || new Date(0).toISOString(),
        record_snapshot: row,
        replaced_by_source: 'excel',
      }));
    if (revisions.length) {
      const savedRevisions = await supabase.from('attendance_record_revisions').insert(revisions);
      if (savedRevisions.error && !/attendance_record_revisions|does not exist|schema cache/i.test(savedRevisions.error.message || '')) {
        throw new Error(savedRevisions.error.message);
      }
    }
  }

  const { error } = await supabase
    .from('attendance_records')
    .upsert(batch, { onConflict: 'employee_id,record_date' });

  if (!error) return { count: batch.length, usedCompatibilityMode: false };
  if (isMissingEnhancementColumn(error)) {
    legacyAttendanceSchema = true;
    return writeLegacyBatch(batch);
  }
  if (!isMissingConflictConstraint(error)) throw new Error(error.message);

  await replaceRowsByEmployeeDate(batch);
  return { count: batch.length, usedCompatibilityMode: true };
}
