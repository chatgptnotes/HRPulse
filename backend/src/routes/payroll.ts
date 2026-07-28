import { Router, Request, Response } from 'express';
import { supabase, getSettings } from '../db/supabase';
import { upload } from '../middleware/upload';
import { parseAttendanceExcel } from '../services/excelParser';
import {
  computeEmployeePayroll,
  buildEmployeeDetail,
  summarize,
  parseSettings,
  PayrollResult,
  PayrollRow,
  PayrollSettings,
} from '../services/payrollService';
import { matchEmployees } from '../services/employeeMatch';
import { loadSalaryRules, buildSummary, evaluateSalaryRules, MatchedRuleEffect, SalaryRule } from '../services/salaryRules';
import { ensureAttendanceAlertNotificationsForUpload } from '../services/attendanceAlertService';
import { writeAttendanceRecordBatch } from '../services/attendanceRecordWriter';

const router = Router();

// Whether the optional enhancement columns (biometric_id, shift) exist on the
// employees table. Probed lazily via the first upsert/read; once we know they're
// missing we stop sending/requesting them.
let employeeExtraColsKnown = false;
let hasExtraCols = false;

const EMP_BASE_COLS = 'id, employee_number, name, email, department, designation';
const EMP_FULL_COLS_WITHOUT_OVERTIME = EMP_BASE_COLS + ', shift, shift_end_time, monthly_salary, paid_leaves_eligible';
const EMP_FULL_COLS = EMP_FULL_COLS_WITHOUT_OVERTIME + ', overtime_eligible';

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

function shouldMarkHalfDay(status: string, timeIn: string | null | undefined, timeOut: string | null | undefined, halfDayHours: number) {
  const normalized = String(status || '').toLowerCase();
  if (/absent|missed|missing|incomplete|week|holiday|leave/.test(normalized)) return false;
  const inMin = timeToMinutes(timeIn);
  const outMin = timeToMinutes(timeOut);
  if (inMin == null || outMin == null || outMin < inMin) return false;
  return (outMin - inMin) / 60 < halfDayHours;
}

function monthFromDays(days: Array<{ recordDate: string }>) {
  const first = days.find((day) => day.recordDate)?.recordDate;
  return first ? String(first).slice(0, 7) : '';
}

function fillNotAttemptedMonth(days: Array<{ recordDate: string; status: string; timeIn: string | null; timeOut: string | null }>, periodMonth?: string) {
  const month = /^\d{4}-\d{2}$/.test(String(periodMonth || '')) ? String(periodMonth) : monthFromDays(days);
  if (!month) return days;
  const [year, mon] = month.split('-').map(Number);
  const totalDays = Math.min(new Date(year, mon, 0).getDate(), 30);
  const byDate = new Map(days.map((day) => [String(day.recordDate).slice(0, 10), day]));
  return Array.from({ length: totalDays }, (_, index) => {
    const recordDate = `${month}-${String(index + 1).padStart(2, '0')}`;
    return byDate.get(recordDate) || { recordDate, status: 'Not Attempted', timeIn: null, timeOut: null };
  });
}

function timeToMinutes(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value > 0 && value < 1) return Math.round(value * 24 * 60);
    if (value >= 1 && value < 100000) {
      const whole = Math.floor(value);
      const frac = value - whole;
      const h = whole < 24 ? whole : Math.floor(whole / 100);
      const m = whole < 24 ? Math.round(frac * 60) : whole % 100;
      return h * 60 + m;
    }
  }
  const str = String(value).trim();
  const m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[4]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return h * 60 + min;
  }
  if (/^\d{3,4}$/.test(str)) {
    const n = parseInt(str, 10);
    const h = Math.floor(n / 100);
    const min = n % 100;
    if (h < 24 && min < 60) return h * 60 + min;
  }
  return null;
}

function buildRuleDays(days: any[], settings: PayrollSettings, shiftEndTime?: string | null, overtimeEligible = false) {
  const shiftEndMin = timeToMinutes(shiftEndTime) ?? 1080;
  return days.map((day) => {
    const inMin = timeToMinutes(day.timeIn);
    const outMin = timeToMinutes(day.timeOut);
    const workingHours = inMin != null && outMin != null && outMin >= inMin ? (outMin - inMin) / 60 : 0;
    const rawStatus = String(day.status || '');
    const status = workingHours > 0 && workingHours < settings.halfDayHours && !/absent|missed|missing|week|holiday|leave/i.test(rawStatus)
      ? 'Half Day'
      : rawStatus;
    const overtimeMinutes = overtimeEligible && shiftEndMin != null && outMin != null ? outMin - shiftEndMin : 0;
    return {
      status,
      overtimeHours: overtimeMinutes > 120 ? overtimeMinutes / 60 : 0,
    };
  });
}

// Resilient employees read: tries the full column set (with optional biometric_id
// / shift), falls back to the base set if those columns don't exist.
async function selectEmployeesByIds(employeeIds: number[]) {
  if (employeeIds.length === 0) return [];
  if (!employeeExtraColsKnown || hasExtraCols) {
    const res = await supabase.from('employees').select(EMP_FULL_COLS).in('id', employeeIds);
    if (!res.error) {
      if (!employeeExtraColsKnown) { employeeExtraColsKnown = true; hasExtraCols = true; }
      return (res.data || []) as any[];
    }
    if (/overtime_eligible|does not exist|schema cache/i.test(res.error.message)) {
      const retry = await supabase.from('employees').select(EMP_FULL_COLS_WITHOUT_OVERTIME).in('id', employeeIds);
      if (!retry.error) {
        employeeExtraColsKnown = true;
        hasExtraCols = true;
        return (retry.data || []) as any[];
      }
    }
    if (/biometric_id|shift|monthly_salary|paid_leaves_eligible|overtime_eligible|does not exist|schema cache/i.test(res.error.message)) {
      employeeExtraColsKnown = true;
      hasExtraCols = false;
    } else {
      throw new Error(res.error.message);
    }
  }
  const res = await supabase.from('employees').select(EMP_BASE_COLS).in('id', employeeIds);
  if (res.error) throw new Error(res.error.message);
  return (res.data || []) as any[];
}

async function selectEmployeeById(id: number) {
  if (!employeeExtraColsKnown || hasExtraCols) {
    const res = await supabase.from('employees').select(EMP_FULL_COLS).eq('id', id).single();
    if (!res.error) {
      if (!employeeExtraColsKnown) { employeeExtraColsKnown = true; hasExtraCols = true; }
      return res.data as any;
    }
    if (/overtime_eligible|does not exist|schema cache/i.test(res.error.message)) {
      const retry = await supabase.from('employees').select(EMP_FULL_COLS_WITHOUT_OVERTIME).eq('id', id).single();
      if (!retry.error) {
        employeeExtraColsKnown = true;
        hasExtraCols = true;
        return retry.data as any;
      }
    }
    if (/biometric_id|shift|monthly_salary|paid_leaves_eligible|overtime_eligible|does not exist|schema cache/i.test(res.error.message)) {
      employeeExtraColsKnown = true;
      hasExtraCols = false;
    } else if (res.error.code === 'PGRST116') {
      return null; // not found
    } else {
      throw new Error(res.error.message);
    }
  }
  const res = await supabase.from('employees').select(EMP_BASE_COLS).eq('id', id).single();
  if (res.error) {
    if (res.error.code === 'PGRST116') return null;
    throw new Error(res.error.message);
  }
  return res.data as any;
}

async function upsertEmployee(r: {
  employeeNumber: string; biometricId: string; employeeName: string; email: string;
  organisation: string; entity: string; department: string; designation: string; shift: string;
}, warnings: string[]) {
  const email = r.email || `unknown_${r.employeeName.toLowerCase().replace(/\s+/g, '_')}@hrpulse.local`;
  if (!r.email) warnings.push(`No email for "${r.employeeName}" — using placeholder`);

  const base: Record<string, unknown> = {
    name: r.employeeName,
    email,
    organisation: r.organisation || null,
    entity: r.entity || null,
    department: r.department || null,
    designation: r.designation || null,
  };
  if (r.employeeNumber) base.employee_number = r.employeeNumber;

  const wantsExtras = !!(r.biometricId || r.shift);
  const tryExtras = wantsExtras && (!employeeExtraColsKnown || hasExtraCols);
  const payload = tryExtras
    ? { ...base, ...(r.biometricId ? { biometric_id: r.biometricId } : {}), ...(r.shift ? { shift: r.shift } : {}) }
    : base;

  const selectCols = 'id, employee_number, name, email, department, designation';
  let { data, error } = await supabase
    .from('employees')
    .upsert(payload, { onConflict: 'email' })
    .select(selectCols)
    .single();

  // If the optional columns are missing, retry without them and remember.
  if (error && tryExtras && /biometric_id|shift|does not exist/i.test(error.message)) {
    employeeExtraColsKnown = true;
    hasExtraCols = false;
    const retry = await supabase.from('employees').upsert(base, { onConflict: 'email' }).select(selectCols).single();
    data = retry.data;
    error = retry.error;
  } else if (!error && tryExtras) {
    employeeExtraColsKnown = true;
    hasExtraCols = true;
  }

  if (error) {
    warnings.push(`Failed to upsert employee ${r.employeeName}: ${error.message}`);
    return null;
  }
  return data;
}

// Apply salary rules (department-scoped) to an already-computed row.
// Mutates gross/totalDeductions/net and the rule* fields; returns the per-rule
// breakdown for UI display (empty if no rule fired). Returns null when there is
// nothing to apply (e.g. no rules or no salary configured).
function applyRulesToRow(
  row: PayrollRow,
  days: any[],
  department: string | null,
  shift: string | null,
  shiftEndTime: string | null,
  overtimeEligible: boolean,
  monthlySalary: number,
  rules: SalaryRule[],
  settings: PayrollSettings,
): MatchedRuleEffect[] {
  if (!rules.length || row.dailySalary <= 0) return [];
  const res = evaluateSalaryRules(buildSummary(buildRuleDays(days, settings, shiftEndTime, overtimeEligible)), department, shift, rules, monthlySalary, row.dailySalary);
  row.ruleDeductionDays = res.deductDays;
  row.ruleDeductionAmount = res.deductionAmount;
  row.ruleAllowanceAmount = res.allowanceAmount;
  // Allowances are earnings → added to gross; deductions raise totalDeductions.
  row.grossSalary += res.allowanceAmount;
  row.totalDeductions += res.deductionAmount;
  row.netSalary = row.grossSalary - row.totalDeductions;
  return res.matchedRules;
}

// Core: load records + employees + salaries for an upload and compute payroll.
async function computeForUpload(uploadId: number): Promise<PayrollResult | null> {
  const settingsRaw = await getSettings();
  const settings = parseSettings(settingsRaw);

  // Page through all records (PostgREST caps a single SELECT at 1000 rows).
  const recs: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('employee_id, record_date, status, time_in, time_out')
      .eq('upload_id', uploadId)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    recs.push(...(data || []));
    if (!data || data.length < 1000) break;
    offset += 1000;
  }

  const employeeIds = [...new Set(recs.map((r) => r.employee_id))];
  if (employeeIds.length === 0) return { rows: [], summary: summarize([]) };

  const employees = await selectEmployeesByIds(employeeIds);
  // Salary comes from the Employee Master (employees.monthly_salary). We still
  // read salary_configs as a transitional fallback for records imported before
  // the master was populated.
  const { data: salaries } = await supabase
    .from('salary_configs')
    .select('employee_id, basic_salary, effective_month')
    .in('employee_id', employeeIds);

  // Pick the latest salary config per employee (by effective_month).
  const latestSalary: Record<number, { month: string; amount: number }> = {};
  for (const s of (salaries || []) as any[]) {
    const cur = latestSalary[s.employee_id];
    if (!cur || (s.effective_month || '') >= cur.month) {
      latestSalary[s.employee_id] = { month: s.effective_month || '', amount: s.basic_salary };
    }
  }

  const byEmployee: Record<number, any[]> = {};
  for (const r of recs) {
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = [];
    byEmployee[r.employee_id].push({
      recordDate: r.record_date,
      status: r.status,
      timeIn: r.time_in || null,
      timeOut: r.time_out || null,
    });
  }

  // Active salary-affecting rules (any of the five salary action fields), optionally
  // department-scoped. Applied as an adjustment on top of attendance-based salary.
  const salaryRules = await loadSalaryRules();

  const rows: PayrollRow[] = employees.map((emp: any) => {
    const monthly = Number(emp.monthly_salary) || latestSalary[emp.id]?.amount || 0;
    const paidLeaveDays = emp.paid_leaves_eligible === true ? settings.paidLeaveDays : 0;
    const filledDays = fillNotAttemptedMonth(byEmployee[emp.id] || []);
    const row = computeEmployeePayroll(emp, filledDays, monthly, paidLeaveDays, settings);
    applyRulesToRow(row, filledDays, emp.department || null, emp.shift || null, emp.shift_end_time || null, emp.overtime_eligible === true, monthly, salaryRules, settings);
    return row;
  });

  rows.sort((a, b) => b.netSalary - a.netSalary);
  return { rows, summary: summarize(rows) };
}

async function computeForMonth(periodMonth: string): Promise<PayrollResult | null> {
  const settingsRaw = await getSettings();
  const settings = parseSettings(settingsRaw);
  const start = `${periodMonth}-01`;
  const [year, mon] = periodMonth.split('-').map(Number);
  const next = mon === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  const recs: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('employee_id, record_date, status, time_in, time_out')
      .gte('record_date', start)
      .lt('record_date', next)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    recs.push(...(data || []));
    if (!data || data.length < 1000) break;
    offset += 1000;
  }

  const employeeIds = [...new Set(recs.map((r) => r.employee_id))];
  if (employeeIds.length === 0) return { rows: [], summary: summarize([]) };

  const employees = await selectEmployeesByIds(employeeIds);
  const { data: salaries } = await supabase
    .from('salary_configs')
    .select('employee_id, basic_salary, effective_month')
    .in('employee_id', employeeIds);

  const latestSalary: Record<number, { month: string; amount: number }> = {};
  for (const s of (salaries || []) as any[]) {
    if ((s.effective_month || '') > periodMonth) continue;
    const cur = latestSalary[s.employee_id];
    if (!cur || (s.effective_month || '') >= cur.month) {
      latestSalary[s.employee_id] = { month: s.effective_month || '', amount: s.basic_salary };
    }
  }

  const byEmployee: Record<number, any[]> = {};
  for (const r of recs) {
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = [];
    byEmployee[r.employee_id].push({
      recordDate: r.record_date,
      status: r.status,
      timeIn: r.time_in || null,
      timeOut: r.time_out || null,
    });
  }

  const salaryRules = await loadSalaryRules();
  const rows: PayrollRow[] = employees.map((emp: any) => {
    const monthly = Number(emp.monthly_salary) || latestSalary[emp.id]?.amount || 0;
    const paidLeaveDays = emp.paid_leaves_eligible === true ? settings.paidLeaveDays : 0;
    const filledDays = fillNotAttemptedMonth(byEmployee[emp.id] || [], periodMonth);
    const row = computeEmployeePayroll(emp, filledDays, monthly, paidLeaveDays, settings);
    applyRulesToRow(row, filledDays, emp.department || null, emp.shift || null, emp.shift_end_time || null, emp.overtime_eligible === true, monthly, salaryRules, settings);
    return row;
  });

  rows.sort((a, b) => b.netSalary - a.netSalary);
  return { rows, summary: summarize(rows) };
}

// POST /api/payroll/process — upload + parse + store + compute
router.post('/process', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  try {
    const { records, periodMonth, periodYear, warnings } = parseAttendanceExcel(req.file.buffer);
    if (records.length === 0) {
      res.status(400).json({ error: 'No valid records found in the Excel file', warnings });
      return;
    }
    const groupedRecords = groupRecordsByMonth(records, periodMonth);
    if (groupedRecords.length === 0) {
      res.status(400).json({ error: 'No valid attendance dates found in the Excel file', warnings });
      return;
    }
    const months = groupedRecords.map(([month]) => month);
    const primaryMonth = months[months.length - 1];
    const primaryYear = primaryMonth.slice(0, 4) || periodYear;

    const uploadedBy = (req.body.uploadedBy as string) || 'admin';

    // Link records to existing Employee Master rows (no employee creation).
    const { find, warnings: matchWarnings, skipped } = await matchEmployees(records);
    warnings.push(...matchWarnings);
    const payrollSettings = parseSettings(await getSettings());

    const uploads: Array<{ uploadId: number; periodMonth: string; periodYear: string; rowCount: number }> = [];
    let totalRecordCount = 0;
    let attendanceAlerts = { employeesChecked: 0, notificationsCreated: 0 };

    for (const [month, monthRecords] of groupedRecords) {
      const { data: uploadRow, error: upErr } = await supabase
        .from('attendance_uploads')
        .insert({
          filename: req.file.originalname,
          period_month: month,
          row_count: monthRecords.length,
          status: 'processed',
        })
        .select()
        .single();
      if (upErr) { res.status(500).json({ error: upErr.message }); return; }

      // Try to persist uploaded_by if the column exists (migration applied).
      if (uploadedBy) {
        await supabase.from('attendance_uploads').update({ uploaded_by: uploadedBy }).eq('id', uploadRow.id);
      }

      const recRows: any[] = [];
      for (const r of monthRecords) {
        const emp = find(r);
        if (!emp) continue;
        const status = shouldMarkHalfDay(r.status, r.timeIn, r.timeOut, payrollSettings.halfDayHours) ? 'Half Day' : r.status;
        recRows.push({
          upload_id: uploadRow.id,
          employee_id: emp.id,
          record_date: r.recordDate,
          status,
          time_in: r.timeIn || null,
          time_out: r.timeOut || null,
        });
      }

      let recordCount = 0;
      for (let i = 0; i < recRows.length; i += 500) {
        const batch = recRows.slice(i, i + 500);
        try {
          const result = await writeAttendanceRecordBatch(batch);
          recordCount += result.count;
        } catch (error) {
          warnings.push(`Record insert batch for ${month} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      try {
        const monthAlerts = await ensureAttendanceAlertNotificationsForUpload(uploadRow.id, month);
        attendanceAlerts = {
          employeesChecked: attendanceAlerts.employeesChecked + monthAlerts.employeesChecked,
          notificationsCreated: attendanceAlerts.notificationsCreated + monthAlerts.notificationsCreated,
        };
      } catch (alertError) {
        warnings.push(`Attendance alerts for ${month} could not be generated: ${alertError instanceof Error ? alertError.message : String(alertError)}`);
      }

      totalRecordCount += recordCount;
      uploads.push({
        uploadId: uploadRow.id,
        periodMonth: month,
        periodYear: month.slice(0, 4),
        rowCount: recordCount,
      });
    }

    if (months.length > 1) {
      warnings.push(`This file contained multiple months (${months.join(', ')}). HRPulse saved each date under its correct month.`);
    }

    const primaryUpload = uploads.find((item) => item.periodMonth === primaryMonth) || uploads[uploads.length - 1];
    const result = await computeForMonth(primaryMonth);
    res.json({
      uploadId: primaryUpload.uploadId,
      periodMonth: primaryMonth,
      periodYear: primaryYear,
      rowCount: totalRecordCount,
      uploadedBy,
      warnings,
      attendanceAlerts,
      uploads,
      payroll: result,
    });
  } catch (err) {
    console.error('[payroll/process] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/payroll/month/:periodMonth - compute payroll from all daily uploads in a month.
router.get('/month/:periodMonth', async (req: Request, res: Response) => {
  try {
    const periodMonth = String(req.params.periodMonth || '');
    if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
      res.status(400).json({ error: 'periodMonth must be YYYY-MM' });
      return;
    }
    const result = await computeForMonth(periodMonth);
    res.json({ periodMonth, payroll: result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/payroll/runs/:uploadId — (re)compute payroll for a stored upload
router.get('/runs/:uploadId', async (req: Request, res: Response) => {
  try {
    const uploadId = parseInt(req.params.uploadId);
    const { data: upload } = await supabase.from('attendance_uploads').select('*').eq('id', uploadId).single();
    if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }
    const result = await computeForUpload(uploadId);
    res.json({ upload, payroll: result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/payroll/employee/:uploadId/:employeeId — detailed breakdown for the modal
router.get('/employee/:uploadId/:employeeId', async (req: Request, res: Response) => {
  try {
    const uploadId = parseInt(req.params.uploadId);
    const employeeId = parseInt(req.params.employeeId);
    const settingsRaw = await getSettings();
    const settings = parseSettings(settingsRaw);

    const emp = await selectEmployeeById(employeeId);
    if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }

    const { data: uploadRow } = await supabase
      .from('attendance_uploads')
      .select('period_month')
      .eq('id', uploadId)
      .single();

    const { data: records } = await supabase
      .from('attendance_records')
      .select('record_date, status, time_in, time_out')
      .eq('upload_id', uploadId)
      .eq('employee_id', employeeId)
      .order('record_date', { ascending: true });

    const { data: salaries } = await supabase
      .from('salary_configs')
      .select('basic_salary, effective_month')
      .eq('employee_id', employeeId);
    // Salary comes from the Employee Master; salary_configs is a transitional fallback.
    const sorted = ((salaries || []) as any[]).slice().sort((a: any, b: any) => (b.effective_month || '').localeCompare(a.effective_month || ''));
    const fallbackMonthly = sorted.length > 0 ? sorted[0].basic_salary : 0;
    const monthly = Number((emp as any).monthly_salary) || fallbackMonthly || 0;
    const paidLeaveDays = (emp as any).paid_leaves_eligible === true ? settings.paidLeaveDays : 0;

    const rawDays = ((records || []) as any[]).map((r) => ({
      recordDate: r.record_date, status: r.status, timeIn: r.time_in || null, timeOut: r.time_out || null,
    }));
    const days = fillNotAttemptedMonth(rawDays, (uploadRow as any)?.period_month || undefined);

    const row = computeEmployeePayroll(emp as any, days, monthly, paidLeaveDays, settings);
    // Apply salary rules (department-scoped) so the breakdown matches the table.
    const salaryRules = await loadSalaryRules();
    const matched = applyRulesToRow(row, days, (emp as any).department || null, (emp as any).shift || null, (emp as any).shift_end_time || null, (emp as any).overtime_eligible === true, monthly, salaryRules, settings);
    const detail = buildEmployeeDetail(row, emp as any, days, settings, matched);
    res.json({ ...detail, periodMonth: (uploadRow as any)?.period_month || null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/payroll/history — upload history with derived year + uploaded_by (if present)
router.get('/history', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('attendance_uploads')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (error) {
      // If the query failed because 'uploaded_by' was selected implicitly via '*',
      // that won't happen ('*' is safe). Surface other errors.
      res.status(500).json({ error: error.message });
      return;
    }
    const rows = (data || []).map((u: any) => ({
      id: u.id,
      filename: u.filename,
      uploadedAt: u.uploaded_at,
      periodMonth: u.period_month,
      year: (u.period_month || '').substring(0, 4),
      month: (u.period_month || '').substring(5, 7),
      rowCount: u.row_count,
      status: u.status,
      uploadedBy: u.uploaded_by || 'admin',
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Filters metadata: distinct departments / shifts / employees for the filter dropdowns
router.get('/filters', async (_req: Request, res: Response) => {
  try {
    // Resilient read — shift column may not exist until the optional migration runs.
    let employees: any[] = [];
    if (!employeeExtraColsKnown || hasExtraCols) {
      const full = await supabase.from('employees').select('id, name, employee_number, department, shift');
      if (!full.error) {
        if (!employeeExtraColsKnown) { employeeExtraColsKnown = true; hasExtraCols = true; }
        employees = (full.data || []) as any[];
      } else if (/shift|does not exist|schema cache/i.test(full.error.message)) {
        employeeExtraColsKnown = true;
        hasExtraCols = false;
      } else {
        res.status(500).json({ error: full.error.message });
        return;
      }
    }
    if (employees.length === 0 && employeeExtraColsKnown && !hasExtraCols) {
      const base = await supabase.from('employees').select('id, name, employee_number, department');
      employees = (base.data || []) as any[];
    }
    const departments = [...new Set(employees.map((e: any) => e.department).filter(Boolean))] as string[];
    const shifts = [...new Set(employees.map((e: any) => e.shift).filter(Boolean))] as string[];
    res.json({
      departments: departments.sort(),
      shifts: shifts.sort(),
      employees: employees.map((e: any) => ({ id: e.id, name: e.name, employeeNumber: e.employee_number })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
