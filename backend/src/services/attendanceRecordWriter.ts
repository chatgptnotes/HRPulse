import { supabase } from '../db/supabase';

export type AttendanceRecordWriteRow = {
  upload_id: number;
  employee_id: number;
  record_date: string;
  status: string;
  time_in: string | null;
  time_out: string | null;
};

function isMissingConflictConstraint(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || error || '');
  return /no unique or exclusion constraint matching the ON CONFLICT specification/i.test(message);
}

function uniqueRows(rows: AttendanceRecordWriteRow[]) {
  const byEmployeeDate = new Map<string, AttendanceRecordWriteRow>();
  for (const row of rows) {
    byEmployeeDate.set(`${row.employee_id}:${row.record_date}`, row);
  }
  return [...byEmployeeDate.values()];
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
  const batch = uniqueRows(rows);
  if (!batch.length) return { count: 0, usedCompatibilityMode: false };

  const { error } = await supabase
    .from('attendance_records')
    .upsert(batch, { onConflict: 'employee_id,record_date' });

  if (!error) return { count: batch.length, usedCompatibilityMode: false };
  if (!isMissingConflictConstraint(error)) throw new Error(error.message);

  await replaceRowsByEmployeeDate(batch);
  return { count: batch.length, usedCompatibilityMode: true };
}
