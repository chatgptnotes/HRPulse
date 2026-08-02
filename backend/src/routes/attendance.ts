import { Router, Request, Response } from 'express';
import { supabase, getSettings } from '../db/supabase';
import { upload } from '../middleware/upload';
import { parseAttendanceExcel, inspectAttendanceExcel } from '../services/excelParser';
import { calculateLOP } from '../services/lopService';
import { ensureAttendanceAlertNotificationsForUpload } from '../services/attendanceAlertService';
import { writeAttendanceRecordBatch } from '../services/attendanceRecordWriter';
import { syncEmployeesFromExcel } from '../services/employeeExcelImportService';
import { classifyLateAttendanceStatus, isLateArrival, LATE_GRACE_MINUTES } from '../services/latePolicy';

const router = Router();

// PostgREST caps a single SELECT at 1000 rows; page through all records for an
// upload so large sheets (8000+ rows) are returned in full to the UI.
const PAGE = 1000;
function recordMonths(records: Array<{ recordDate?: string }>) {
  return [...new Set(records.map((record) => monthForRecord(record)).filter(Boolean) as string[])].sort();
}

function monthForRecord(record: { recordDate?: string }, fallbackMonth?: string) {
  const month = String(record.recordDate || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(month)) return month;
  return fallbackMonth && /^\d{4}-\d{2}$/.test(fallbackMonth) ? fallbackMonth : null;
}

function groupRecordsByMonth<T extends { recordDate?: string }>(records: T[], fallbackMonth?: string) {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const month = monthForRecord(record, fallbackMonth);
    if (!month) continue;
    const monthRecords = grouped.get(month) || [];
    monthRecords.push(record);
    grouped.set(month, monthRecords);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function fetchAllRecords(uploadId: number, columns = '*'): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select(columns)
      .eq('upload_id', uploadId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// Inspect an Excel file WITHOUT writing to the database.
// Returns raw headers, the column-match report, sample rows, and what the parser
// would extract — so HR can see exactly why a file is/isn't being read.
router.post('/inspect', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  try {
    const report = inspectAttendanceExcel(req.file.buffer);
    res.json(report);
  } catch (err) {
    console.error('[attendance/inspect] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  try {
    const { records, periodMonth, warnings } = parseAttendanceExcel(req.file.buffer);
    if (records.length === 0) { res.status(400).json({ error: 'No valid records found', warnings }); return; }
    const months = recordMonths(records);
    const uploadMonth = months[months.length - 1] || periodMonth;
    const employeeSync = await syncEmployeesFromExcel(records);
    warnings.push(...employeeSync.warnings);

    const { data: uploadRow, error: upErr } = await supabase
      .from('attendance_uploads')
      .insert({ filename: req.file.originalname, period_month: uploadMonth, row_count: records.length })
      .select()
      .single();
    if (upErr) { res.status(500).json({ error: upErr.message }); return; }

    // Link every attendance row to the Employee Master rows synchronized above.
    const recRows: any[] = [];
    for (const r of records) {
      const emp = employeeSync.find(r);
      if (!emp) continue;
      recRows.push({
        upload_id: uploadRow.id,
        employee_id: emp.id,
        record_date: r.recordDate,
        status: classifyLateAttendanceStatus(r.status, r.timeIn || null, emp.shift_start_time || null),
        time_in: r.timeIn || null,
        time_out: r.timeOut || null,
      });
    }

    const recordBatches: any[][] = [];
    for (let i = 0; i < recRows.length; i += 500) recordBatches.push(recRows.slice(i, i + 500));
    let inserted = 0;
    for (let i = 0; i < recordBatches.length; i += 4) {
      const results = await Promise.all(recordBatches.slice(i, i + 4).map(async batch => {
        try { return await writeAttendanceRecordBatch(batch); }
        catch (error) {
          warnings.push(`Record insert batch failed: ${error instanceof Error ? error.message : String(error)}`);
          return { count: 0 };
        }
      }));
      inserted += results.reduce((sum, result) => sum + result.count, 0);
    }
    // Correct the upload row_count to the real inserted count.
    await supabase.from('attendance_uploads').update({ row_count: inserted }).eq('id', uploadRow.id);

    // Alerts are supplementary and can be slow for large workbooks. Generate
    // them after returning the completed attendance import to the browser.
    void ensureAttendanceAlertNotificationsForUpload(uploadRow.id, uploadMonth).catch(alertError => {
      console.error(`Attendance alerts could not be generated for upload ${uploadRow.id}:`, alertError);
    });

    res.json({
      uploadId: uploadRow.id,
      periodMonth: uploadMonth,
      rowCount: inserted,
      employeeCreatedCount: employeeSync.createdCount,
      employeeMatchedCount: employeeSync.matchedExistingCount,
      warnings,
      nameCollisionGroups: employeeSync.nameCollisionGroups,
      attendanceAlerts: { queued: true },
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/uploads', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('attendance_uploads')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data || []).map((u: any) => ({
    id: u.id, filename: u.filename, periodMonth: u.period_month, uploadedAt: u.uploaded_at, rowCount: u.row_count, status: u.status,
  })));
});

router.get('/summary/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const settings = await getSettings();
  const workingDays = parseFloat(settings['working_days'] || '26');
  const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

  let records: any[];
  try {
    records = await fetchAllRecords(uploadId);
  } catch (e: any) {
    res.status(500).json({ error: e.message }); return;
  }

  const employeeIds = [...new Set(records.map((r: any) => r.employee_id))];
  const [{ data: employees }, { data: salaries }, { data: drafts }] = await Promise.all([
    supabase.from('employees').select('*').in('id', employeeIds),
    supabase.from('salary_configs').select('*').in('employee_id', employeeIds),
    supabase.from('email_drafts').select('*').eq('upload_id', uploadId),
  ]);

  const latestSalary: Record<number, any> = {};
  for (const s of (salaries || []) as any[]) {
    const cur = latestSalary[s.employee_id];
    if (!cur || (s.effective_month || '') > (cur.effective_month || '')) latestSalary[s.employee_id] = s;
  }

  const summary = (employees || []).map((emp: any) => {
    let absent = 0, missed = 0, late = 0, early = 0;
    for (const r of records) {
      if (r.employee_id !== emp.id) continue;
      if (r.status === 'Absent') absent++;
      else if (r.status === 'Missed Swipe') missed++;
      else if (r.status === 'Early Leaving') early++;
      if (isLateArrival(r.status, r.time_in, emp.shift_start_time, LATE_GRACE_MINUTES)) late++;
    }
    const flaggedTotal = absent + missed + late + early;
    const salary = latestSalary[emp.id];
    const { lopDays, lopAmount } = salary ? calculateLOP(salary.basic_salary, absent, missed, workingDays, missedSwipeWeight) : { lopDays: 0, lopAmount: 0 };
    const draft = (drafts || []).find((d: any) => d.employee_id === emp.id);
    return {
      employeeId: emp.id, employeeName: emp.name, employeeEmail: emp.email,
      absentDays: absent, missedSwipeDays: missed, lateComingDays: late, earlyLeavingDays: early,
      flaggedTotal, lopDays, lopAmount,
      hasDraft: !!draft, draftStatus: draft?.status || null, draftId: draft?.id || null,
    };
  });

  summary.sort((a: any, b: any) => b.flaggedTotal - a.flaggedTotal);
  res.json(summary);
});

router.get('/records/:uploadId/:employeeId', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('upload_id', parseInt(req.params.uploadId))
    .eq('employee_id', parseInt(req.params.employeeId))
    .order('record_date', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data || []).map((r: any) => ({ id: r.id, recordDate: r.record_date, status: r.status, timeIn: r.time_in, timeOut: r.time_out })));
});

// Full reconstructed grid for an upload: every employee with every day's
// punch in/out, status and working hours. Powers the "Attendance Sheet" view.
function hhmmToMinutes(v: string | null): number | null {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  return (h < 24 && min < 60) ? h * 60 + min : null;
}
function workingHoursFrom(inStr: string | null, outStr: string | null): number {
  const a = hhmmToMinutes(inStr), b = hhmmToMinutes(outStr);
  if (a == null || b == null || b < a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}

router.get('/sheet/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  let records: any[];
  try {
    records = await fetchAllRecords(uploadId, 'employee_id, record_date, status, time_in, time_out');
  } catch (e: any) { res.status(500).json({ error: e.message }); return; }
  // stable date ordering for display
  records.sort((a, b) => (a.record_date < b.record_date ? -1 : a.record_date > b.record_date ? 1 : 0));
  const { data: employees, error: eErr } = await supabase
    .from('employees').select('id, employee_number, name, department, designation');
  if (eErr) { res.status(500).json({ error: eErr.message }); return; }

  const empMap = new Map<number, any>((employees || []).map((e: any) => [e.id, e]));
  const byEmp = new Map<number, any[]>();
  for (const r of records) {
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id)!.push({
      date: r.record_date,
      timeIn: r.time_in || '',
      timeOut: r.time_out || '',
      status: r.status,
      workingHours: workingHoursFrom(r.time_in, r.time_out),
    });
  }

  const sheet = [...byEmp.entries()].map(([empId, days]) => {
    const e = empMap.get(empId) || {};
    return {
      employeeId: empId,
      employeeNumber: e.employee_number || '',
      name: e.name || '',
      department: e.department || '',
      designation: e.designation || '',
      days,
    };
  });
  sheet.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  res.json(sheet);
});

router.delete('/uploads/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const upload = await supabase.from('attendance_uploads').select('*').eq('id', uploadId).maybeSingle();
  if (upload.error || !upload.data) {
    res.status(404).json({ error: 'Upload not found' });
    return;
  }
  if (upload.data.source_type === 'hims_daily') {
    res.status(409).json({ error: 'HIMS attendance is authoritative and cannot be deleted as an upload' });
    return;
  }
  const finalized = await supabase
    .from('payroll_runs')
    .select('id, run_uuid, version')
    .eq('period_month', upload.data.period_month)
    .eq('status', 'finalized')
    .limit(1);
  if (!finalized.error && finalized.data?.length) {
    res.status(409).json({ error: 'This attendance period has finalized payroll. Create a correction version instead of deleting source data.' });
    return;
  }
  await supabase.from('email_drafts').delete().eq('upload_id', uploadId);
  const records = await supabase.from('attendance_records').select('*').eq('upload_id', uploadId);
  for (const record of records.data || []) {
    const revision = await supabase
      .from('attendance_record_revisions')
      .select('*')
      .eq('employee_id', record.employee_id)
      .eq('record_date', record.record_date)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revision.data?.record_snapshot) {
      const { id: _snapshotId, ...snapshot } = revision.data.record_snapshot;
      await supabase.from('attendance_records').update(snapshot).eq('id', record.id);
      await supabase.from('attendance_record_revisions').delete().eq('id', revision.data.id);
    } else {
      await supabase.from('attendance_records').delete().eq('id', record.id);
    }
  }
  const { error } = await supabase.from('attendance_uploads').delete().eq('id', uploadId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

export default router;
