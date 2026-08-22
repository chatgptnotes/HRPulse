import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { adamritSupabase } from '../lib/adamritSupabase';

function directClient() {
  if (!supabase) throw new Error('Supabase is not configured. Restart the frontend after checking .env.');
  return supabase;
}

function directResult<T>(data: T, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  return { data };
}

/**
 * Features that lived in the retired Express backend and have no Supabase
 * implementation yet. They reject loudly rather than pretending to work: the
 * old /api routes no longer exist, so a silent call would just return the
 * SPA's index.html and fail somewhere far less obvious.
 */
export const NOT_MIGRATED = 'is not available yet — it is being rebuilt on Supabase.';
// The type parameter is the shape the caller would have received, so pages keep
// compiling against the eventual contract. Nothing is ever resolved.
const notMigrated = <T = void>(feature: string): Promise<T> =>
  Promise.reject(new Error(`${feature} ${NOT_MIGRATED}`));

const SHIFT_LATE_GRACE_MINUTES = 30;
// One half-day rule for the whole company: under four hours worked is half a day,
// whatever the shift length or the entity. The import path has no access to the
// settings table, so it uses this constant directly while getSalaryDeductions
// takes it as the fallback for half_day_threshold_hours — the two cannot drift.
const HALF_DAY_HOURS = 4;
// Lateness costs nothing anywhere any more — pay follows the days a person is
// entitled to, and a late arrival is still a day worked. The count is kept for
// reporting, and hidden outright for the months listed here.
// The July 2026 late waiver was lifted so Rules Engine late-based rules
// (e.g. "Late Arrival - Rs500 Salary Deduction") can apply and be visible.
// Add months back here only to waive again; keep hiding display-only.
const LATE_COUNT_HIDDEN_MONTHS = new Set<string>([]);

// The status vocabulary now lives in lib/status.ts so the salary attribution can
// use it without importing this module. Re-exported here because callers of the
// api module have always got canonicalStatus from it.
import { canonicalStatus, statusIsOneOf } from '../lib/status';
import { fetchActivePayrollRules, evaluatePayrollRules, type PayrollRuleEffect } from '../lib/payrollRuleBridge';
export { canonicalStatus, statusIsOneOf };

/** Employee numbers are compared folded, so EMP-001 and emp-001 are one person. */
/** Employee numbers are only unique within one biometric device, so every
 *  lookup is namespaced by company. Without this, Hope #15 and Ayushman #15
 *  resolve to the same record and one person inherits another's month. */
const employeeNumberKey = (company: unknown, value: unknown) =>
  `${String(company ?? '').trim().toLowerCase()}:${String(value ?? '').trim().toLowerCase()}`;

function timeValueToMinutes(value: unknown): number | null {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
function nearestConfiguredShift(timings: any, punchMinutes: number) {
  return ['Morning', 'Evening', 'Night'].reduce<any | null>((best, shiftName) => {
    const timing = timings?.[shiftName.toLowerCase()];
    const start = timeValueToMinutes(timing?.start);
    const end = timeValueToMinutes(timing?.end);
    if (start === null || end === null) return best;
    const difference = Math.min(Math.abs(punchMinutes - start), 1440 - Math.abs(punchMinutes - start));
    return !best || difference < best.difference ? { shiftName, start, end, difference } : best;
  }, null);
}

// Supabase commonly limits one REST response to 1,000 rows. Attendance
// uploads contain many rows per employee, so read larger result sets in pages.
// The first page reports the total, which lets the rest be fetched at once
// instead of one after another — a month of attendance is nine pages, and
// waiting for each in turn cost about six seconds.
async function fetchAllRows<T>(buildQuery: (from: number, to: number) => any): Promise<{ data: T[]; error: any }> {
  const pageSize = 1000;
  const first = await buildQuery(0, pageSize - 1);
  if (first.error) return { data: [], error: first.error };
  const head = (first.data || []) as T[];
  if (head.length < pageSize) return { data: head, error: null };

  // `count` is present when the caller asked for it; without it, fall back to
  // reading sequentially so a missing total degrades rather than breaks.
  const total = typeof first.count === 'number' ? first.count : null;
  if (total === null) {
    const all = [...head];
    for (let from = pageSize; ; from += pageSize) {
      const result = await buildQuery(from, from + pageSize - 1);
      if (result.error) return { data: all, error: result.error };
      const page = (result.data || []) as T[];
      all.push(...page);
      if (page.length < pageSize) return { data: all, error: null };
    }
  }

  const offsets: number[] = [];
  for (let from = pageSize; from < total; from += pageSize) offsets.push(from);

  // Four at a time. Firing every page at once was measurably faster still, but
  // it drew an intermittent 500 from the REST endpoint; four keeps almost all
  // of the gain without leaning on the server.
  const concurrency = 4;
  const pages: T[][] = new Array(offsets.length);
  let cursor = 0;
  let failure: any = null;
  await Promise.all(Array.from({ length: Math.min(concurrency, offsets.length) }, async () => {
    while (cursor < offsets.length && !failure) {
      const index = cursor++;
      const result = await buildQuery(offsets[index], offsets[index] + pageSize - 1);
      if (result.error) { failure = result.error; return; }
      pages[index] = (result.data || []) as T[];
    }
  }));
  if (failure) return { data: head, error: failure };
  return { data: head.concat(...pages.map(page => page || [])), error: null };
}

// Attendance
const staffNameKey = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+(soft|staff|employee|emp)$/i, '')
  .replace(/\s+/g, ' ');

const staffNamesMatch = (left: unknown, right: unknown) => {
  const a = staffNameKey(left).split(' ').filter(Boolean);
  const b = staffNameKey(right).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const short = a.length === 1 ? a : b.length === 1 ? b : null;
  const long = a.length === 1 ? b : b.length === 1 ? a : null;
  return !!short && !!long && short[0] === long[0] && long.length <= 3;
};

async function importStaffMaster(files: File[], effectiveMonth: string) {
  const client = directClient();
  const warnings: string[] = [];
  const staffRows: Array<{ name: string; designation: string; basicSalary: number; organisation: string }> = [];
  for (const file of files) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    const headerIndex = rows.findIndex(row => {
      const text = row.map(value => String(value ?? '').toLowerCase()).join(' ');
      return /name/.test(text) && /basic\s*salary/.test(text);
    });
    if (headerIndex < 0) {
      warnings.push(`${file.name}: staff columns were not detected`);
      continue;
    }
    const headers = rows[headerIndex].map(value => String(value ?? '').toLowerCase().trim());
    const nameIndex = headers.findIndex(value => /^name$|employee|staff/.test(value));
    const designationIndex = headers.findIndex(value => /designation|desingation|role/.test(value));
    const salaryIndex = headers.findIndex(value => /basic\s*salary|salary/.test(value));
    const organisationIndex = headers.findIndex(value => /organisation|organization|company/.test(value));
    for (const row of rows.slice(headerIndex + 1)) {
      const name = String(row[nameIndex] ?? '').trim();
      if (!name) continue;
      const basicSalary = Number(String(row[salaryIndex] ?? '').replace(/[^0-9.]/g, ''));
      staffRows.push({
        name,
        designation: String(row[designationIndex] ?? '').trim(),
        basicSalary: Number.isFinite(basicSalary) ? basicSalary : 0,
        organisation: String(row[organisationIndex] ?? '').trim(),
      });
    }
  }
  if (!staffRows.length) return { warnings };

  const employeesQuery = await client.from('employees').select('id,email,name,employee_number');
  if (employeesQuery.error) throw new Error(`Employees could not be loaded: ${employeesQuery.error.message}`);
  const employees = (employeesQuery.data || []) as any[];
  const salaryRows = new Map<string, any>();
  for (const staff of staffRows) {
    let employee = employees.find(row => staffNamesMatch(row.name, staff.name));
    if (!employee) {
      const key = staffNameKey(staff.name).replace(/\s+/g, '_');
      const created = await client.from('employees').insert({ name: staff.name, email: `staff_${key}@unknown.local`, organisation: staff.organisation || null, designation: staff.designation || null, monthly_salary: staff.basicSalary > 0 ? staff.basicSalary : null }).select('id,email,name,employee_number').single();
      if (created.error) throw new Error(`Staff employee could not be created: ${created.error.message}`);
      employee = created.data;
      employees.push(employee);
    } else {
      const updated = await client.from('employees').update({
        name: employee.name.length >= staff.name.length ? employee.name : staff.name,
        organisation: staff.organisation || undefined,
        designation: staff.designation || undefined,
        monthly_salary: staff.basicSalary > 0 ? staff.basicSalary : undefined,
      }).eq('id', employee.id).select('id,email,name,employee_number').single();
      if (updated.error) throw new Error(`Staff employee could not be updated: ${updated.error.message}`);
      employee = updated.data;
    }
    if (staff.basicSalary > 0) salaryRows.set(String(employee.id), employee.id);
  }
  if (salaryRows.size) warnings.push(`${salaryRows.size} staff salaries were updated for ${effectiveMonth}.`);
  return { warnings };
}

export type UploadFile = File | { file: File; company?: string };

/** Biometric devices number their users independently — #15 is one person at
 *  Hope and someone else entirely at Ayushman. Employee numbers are therefore
 *  only meaningful within a company, and every lookup is keyed accordingly. */
export const guessCompany = (filename: string): string => {
  const text = String(filename || '').toLowerCase();
  if (text.includes('rafttar') || text.includes('raftar')) return 'Rafttar';
  if (text.includes('ayushman')) return 'Ayushman';
  if (text.includes('hope')) return 'Hope';
  return '';
};

export const uploadAttendance = async (fileInput: UploadFile | UploadFile[]) => {
  const asEntry = (item: UploadFile) => (item instanceof File ? { file: item, company: guessCompany(item.name) } : { file: item.file, company: item.company || guessCompany(item.file.name) });
  const entries = (Array.isArray(fileInput) ? fileInput : [fileInput]).map(asEntry);
  const files = entries.map(entry => entry.file);
  const companyByFile = new Map(entries.map(entry => [entry.file, entry.company || '']));
  if (!files.length) throw new Error('Please select at least one Excel file.');
  const classifyFile = async (file: File) => {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', sheetRows: 5 });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    const headerText = rows.flat().map(value => String(value ?? '').toLowerCase().trim()).join(' ');
    return /basic salary/.test(headerText) && /organisation|organization/.test(headerText) ? 'staff' : 'attendance';
  };
  const classified = await Promise.all(files.map(async file => ({ file, kind: await classifyFile(file) })));
  const attendanceFiles = classified.filter(item => item.kind === 'attendance').map(item => item.file);
  const staffFiles = classified.filter(item => item.kind === 'staff').map(item => item.file);
  if (!attendanceFiles.length) throw new Error('Please include at least one attendance file.');
  if (attendanceFiles.length > 1 || staffFiles.length > 0) {
    // Import each file on its own and keep every outcome. The previous version
    // reassigned a single `result` per pass, so only the last file was ever
    // reported and every earlier warning — including rows skipped for unmatched
    // employees — was thrown away. A failure now costs that one file, not the
    // whole drop, and is reported rather than leaving a silent partial import.
    const perFile: Array<{ filename: string; periodMonth: string | null; rowCount: number; ok: boolean; error?: string }> = [];
    const warnings: string[] = [];
    const succeeded: Array<{ uploadId: number; periodMonth: string }> = [];
    for (const file of attendanceFiles) {
      try {
        const one: any = await uploadAttendance({ file, company: companyByFile.get(file) || '' });
        perFile.push({ filename: file.name, periodMonth: one.data.periodMonth, rowCount: one.data.rowCount, ok: true });
        succeeded.push({ uploadId: one.data.uploadId, periodMonth: one.data.periodMonth });
        for (const warning of one.data.warnings || []) warnings.push(`${file.name}: ${warning}`);
      } catch (error: any) {
        perFile.push({ filename: file.name, periodMonth: null, rowCount: 0, ok: false, error: error?.message || String(error) });
        warnings.push(`${file.name}: import failed — ${error?.message || error}`);
      }
    }
    if (!succeeded.length) throw new Error(`No attendance file could be imported. ${perFile.map(f => `${f.filename}: ${f.error}`).join(' | ')}`);
    // Open on the newest month; the rest stay reachable from upload history.
    const newest = succeeded.reduce((a, b) => (b.periodMonth > a.periodMonth ? b : a));
    if (staffFiles.length) {
      const staffResult = await importStaffMaster(staffFiles, newest.periodMonth);
      for (const warning of staffResult.warnings || []) warnings.push(warning);
    }
    const rowCount = perFile.filter(f => f.ok).reduce((sum, f) => sum + f.rowCount, 0);
    const months = [...new Set(succeeded.map(s => s.periodMonth))];
    if (months.length > 1) warnings.unshift(`Imported ${months.length} months: ${months.sort().join(', ')}. Showing ${newest.periodMonth}; the others are in upload history.`);
    return { data: { uploadId: newest.uploadId, periodMonth: newest.periodMonth, rowCount, warnings, files: perFile } };
  }
  const file = attendanceFiles[0];
  const fileCompany = companyByFile.get(file) || guessCompany(file.name);
  // A stand-in address built from the device number must include the company
  // too, or "15@unknown.local" means two different people.
  const emailPrefix = fileCompany ? `${fileCompany.toLowerCase()}_` : '';
  const synthEmail = (row: Record<string, string | number | null>) =>
    String(row.email || `${emailPrefix}${row.employeeNumber || row.employeeName}@unknown.local`).trim().toLowerCase();
  if (!/\.(xls|xlsx)$/i.test(file.name)) throw new Error('Please select an Excel .xls or .xlsx file.');

  const headerMap: Record<string, string> = {
    'employee number': 'employeeNumber', 'employee no': 'employeeNumber', 'emp no': 'employeeNumber', 'emp number': 'employeeNumber', 'employee code': 'employeeNumber', 'emp code': 'employeeNumber',
    'employee': 'employeeName', 'employee name': 'employeeName', 'employee full name': 'employeeName', 'emp name': 'employeeName', 'staff name': 'employeeName', 'staff': 'employeeName', name: 'employeeName',
    'email address': 'email', email: 'email', 'e-mail': 'email', organisation: 'organisation', organization: 'organisation', entity: 'entity', department: 'department',
    date: 'date', 'date in': 'date', date_in: 'date', 'attendance date': 'date', type: 'status', 'attendance type': 'status', status: 'status',
    'time in': 'timeIn', 'in time': 'timeIn', 'punch in': 'timeIn', 'time out': 'timeOut', 'out time': 'timeOut', 'punch out': 'timeOut',
  };
  const statusMap: Record<string, string> = {
    normal: 'Normal', weekend: 'Weekend', 'weak end': 'Weekend', holiday: 'Holiday', late: 'Late Coming', 'late coming': 'Late Coming',
    absent: 'Absent', absence: 'Absent', 'missed swipe': 'Missed Swipe', incomplete: 'Missed Swipe', official: 'Official',
    'early leaving': 'Early Leaving', 'early leave': 'Early Leaving', 'casual leave': 'Paid Leave', 'paid leave': 'Paid Leave', 'sick leave': 'Paid Leave', leave: 'Paid Leave',
  };
  const paidLeaveStatuses = new Set(['Paid Leave', 'Casual Leave', 'Sick Leave']);
  const normalize = (value: unknown) => {
    const key = String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
    return headerMap[key] || key.replace(/\s+/g, '_');
  };
  const parseDate = (value: unknown): string | null => {
    if (typeof value === 'number') { const parsed = XLSX.SSF.parse_date_code(value); return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}` : null; }
    const text = String(value ?? '').trim();
    const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    return iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` : null;
  };
  const parseTime = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value < 1 ? value * 24 : value;
    const text = String(value).trim().toLowerCase();
    const ampm = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
    const clock = text.match(/^(\d{1,2}):?(\d{2})?$/);
    if (!ampm && !clock) return null;
    const hours = ampm ? Number(ampm[1]) % 12 + (ampm[3] === 'pm' ? 12 : 0) : Number(clock![1]);
    const minutes = Number((ampm ? ampm[2] : clock![2]) || 0);
    return hours + minutes / 60;
  };
  const isIt = (department: string) => /\bit\b|information technology/i.test(department);
  // Attendance exports sometimes add a harmless label to the same person,
  // for example "SAHIL JHA" and "sahil jha soft". Keep matching conservative:
  // only remove known report labels at the end of a name.
  const employeeNameKey = (value: unknown) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+(soft|staff|employee|emp)$/i, '')
    .replace(/\s+/g, ' ');
  const employeeNamesMatch = (left: unknown, right: unknown) => {
    const a = employeeNameKey(left).split(' ').filter(Boolean);
    const b = employeeNameKey(right).split(' ').filter(Boolean);
    if (!a.length || !b.length) return false;
    if (a.join(' ') === b.join(' ')) return true;
    const short = a.length === 1 ? a : b.length === 1 ? b : null;
    const long = a.length === 1 ? b : b.length === 1 ? a : null;
    return !!short && !!long && short[0] === long[0] && long.length <= 3;
  };
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetRows = workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' }) }));
  const findHeader = (rows: unknown[][]) => rows.findIndex(row => {
    const text = row.slice(0, 40).map(String).join(' ').toLowerCase();
    return (/employee|emp\s|staff|name/.test(text) && /date|day/.test(text)) || (/employee|emp\s|staff/.test(text) && /type|status|attendance/.test(text));
  });
  const selected = sheetRows.find(candidate => findHeader(candidate.rows) >= 0) || sheetRows[0];
  const rows = selected?.rows || [];
  let headerIndex = findHeader(rows);
  const matrixHeaderIndex = rows.findIndex(row => {
    const name = String(row[1] ?? '').trim();
    return /^name$/i.test(name) && row.slice(2, 40).some(value => /^\d{1,2}$/.test(String(value ?? '').trim()));
  });
  if (headerIndex < 0 && matrixHeaderIndex >= 0) headerIndex = matrixHeaderIndex;
  if (headerIndex < 0) headerIndex = 0;
  const rawHeaders = (rows[headerIndex] || []).map(value => String(value ?? '').trim());
  const headers = rawHeaders.map(normalize);
  // GDHR exports vary by report and sometimes use labels such as
  // "Employee", "Staff", or "Emp Code" instead of the standard headers.
  if (!headers.includes('employeeName')) {
    const nameIndex = rawHeaders.findIndex(header => /employee|emp\s*name|staff|full\s*name|^name$/i.test(header));
    if (nameIndex >= 0) headers[nameIndex] = 'employeeName';
  }
  if (!headers.includes('date')) {
    const dateIndex = rawHeaders.findIndex(header => /date|day/i.test(header));
    if (dateIndex >= 0) headers[dateIndex] = 'date';
  }
  if (!headers.includes('status')) {
    const statusIndex = rawHeaders.findIndex(header => /type|status|attendance/i.test(header));
    if (statusIndex >= 0) headers[statusIndex] = 'status';
  }
  const warnings: string[] = [];
  const parsed: Array<Record<string, string | number | null>> = [];
  const matrixHeader = rawHeaders.length > 2 && /^name$/i.test(rawHeaders[1] || '') && rawHeaders.slice(2).some(value => /^\d{1,2}$/.test(value));
  const durationText = rows.slice(0, 4).flat().map(value => String(value ?? '')).find(value => /\d{1,2}\/\d{1,2}\/\d{4}\s*~\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) || '';
  const duration = durationText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*~\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (matrixHeader && duration) {
    if (duration[2] !== duration[5] || duration[3] !== duration[6]) {
      throw new Error('This attendance report spans more than one month. Please upload one month at a time.');
    }
    const year = Number(duration[3]);
    const monthNumber = Number(duration[2]);
    const maxDay = Math.min(Number(duration[6] === duration[3] ? duration[4] : 31), rawHeaders.length - 2);
    for (let index = headerIndex + 2; index < rows.length; index++) {
      const row = rows[index] || [];
      // Some exports contain an unassigned block of punch times before the
      // real employee list. Do not turn those times into fake employees.
      if (!/^\d+$/.test(String(row[0] ?? '').trim())) continue;
      const employeeName = String(row[1] ?? '').trim();
      if (!employeeName) continue;
      for (let day = 1; day <= maxDay; day++) {
        const cell = String(row[day + 1] ?? '').trim();
        const times = cell.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        const recordDate = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        parsed.push({
          employeeNumber: row[0] ? String(row[0]) : null,
          employeeName,
          recordDate,
          status: times.length === 0 ? 'Absent' : times.length === 1 ? 'Missed Swipe' : 'Normal',
          timeIn: times[0] || null,
          timeOut: times.length > 1 ? times[times.length - 1] : null,
          date: recordDate,
        });
      }
    }
  } else {
    for (let index = headerIndex + 1; index < rows.length; index++) {
      const row = rows[index] || [];
      const item: Record<string, string | number | null> = {};
      headers.forEach((key, column) => { item[key] = row[column] as string | number || ''; });
      if (!String(item.employeeName || '').trim()) continue;
      const recordDate = parseDate(item.date);
      if (!recordDate) { warnings.push(`Row ${index + 1}: date could not be read for ${item.employeeName}`); continue; }
      const statusKey = String(item.status || '').toLowerCase().trim();
      item.recordDate = recordDate;
      item.status = statusMap[statusKey] || canonicalStatus(item.status) || 'Normal';
      parsed.push(item);
    }
  }
  if (!parsed.length) throw new Error(`No attendance rows were found in ${file.name}. Detected columns: ${rawHeaders.filter(Boolean).slice(0, 12).join(', ') || 'none'}. The file needs an employee/name column and a date column.`);
  const parsedMonths = [...new Set(parsed.map(row => String(row.recordDate || '').slice(0, 7)).filter(Boolean))];
  if (parsedMonths.length !== 1) throw new Error(`This file contains more than one attendance month (${parsedMonths.join(', ')}). Please upload one month at a time.`);
  const periodMonth = parsedMonths[0];

  // Keep the last row when an Excel file contains the same employee/date more
  // than once. This also protects the database upsert from duplicate input.
  const uniqueRecords = new Map<string, Record<string, string | number | null>>();
  for (const row of parsed) {
    const employeeKey = employeeNumberKey(fileCompany, row.employeeNumber || row.employeeName || '');
    uniqueRecords.set(`${employeeKey}|${String(row.recordDate)}`, row);
  }
  parsed.length = 0;
  parsed.push(...uniqueRecords.values());

  const client = directClient();
  const employeeRowsByIdentity = new Map<string, { employee_number: string | null; name: string; email: string; organisation: string | null; entity: string | null; department: string | null }>();
  for (const row of parsed) {
    const email = synthEmail(row);
    const employeeNumber = row.employeeNumber ? String(row.employeeNumber).trim() : null;
    employeeRowsByIdentity.set(employeeNumberKey(fileCompany, employeeNumber) || email, { employee_number: employeeNumber, name: String(row.employeeName), email, organisation: row.organisation ? String(row.organisation) : null, entity: row.entity ? String(row.entity) : null, department: row.department ? String(row.department) : null });
  }
  const employeeRows = [...employeeRowsByIdentity.values()];
  const dedupedEmployeeRows: typeof employeeRows = [];
  for (const row of employeeRows) {
    const duplicateIndex = dedupedEmployeeRows.findIndex(existing => employeeNamesMatch(existing.name, row.name));
    if (duplicateIndex < 0) dedupedEmployeeRows.push(row);
    else if (row.name.length > dedupedEmployeeRows[duplicateIndex].name.length) {
      dedupedEmployeeRows[duplicateIndex] = {
        ...row,
        employee_number: dedupedEmployeeRows[duplicateIndex].employee_number || row.employee_number,
      };
    }
  }
  // Match by both identifiers because existing projects may have unique
  // constraints on email, employee_number, both, or neither.
  const existingEmployees = await client.from('employees').select('id,email,employee_number,name,department,organisation,shift_timings,eligible_for_overtime');
  if (existingEmployees.error) throw new Error(`Employees could not be checked: ${existingEmployees.error.message}`);
  const existingEmails = new Set((existingEmployees.data || []).map((row: any) => String(row.email || '').toLowerCase()).filter(Boolean));
  const existingNumbers = new Set((existingEmployees.data || []).map((row: any) => employeeNumberKey(row.organisation || fileCompany, row.employee_number)));
  const existingNames = (existingEmployees.data || []).map((row: any) => String(row.name || '')).filter(Boolean);
  const missingEmployees = dedupedEmployeeRows.filter(row => !existingEmails.has(row.email) && (!row.employee_number || !existingNumbers.has(employeeNumberKey(fileCompany, row.employee_number))) && !existingNames.some(name => employeeNamesMatch(row.name, name)));
  if (missingEmployees.length > 0) {
    const insertedEmployees = await client.from('employees').insert(missingEmployees.map(row => ({ ...row, organisation: row.organisation || fileCompany || null })));
    if (insertedEmployees.error) throw new Error(`Employees could not be saved: ${insertedEmployees.error.message}`);
  }
  const employeesQuery = await client.from('employees').select('id,email,employee_number,name,department,organisation,shift_timings,eligible_for_overtime');
  if (employeesQuery.error) throw new Error(`Employees could not be loaded: ${employeesQuery.error.message}`);
  const employeeMap = new Map<string, any>();
  const employeeNumberMap = new Map<string, any>();
  const employeeNameMap = new Map<string, any>();
  for (const row of (employeesQuery.data || []) as any[]) {
    const emailKey = String(row.email || '').toLowerCase();
    const numberKey = employeeNumberKey(row.organisation || fileCompany, row.employee_number);
    if (emailKey) employeeMap.set(emailKey, row);
    if (numberKey) employeeNumberMap.set(numberKey, row);
    const nameKey = employeeNameKey(row.name);
    if (nameKey && !employeeNameMap.has(nameKey)) employeeNameMap.set(nameKey, row);
  }
  const findEmployeeByName = (name: unknown) => {
    const exact = employeeNameMap.get(employeeNameKey(name));
    if (exact) return exact;
    return [...employeeNameMap.values()].find(row => employeeNamesMatch(name, row.name));
  };
  const rowEmail = (row: Record<string, string | number | null>) => synthEmail(row);
  const resolveEmployee = (row: Record<string, string | number | null>) =>
    employeeMap.get(rowEmail(row)) || employeeNumberMap.get(employeeNumberKey(fileCompany, row.employeeNumber)) || findEmployeeByName(row.employeeName);
  const indexEmployees = (list: any[]) => {
    for (const row of list) {
      const emailKey = String(row.email || '').toLowerCase();
      const numberKey = employeeNumberKey(row.organisation || fileCompany, row.employee_number);
      if (emailKey) employeeMap.set(emailKey, row);
      if (numberKey) employeeNumberMap.set(numberKey, row);
      const nameKey = employeeNameKey(row.name);
      if (nameKey && !employeeNameMap.has(nameKey)) employeeNameMap.set(nameKey, row);
    }
  };

  // Every identity in the file must resolve before any row is written. The
  // creation pass above works on name-collapsed rows, so identities the
  // collapse dropped would previously reach the mapping step unresolved and
  // abort the import — after the import row had already been committed.
  const unresolvedRows = new Map<string, { employee_number: string | null; name: string; email: string }>();
  for (const row of parsed) {
    if (resolveEmployee(row)) continue;
    const employeeNumber = row.employeeNumber ? String(row.employeeNumber).trim() : null;
    unresolvedRows.set(employeeNumber || rowEmail(row), { employee_number: employeeNumber, name: String(row.employeeName), email: rowEmail(row) });
  }
  if (unresolvedRows.size) {
    const created = await client.from('employees').insert([...unresolvedRows.values()]).select('id,email,employee_number,name,department,shift_timings,eligible_for_overtime');
    if (created.error) throw new Error(`New employees from ${file.name} could not be created: ${created.error.message}`);
    indexEmployees(created.data || []);
    warnings.push(`${unresolvedRows.size} employees in ${file.name} were not on record and have been added. Use Merge names to combine any duplicates.`);
  }
  const skipped: string[] = [];

  // Merge uploads for the same month. Existing employees/dates not present in
  // this file remain; matching employee/date rows are refreshed.
  const periodStart = `${periodMonth}-01`;
  const nextMonth = new Date(`${periodStart}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const periodEnd = nextMonth.toISOString().slice(0, 10);
  // row_count stays 0 and status stays 'pending' until records are actually
  // stored, so a half-finished import can never look like a successful one.
  const importResult = await client.from('attendance_imports').insert({ filename: file.name, period_month: periodMonth, row_count: 0, status: 'pending' }).select('id').single();
  if (importResult.error) throw new Error(`Attendance import could not be created: ${importResult.error.message}`);
  try {
  const mappedRecords = parsed.flatMap(row => {
    const employee = resolveEmployee(row);
    // Skip and report rather than abort: one unmatchable name must not cost
    // the entire upload.
    if (!employee) { skipped.push(String(row.employeeName)); return []; }
    const department = String(row.department || employee.department || '');
    const status = String(row.status);
    const recordDate = String(row.recordDate);
    const sunday = new Date(`${recordDate}T00:00:00Z`).getUTCDay() === 0;
    let finalStatus = sunday && isIt(department) && !statusIsOneOf(status, [...paidLeaveStatuses]) ? 'Weekend' : status;
    const timeIn = parseTime(row.timeIn);
    const timeOut = parseTime(row.timeOut);
    let workHours = timeIn !== null && timeOut !== null ? Math.max(0, (timeOut < timeIn ? timeOut + 24 : timeOut) - timeIn) : null;
    let overtimeHours = 0;
    const detectedShift = timeIn === null ? null : nearestConfiguredShift(employee.shift_timings, Math.round(timeIn * 60));
    if (detectedShift && timeIn !== null && !statusIsOneOf(finalStatus, ['Absent', 'Weekend', 'Holiday', 'Paid Leave'])) {
      const scheduledEnd = detectedShift.end <= detectedShift.start ? detectedShift.end + 1440 : detectedShift.end;
      const scheduledMinutes = scheduledEnd - detectedShift.start;
      const outMinutes = timeOut === null ? null : Math.round(timeOut * 60) + (timeOut < timeIn ? 1440 : 0);
      const inMinutes = Math.round(timeIn * 60);
      workHours = outMinutes === null ? null : (outMinutes - inMinutes) / 60;
      // Overtime is disabled globally; work hours remain available for
      // attendance and shift-status calculations only.
      overtimeHours = 0;
      if (outMinutes === null) finalStatus = 'Missed Swipe';
      else if ((outMinutes - inMinutes) / 60 < HALF_DAY_HOURS) finalStatus = 'HALF_DAY';
      else if (inMinutes > detectedShift.start + SHIFT_LATE_GRACE_MINUTES) finalStatus = 'Late Coming';
      else if (outMinutes < scheduledEnd) finalStatus = 'Early Leaving';
      else finalStatus = 'Normal';
    }
    return [{ import_id: importResult.data.id, employee_id: employee.id, record_date: recordDate, status: finalStatus, time_in_raw: row.timeIn ? String(row.timeIn) : null, time_out_raw: row.timeOut ? String(row.timeOut) : null, work_hours: workHours, overtime_hours: overtimeHours, deduction_days: statusIsOneOf(finalStatus, ['Absent']) ? 1 : statusIsOneOf(finalStatus, ['HALF_DAY']) ? 0.5 : 0, policy_code: isIt(department) ? 'it' : 'non_it' }];
  });
  // Different source employee numbers can still resolve to the same canonical
  // employee (for example SAHIL / sahil jha soft). Deduplicate only after
  // resolving the employee ID, which is the database uniqueness key.
  const uniqueMappedRecords = new Map<string, typeof mappedRecords[number]>();
  for (const record of mappedRecords) {
    const key = `${record.employee_id}|${record.record_date}`;
    const current = uniqueMappedRecords.get(key);
    const score = (value: typeof record) => Number(Boolean(value.time_in_raw)) + Number(Boolean(value.time_out_raw)) + Number(!statusIsOneOf(value.status, ['Absent', 'Missed Swipe']));
    if (!current || score(record) >= score(current)) uniqueMappedRecords.set(key, record);
  }
  const records = [...uniqueMappedRecords.values()];
  // Upsert on the (employee_id, record_date) unique key. The previous version
  // deleted the period's records first, so any failure in the insert loop
  // destroyed the existing month and left nothing in its place.
  for (let start = 0; start < records.length; start += 500) {
    const saved = await client.from('attendance_records')
      .upsert(records.slice(start, start + 500), { onConflict: 'employee_id,record_date' });
    if (saved.error) throw new Error(`Attendance records could not be saved: ${saved.error.message}`);
  }
  // Only once the records are stored: adopt the rest of the month and retire
  // the superseded import rows.
  const reassignExisting = await client.from('attendance_records')
    .update({ import_id: importResult.data.id })
    .gte('record_date', periodStart)
    .lt('record_date', periodEnd);
  if (reassignExisting.error) throw new Error(`Existing ${periodMonth} attendance could not be merged: ${reassignExisting.error.message}`);
  const oldImports = await client.from('attendance_imports').delete().eq('period_month', periodMonth).neq('id', importResult.data.id);
  if (oldImports.error) throw new Error(`Previous ${periodMonth} imports could not be cleaned up: ${oldImports.error.message}`);

  const mergedCount = await client.from('attendance_records').select('id', { count: 'exact', head: true }).eq('import_id', importResult.data.id);
  const storedCount = mergedCount.error ? records.length : (mergedCount.count || 0);
  const finalise = await client.from('attendance_imports').update({ row_count: storedCount, status: 'processed' }).eq('id', importResult.data.id);
  if (finalise.error) throw new Error(`Attendance import could not be completed: ${finalise.error.message}`);
  if (skipped.length) {
    const distinct = [...new Set(skipped)];
    warnings.push(`${skipped.length} rows were skipped because these names could not be matched: ${distinct.slice(0, 10).join(', ')}${distinct.length > 10 ? `, +${distinct.length - 10} more` : ''}.`);
  }
  return { data: { uploadId: importResult.data.id, periodMonth, rowCount: storedCount, warnings } };
  } catch (error) {
    // Leave a truthful record instead of an import row that claims success.
    await client.from('attendance_imports')
      .update({ status: 'failed', row_count: 0 })
      .eq('id', importResult.data.id);
    throw error;
  }
};
export const getUploads = async () => {
  const { data, error } = await directClient().from('attendance_imports').select('*').order('uploaded_at', { ascending: false });
  return directResult((data || []).map((row: any) => ({ ...row, periodMonth: row.period_month, rowCount: row.row_count, uploadedAt: row.uploaded_at })), error);
};
export const getAttendanceSummary = async (uploadId: number) => {
  // Only the two columns the summary counts on, and names resolved from one
  // employee read instead of embedded on every row.
  const { data, error } = await fetchAllRows<any>((from, to) => directClient().from('attendance_records').select('employee_id,status', { count: 'exact' }).eq('import_id', uploadId).range(from, to));
  if (error) throw new Error(error.message);
  const rowsForSummary = data || [];
  const summaryIds = [...new Set(rowsForSummary.map((row: any) => row.employee_id))];
  const employeeRows = summaryIds.length
    ? (await directClient().from('employees').select('id,name,email').in('id', summaryIds)).data || []
    : [];
  const employeeById = new Map<number, any>(employeeRows.map((e: any) => [e.id, e]));
  const grouped = new Map<number, any>();
  for (const row of rowsForSummary) {
    const employee = employeeById.get(row.employee_id) || {};
    const item = grouped.get(row.employee_id) || { employeeId: row.employee_id, employeeName: employee.name || '', employeeEmail: employee.email || '', absentDays: 0, missedSwipeDays: 0, lateComingDays: 0, earlyLeavingDays: 0, flaggedTotal: 0, lopDays: 0, lopAmount: 0, hasDraft: false, draftStatus: null, draftId: null };
    const status = String(row.status || '').toLowerCase();
    if (status.includes('absent')) { item.absentDays++; item.lopDays++; }
    if (status.includes('missed') || status.includes('incomplete')) item.missedSwipeDays++;
    if (status.includes('late')) item.lateComingDays++;
    if (status.includes('early')) item.earlyLeavingDays++;
    if (status.includes('absent') || status.includes('missed') || status.includes('late') || status.includes('early')) item.flaggedTotal++;
    grouped.set(row.employee_id, item);
  }
  const draftQuery = await directClient().from('email_messages').select('id,employee_id,status').eq('import_id', uploadId);
  if (!draftQuery.error) for (const draft of draftQuery.data || []) { const item = grouped.get(draft.employee_id); if (item) { item.hasDraft = true; item.draftStatus = draft.status; item.draftId = draft.id; } }
  return { data: Array.from(grouped.values()) };
};
export const getAttendanceRecords = async (uploadId: number, employeeId: number) => {
  const { data, error } = await directClient().from('attendance_records').select('*').eq('import_id', uploadId).eq('employee_id', employeeId).order('record_date');
  return directResult((data || []).map((row: any) => ({ ...row, recordDate: row.record_date, timeIn: row.time_in || row.time_in_raw, timeOut: row.time_out || row.time_out_raw, timeInRaw: row.time_in_raw, timeOutRaw: row.time_out_raw })), error);
};
// Emails
export const getEmailDrafts = async (uploadId: number) => {
  const { data, error } = await directClient().from('email_messages').select('*, employees(name,email)').eq('import_id', uploadId).order('created_at', { ascending: false });
  return directResult((data || []).map((row: any) => ({ ...row, employeeId: row.employee_id, employeeName: row.employees?.name, employeeEmail: row.employees?.email, templateType: row.template_type, isEdited: row.is_edited, sentAt: row.sent_at })), error);
};
export const updateDraft = async (draftId: number, data: { subject: string; body: string }) => {
  const { data: saved, error } = await directClient().from('email_messages').update({ subject: data.subject, body: data.body, is_edited: true }).eq('id', draftId).select().single();
  return directResult(saved, error);
};
export const deleteUnsentDraftsForUpload = async (uploadId: number) => {
  const { data, error } = await directClient()
    .from('email_messages')
    .delete()
    .eq('import_id', uploadId)
    .in('status', ['draft', 'pending'])
    .select('id');
  return directResult(data || [], error);
};
// Drafts are read and edited through Supabase; actually delivering them needs
// SMTP credentials, which cannot live in the browser. That waits on an edge
// function.
export const sendEmail = (_draftId: number) => notMigrated('Sending email');
export const sendBulk = (_draftIds: number[]) => notMigrated('Sending email');
export const getEmailHistory = async (month?: string, employeeId?: number) => {
  let query = directClient().from('email_messages').select('*, employees(name,email)').not('sent_at', 'is', null).order('sent_at', { ascending: false });
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (month) query = query.gte('sent_at', `${month}-01T00:00:00Z`).lt('sent_at', `${month}-32T00:00:00Z`);
  const { data, error } = await query;
  return directResult((data || []).map((row: any) => ({ ...row, employeeName: row.employees?.name, employeeEmail: row.employees?.email, sentAt: row.sent_at })), error);
};
// Depends on sendEmail, so it waits on the same edge function.
export const checkPendingReminders = () => notMigrated('Pending reminders');

// Salary
// Salary lives on employees.monthly_salary — one current salary per employee,
// maintained from the Employee Master screen and the staff-master import. The
// `month` argument is accepted so callers can keep passing the viewed month,
// but there is no per-month salary history to select from.
export const getSalaryConfigs = async (month?: string) => {
  const { data, error } = await directClient().from('employees').select('id,monthly_salary');
  return directResult((data || []).map((row: any) => ({ employeeId: row.id, basicSalary: row.monthly_salary == null ? null : Number(row.monthly_salary) })), error);
};
export const getSalaryDeductions = async (uploadId: number) => {
  const client = directClient();

  // Handle case where there's no attendance upload (uploadId is 0)
  // Return empty salary data but still fetch management adjustments
  if (!uploadId || uploadId === 0) {
    // Fetch standalone management adjustments (upload_id 0)
    const standaloneAdjustments = await client.from('salary_management_adjustments').select('employee_id,amount,remarks').eq('upload_id', 0);
    if (standaloneAdjustments.error && standaloneAdjustments.error.code !== 'PGRST116') {
      throw new Error(standaloneAdjustments.error.message);
    }

    const adjustmentMap = new Map<number, { amount: number; remarks: string }>(
      (standaloneAdjustments.data || []).map((a: any) => [a.employee_id, { amount: Number(a.amount), remarks: a.remarks }])
    );

    // Return empty array since we can't calculate salary without attendance data
    // The management adjustments will be handled separately
    return { data: [] };
  }

  const upload = await client.from('attendance_imports').select('period_month').eq('id', uploadId).single();
  if (upload.error) throw new Error(upload.error.message);
  const periodStart = `${upload.data.period_month}-01`;
  const lateCountHidden = LATE_COUNT_HIDDEN_MONTHS.has(upload.data.period_month);
  const nextMonth = new Date(`${periodStart}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const periodEnd = nextMonth.toISOString().slice(0, 10);
  // Pay is counted up from the days owed, so the length of the month matters:
  // it is what a full attendance is measured against, and what tells us whether
  // the import covered every date.
  const daysInMonth = Math.round((new Date(`${periodEnd}T00:00:00Z`).getTime() - new Date(`${periodStart}T00:00:00Z`).getTime()) / 86400000);
  // Use the month as the source of truth. Imports are merged/replaced during
  // re-upload, so the newest import ID may not own every valid record.
  const records = await fetchAllRows<any>((from, to) => client.from('attendance_records').select('employee_id,record_date,status,work_hours,time_in,policy_code', { count: 'exact' }).gte('record_date', periodStart).lt('record_date', periodEnd).range(from, to));
  if (records.error) throw new Error(records.error.message);
  const rows = records.data || [];
  // Payroll covers the real calendar month. A day's pay is still salary over
  // thirty, but the 31st is a working day like any other and is no longer
  // discarded.
  const payrollRows = rows.filter((row: any) => !Number.isNaN(new Date(`${String(row.record_date).slice(0, 10)}T00:00:00Z`).getTime()));
  const ids = [...new Set(rows.map((row: any) => row.employee_id))];
  if (!ids.length) return { data: [] };
  const salaries = await client.from('employees').select('id,name,email,department,organisation,entity,designation,branch,status,eligible_for_paid_leaves,monthly_salary,contracted_hours').in('id', ids);
  if (salaries.error) throw new Error(salaries.error.message);
  const salaryMap = new Map<number, number>();
  // The contracted shift comes from the staff sheet. A completed shift is a
  // full day whatever its length, so a six-hour sister is not docked for
  // finishing on time. Null falls back to the flat threshold below.
  const contractedMap = new Map<number, number | null>();
  // Employee details are read once here rather than embedded on every
  // attendance row, where each person's record repeated for all 31 days of the
  // month and tripled the payload.
  const employeeMap = new Map<number, any>();
  for (const row of salaries.data || []) {
    salaryMap.set(row.id, Number(row.monthly_salary || 0));
    contractedMap.set(row.id, row.contracted_hours == null ? null : Number(row.contracted_hours));
    employeeMap.set(row.id, row);
  }
  // Fetch management adjustments for this upload AND standalone adjustments (upload_id 0)
  const [adjustments, standaloneAdjustments] = await Promise.all([
    client.from('salary_management_adjustments').select('employee_id,amount,remarks').eq('upload_id', uploadId),
    client.from('salary_management_adjustments').select('employee_id,amount,remarks').eq('upload_id', 0)
  ]);
  if (adjustments.error && adjustments.error.code !== 'PGRST116') throw new Error(adjustments.error.message);
  if (standaloneAdjustments.error && standaloneAdjustments.error.code !== 'PGRST116') throw new Error(standaloneAdjustments.error.message);

  // Merge both sources - upload-specific adjustments take precedence over standalone ones
  const adjustmentMap = new Map<number, { amount: number; remarks: string }>();
  for (const a of (standaloneAdjustments.data || [])) {
    adjustmentMap.set(a.employee_id, { amount: Number(a.amount), remarks: a.remarks });
  }
  for (const a of (adjustments.data || [])) {
    adjustmentMap.set(a.employee_id, { amount: Number(a.amount), remarks: a.remarks });
  }

  const [{ data: activeRules, error: rulesError }, { data: settings, error: settingsError }] = await Promise.all([
    client.from('attendance_rules').select('rule_type,conditions,actions,description,name').eq('is_active', true),
    client.from('settings').select('key,value'),
  ]);
  if (rulesError || settingsError) throw new Error(rulesError?.message || settingsError?.message);
  const policyText = JSON.stringify(activeRules || []).toLowerCase();
  const settingMap = new Map((settings || []).map((row: any) => [row.key, row.value]));
  let lateAfterMinutes = Number(settingMap.get('late_after_minutes') || 570);
  let lateEvery = Number(settingMap.get('late_occurrences_for_deduction') || 3);
  let halfDayHours = Number(settingMap.get('half_day_threshold_hours') || HALF_DAY_HOURS);
  // The monthly paid-leave allowance. Both keys are seeded by
  // 20260806_attendance_salary_policies.sql, so the limit can be retuned from
  // the settings table without touching this file; the fallbacks match the seed.
  const itLeaveLimit = Number(settingMap.get('it_paid_leave_limit') || 2);
  const nonItLeaveLimit = Number(settingMap.get('non_it_paid_leave_limit') || 4);
  const lateTime = policyText.match(/(?:after|greater than|more than)\D{0,20}(\d{1,2})\s*:\s*(\d{2})/);
  if (lateTime) lateAfterMinutes = Number(lateTime[1]) * 60 + Number(lateTime[2]);
  const lateCount = policyText.match(/(?:every|set of|divide|÷|\/|by)\D{0,12}(\d+)\s*(?:late|occurrence|day)?/);
  if (lateCount) lateEvery = Math.max(1, Number(lateCount[1]));
  const halfDay = policyText.match(/(?:less than|under|below)\D{0,12}(\d+(?:\.\d+)?)\s*hours?/);
  if (halfDay) halfDayHours = Number(halfDay[1]);
  const timeInMinutes = (value: unknown) => {
    const text = String(value || '');
    const match = text.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getHours() * 60 + parsed.getMinutes();
  };
  const grouped = new Map<number, any>();
  const allStatuses = new Set<string>();
  const noPunchRecords: any[] = [];
  for (const row of payrollRows as any[]) {
    // Track all unique status values
    if (row.status) allStatuses.add(row.status);
    // Check for no-punch records (no time_in)
    const hasNoPunch = !row.time_in || row.time_in === '' || row.time_in === null;
    if (hasNoPunch && row.status && !['weekend', 'holiday'].includes(String(row.status || '').toLowerCase())) {
      noPunchRecords.push({
        employeeId: row.employee_id,
        date: row.record_date,
        status: row.status,
        work_hours: row.work_hours
      });
    }
    const employee = employeeMap.get(row.employee_id) || {};
    const item = grouped.get(row.employee_id) || { employeeId: row.employee_id, employeeName: employee.name || '', employeeEmail: employee.email || '', department: employee.department || '', organisation: employee.organisation || '', entity: employee.entity || '', eligibleForPaidLeaves: employee.eligible_for_paid_leaves === true, presentDays: 0, attendedDays: 0, datesSeen: new Set<string>(), absentDays: 0, totalAbsentDays: 0, absentSunday: 0, absentNonSunday: 0, halfDays: 0, missedSwipeDays: 0, lateOccurrences: 0, paidLeaveUsed: 0, overtimeHours: 0, extraDays: 0, workedWeeklyOffs: 0, overtimeEligibleDays: 0, itRecords: 0, overtimePayableDays: 0, overtimePayment: 0 };
    // Days-up pay cannot notice a date that was never imported, so the spread of
    // dates is tracked here and checked against the month below.
    item.datesSeen.add(String(row.record_date).slice(0, 10));
    if (String(row.policy_code || '').toLowerCase() === 'it') item.itRecords++;
    const status = String(row.status || '').toLowerCase();
    // Rafttar is the exception; every other entity follows the hospital shift
    // ladder. Matched here rather than by organisation alone because the IT
    // team is recorded as "Rafttar/Hope".
    const rafttarStaff = /rafttar/i.test(`${employee.organisation || ''} ${employee.entity || ''} ${employee.department || ''}`);

    // Sunday is a paid weekly off for Rafttar, and an ordinary working day for
    // hospital staff. Taken from the calendar rather than the imported status,
    // because the importer only ever stamped Weekend on the one employee whose
    // department literally read "IT". One paid day whether or not they punched.
    const isSunday = new Date(`${String(row.record_date).slice(0, 10)}T00:00:00Z`).getUTCDay() === 0;

    // Under four hours is half a day for everyone — the same rule whatever the
    // entity or the contracted shift length. The contracted hours still decide
    // what counts as an extra shift below, but no longer what counts as half a day.
    const halfBelow = halfDayHours;
    const hours = row.work_hours === null || row.work_hours === undefined ? null : Number(row.work_hours);
    // Monthly fuel for the Rules Engine context (attendance.workingHours).
    if (hours !== null) {
      item.totalWorkHours = (item.totalWorkHours || 0) + hours;
      item.daysWithHours = (item.daysWithHours || 0) + 1;
    }

    if (rafttarStaff && isSunday) {
      // The weekly off is paid whether or not they came in. If they did come in,
      // the day is also an entitled off they did not take, and earns a second
      // day's pay in the result map below. The status is no guide here — the
      // importer stamps Weekend over a worked Sunday — so trust the punch.
      item.presentDays++;
      item.attendedDays++;
      const attended = (row.time_in != null || Number(row.work_hours || 0) > 0)
        && !['absent', 'holiday', 'paid leave'].includes(status);
      if (attended) item.workedWeeklyOffs += hours !== null && hours < halfBelow ? 0.5 : 1;
      grouped.set(row.employee_id, item);
      continue;
    }

    const workingDay = !['absent', 'weekend', 'holiday', 'paid leave'].includes(status);
    // Pay is counted up from the days owed, so every branch below states what the
    // day is worth and the cap is applied once, at the end. A worked date never
    // earns more than one attendance day.
    let dayCredit = 0;

    if (workingDay && hours !== null) {
      if (rafttarStaff) {
        // Standard 09:00-18:00 day. Extra hours are attendance-only;
        // overtime is not payable for any employee.
        item.presentDays++;
        dayCredit = 1;
        if (hours < halfBelow) item.halfDays++;
      } else {
        // A worked date counts as one attendance day regardless of extra
        // hours. Only a short shift can reduce the credit to a half day.
        const credit = hours < halfBelow ? 0.5 : 1;
        item.presentDays += credit;
        dayCredit = credit;
        if (credit === 0.5) item.halfDays++;
      }
    } else if (statusIsOneOf(status, ['Missed Swipe'])) {
      // They were here — the punch out is simply missing. Credit the duty and
      // keep the flag so the reminder still goes out.
      item.presentDays++;
      dayCredit = 1;
    } else if (['normal', 'present', 'late', 'late coming', 'early leaving'].includes(status)) {
      // A working day with no usable punch span still counts as attendance.
      item.presentDays++;
      dayCredit = 1;
    } else if (['holiday', 'weekend'].includes(status) || statusIsOneOf(status, ['Official'])) {
      // A declared holiday, a rostered off and a day spent on official duty are
      // all paid days that nobody punches for. Counting down from the salary
      // they needed no branch, because they cost nothing; counting up, a day
      // left uncounted is a day left unpaid. They are not attendance, so
      // presentDays is deliberately untouched.
      dayCredit = 1;
    }
    if (status === 'half_day' || status === 'half day') { item.presentDays += 0.5; dayCredit += 0.5; }
    item.attendedDays += Math.min(dayCredit, 1);
    if (status === 'absent') {
      item.totalAbsentDays++;
      // A hospital Sunday absence is always chargeable; the monthly
      // allowance only ever covers non-Sunday absences.
      if (isSunday) item.absentSunday++; else item.absentNonSunday++;
    }
    if (status.includes('missed') || status.includes('incomplete')) item.missedSwipeDays++;
    const checkInMinutes = timeInMinutes(row.time_in);
    // Counted for reporting only — lateness no longer costs anything — and not
    // even counted for the months whose count is hidden outright.
    if (!lateCountHidden && (status.includes('late') || (checkInMinutes !== null && checkInMinutes > lateAfterMinutes))) item.lateOccurrences++;
    if (status.includes('paid leave') || status.includes('casual leave') || status.includes('sick leave')) item.paidLeaveUsed++;
    grouped.set(row.employee_id, item);
  }
    // Active Rules Engine rules are evaluated per employee below, so their
  // pay effects show in the salary sheet and calculation breakdowns.
  let payrollRules: any[] = [];
  try { payrollRules = await fetchActivePayrollRules(); } catch (e) { console.warn('[payroll] Rules Engine unavailable, skipping rule effects:', e); }

const result = [...grouped.values()].map(item => {
    const basicSalary = salaryMap.get(item.employeeId) || 0;
    const dailySalary = basicSalary / 30;
    const isIt = item.itRecords > 0 || /\bit\b|information technology/i.test(`${item.department} ${item.organisation} ${item.entity}`);
    const rafttarStaff = /rafttar/i.test(`${item.organisation} ${item.entity} ${item.department}`);
    // Rafttar already has every Sunday off and gets two further paid leaves.
    // Hospital staff work Sundays, and get a flat monthly allowance.
    const leaveLimit = rafttarStaff ? itLeaveLimit : nonItLeaveLimit;
    // A hospital Sunday is an ordinary working day, but an absence on one now
    // draws on the same allowance as any other day rather than being charged
    // outright. One pool serves both groups: Rafttar's Sunday is credited as a
    // paid weekly off above and never reaches this branch as absence, so their
    // absentSunday stays nil and absentDays is their non-Sunday count.
    const protectedAbsentDays = Math.min(item.totalAbsentDays, Math.max(0, leaveLimit - item.paidLeaveUsed));
    const chargeableAbsentDays = Math.max(0, item.totalAbsentDays - protectedAbsentDays);
    const excessPaidLeave = Math.max(0, item.paidLeaveUsed - leaveLimit);
    // Update absentDays to show only chargeable absences (unpaid beyond allowance)
    item.absentDays = chargeableAbsentDays;
    // Lateness is recorded but never charged, so the count is carried through at
    // nil to keep the shape of the row stable for callers.
    const lateDeductionCount = 0;
    const absenceDeduction = chargeableAbsentDays * dailySalary;
    const halfDayDeduction = item.halfDays * dailySalary * 0.5;
    const lateDeduction = 0;
    const excessLeaveDeduction = excessPaidLeave * dailySalary;
    // An entitled off that was worked rather than taken is paid for. Two kinds
    // exist: a Sunday Rafttar came in on, counted above, and leave allowance
    // still unspent at month end. Absences and taken leave eat the allowance
    // first, so only what is genuinely left over is paid.
    const unusedLeaveDays = Math.max(0, leaveLimit - item.paidLeaveUsed - protectedAbsentDays);
    const workedWeeklyOffPay = item.workedWeeklyOffs * dailySalary;
    const unusedLeavePay = unusedLeaveDays * dailySalary;
    const extraPayableDays = item.workedWeeklyOffs + unusedLeaveDays;
    const overtimePayment = 0;
    const extraPayment = workedWeeklyOffPay + unusedLeavePay;
    // Extra shifts and overtime never create overtime pay or extra payment.

    // Pay is counted up from the days owed rather than down from the salary.
    // Days attended, plus the offs the monthly allowance covers, at a day's pay
    // each. The allowance is one pool: leave taken draws on it first, and what
    // is left shields absences.
    const paidOffDays = Math.min(item.paidLeaveUsed + item.totalAbsentDays, leaveLimit);
    const payableDays = item.attendedDays + paidOffDays;
    // Thirty days of pay is the month's ceiling however long the month runs, so
    // a thirty-one day month with perfect attendance still pays the salary and
    // no more. Only an off that went untaken is added past it.
    const basePay = Math.min(basicSalary, payableDays * dailySalary);
    // What the month did not pay for. In a thirty-one day month this will not
    // reconcile against the salary — thirty days of pay cannot cover thirty-one
    // days of month — which is why the breakdown leads with the days.
    const lopDays = Math.max(0, daysInMonth - payableDays);
    const totalLopAmount = lopDays * dailySalary;
    // A date that was never imported is a day that cannot be paid, so the spread
    // travels with the row and the salary sheet flags a short month rather than
    // quietly paying less than the person is owed.
    const daysCovered = item.datesSeen.size;
    const { datesSeen: _datesSeen, ...counts } = item;
    // Management adjustment (bonus or deduction) from admin
    const mgmtAdjustment = adjustmentMap.get(item.employeeId);
    const managementAdjustment = mgmtAdjustment ? mgmtAdjustment.amount : 0;
    const managementAdjustmentRemarks = mgmtAdjustment ? mgmtAdjustment.remarks : null;
    // The individual amounts travel with the totals so the salary sheet can
    // explain, line by line, how the pay was arrived at.
    // Rules Engine bridge — active Rules Engine rules can adjust this row's
    // pay (deductions and bonuses) with a per-rule breakdown for payslips.
    const ruleOutcome = payrollRules.length
      ? evaluatePayrollRules(payrollRules, {
          employeeName: item.employeeName, department: item.department, organisation: item.organisation,
          designation: employeeMap.get(item.employeeId)?.designation,
          branch: employeeMap.get(item.employeeId)?.branch,
          employeeStatus: employeeMap.get(item.employeeId)?.status,
          basicSalary, dailySalary, presentDays: counts.presentDays, absentDays: counts.absentDays,
          halfDays: counts.halfDays, missedSwipeDays: counts.missedSwipeDays,
          lateOccurrences: counts.lateOccurrences, overtimeHours: counts.overtimeHours,
          lopDays, lopAmount: totalLopAmount, netPayable: basePay + extraPayment + managementAdjustment,
          leaveLimit, paidLeaveUsed: item.paidLeaveUsed, workedWeeklyOffs: item.workedWeeklyOffs,
          avgWorkingHours: item.daysWithHours ? +(item.totalWorkHours / item.daysWithHours).toFixed(2) : 0,
          extraPayment, overtimePayment, period: upload.data.period_month,
        })
      : { effects: [], totalDeduction: 0, totalBonus: 0, appliedRuleNames: [] };

    return { ...counts, isIt, rafttarStaff, leaveLimit, protectedAbsentDays, chargeableAbsentDays, excessPaidLeave, paidLeaveUsed: item.paidLeaveUsed, paidLeaveDays: item.paidLeaveUsed, lateDeductionCount, lateAfterMinutes, lateEvery, halfDayHours, daysInMonth, daysCovered, paidOffDays, payableDays, basePay, lopDays, lopAmount: totalLopAmount, absenceDeduction, halfDayDeduction, lateDeduction, excessLeaveDeduction, unusedLeaveDays, workedWeeklyOffPay, unusedLeavePay, extraPayableDays, extraPayment, overtimePayment, managementAdjustment, managementAdjustmentRemarks,
      ruleEffects: ruleOutcome.effects as PayrollRuleEffect[],
      ruleDeductions: ruleOutcome.totalDeduction,
      ruleBonus: ruleOutcome.totalBonus,
      // Rule additions and deductions stack with management adjustments, but
      // payroll must never produce a negative amount payable.
      netPayable: Math.max(0, basePay + extraPayment + managementAdjustment - ruleOutcome.totalDeduction + ruleOutcome.totalBonus),
      dailySalary, totalLopAmount, basicSalary };
  });
  // Debug logging to identify no-punch records and all status values
  console.log('📋 All unique status values in database:', Array.from(allStatuses).sort());
  console.log('🚫 No-punch records (excluding weekend/holiday):', noPunchRecords.length, 'records');
  if (noPunchRecords.length > 0) {
    console.log('Sample no-punch records:', noPunchRecords.slice(0, 10));
    const statusCounts = noPunchRecords.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    console.log('No-punch records by status:', statusCounts);
  }
  // Deductions are derived on every read, so there is nothing to cache back to
  // the database. The previous write-back also stored an undefined
  // half_day_deduction, because that value never made it onto the result rows.
  return { data: result };
};

// Management Adjustments
export const getManagementAdjustments = async (uploadId: number) => {
  const { data, error } = await directClient()
    .from('salary_management_adjustments')
    .select('employee_id,amount,remarks,created_at,updated_at')
    .eq('upload_id', uploadId);
  return directResult(data || [], error);
};

// Fetch all management adjustments (both upload-specific and standalone upload_id 0)
export const getAllManagementAdjustments = async () => {
  const { data, error } = await directClient()
    .from('salary_management_adjustments')
    .select('employee_id,upload_id,amount,remarks,created_at,updated_at')
    .order('updated_at', { ascending: false });
  return directResult(data || [], error);
};

export const saveManagementAdjustment = async (
  employeeId: number,
  uploadId: number | null,
  amount: number,
  remarks: string
) => {
  const effectiveUploadId = uploadId ?? 0; // Use 0 for adjustments without attendance upload
  const { data, error } = await directClient()
    .from('salary_management_adjustments')
    .upsert({
      employee_id: employeeId,
      upload_id: effectiveUploadId,
      amount: amount,
      remarks: remarks.trim(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'employee_id,upload_id' })
    .select()
    .single();
  return directResult(data, error);
};

export const deleteManagementAdjustment = async (
  employeeId: number,
  uploadId: number | null
) => {
  const effectiveUploadId = uploadId ?? 0; // Use 0 for adjustments without attendance upload
  const { data, error } = await directClient()
    .from('salary_management_adjustments')
    .delete()
    .eq('employee_id', employeeId)
    .eq('upload_id', effectiveUploadId)
    .select()
    .single();
  return directResult(data, error);
};

// Settings
export const getSettings = async () => {
  const { data, error } = await directClient().from('settings').select('key,value');
  return directResult(Object.fromEntries((data || []).map((row: any) => [row.key, row.value])), error);
};
export const saveSettings = async (data: Record<string, string>) => {
  const { data: saved, error } = await directClient().from('settings').upsert(Object.entries(data).map(([key, value]) => ({ key, value })));
  return directResult(saved, error);
};
export const getTemplates = async () => {
  const { data, error } = await directClient().from('email_templates').select('*').order('type');
  return directResult(data || [], error);
};
export const saveTemplate = async (type: string, data: { subject: string; body: string }) => {
  const { data: saved, error } = await directClient().from('email_templates').upsert({ type, subject: data.subject, body: data.body }, { onConflict: 'type' }).select().single();
  return directResult(saved, error);
};

// Employees
export interface SalaryLedger {
  id: number;
  accountName: string;
  accountCode: string;
  accountId: string | null;
}

export const getSalaryLedgers = async () => {
  if (!adamritSupabase) throw new Error('Adamrit Supabase is not configured.');
  const { data: adamritAccounts, error: adamritError } = await adamritSupabase
    .from('chart_of_accounts')
    .select('id,account_code,account_name,is_active')
    .eq('is_active', true)
    .order('account_name');
  if (adamritError) throw new Error(`Adamrit chart of accounts could not be loaded: ${adamritError.message}`);

  const local = directClient();
  const { error: syncError } = await local
    .from('salary_ledgers')
    .upsert((adamritAccounts || []).map((row: any) => ({
      account_name: row.account_name,
      account_code: row.account_code,
      adamrit_account_id: row.id,
    })), { onConflict: 'account_code' });
  if (syncError) throw new Error(`Adamrit ledgers could not be linked in HRPulse: ${syncError.message}`);

  const { data, error } = await local
    .from('salary_ledgers')
    .select('id,account_name,account_code,adamrit_account_id')
    .order('account_name');
  return directResult((data || []).map((row: any) => ({
    id: row.id,
    accountName: row.account_name,
    accountCode: row.account_code,
    accountId: row.adamrit_account_id,
  } as SalaryLedger)), error);
};

export const getEmployees = async () => {
  const client = directClient();
  const [{ data, error }, { data: ledgers, error: ledgerError }] = await Promise.all([
    client.from('employees').select('*').order('name'),
    client.from('salary_ledgers').select('id,account_name,account_code'),
  ]);
  if (error || ledgerError) throw new Error(error?.message || ledgerError?.message);
  const ledgerById = new Map((ledgers || []).map((row: any) => [String(row.id), row]));
  return directResult((data || []).map((row: any) => ({
    ...row, employeeId: row.employee_number, photoUrl: row.photo_url, createdAt: row.created_at,
    actualDesignation: row.designation, designation: row.biometric_name || row.designation, biometricName: row.biometric_name,
    ledgerId: row.salary_ledger_id ?? null,
    ledgerName: ledgerById.get(String(row.salary_ledger_id))?.account_name ?? null,
    accountCode: ledgerById.get(String(row.salary_ledger_id))?.account_code ?? null,
    basicSalary: row.monthly_salary == null ? null : Number(row.monthly_salary),
    shiftTimings: row.shift_timings || {}, eligibleForPaidLeaves: row.eligible_for_paid_leaves, eligibleForOvertime: row.eligible_for_overtime,
  })), null);
};
export const getEmployee = (id: number) => directClient().from('employees').select('*').eq('id', id).single();
export const mergeEmployees = async (keepId: number, mergeId: number) => {
  const client = directClient();
  const [keep, merge] = await Promise.all([
    client.from('employees').select('id,name,monthly_salary').eq('id', keepId).single(),
    client.from('employees').select('id,name,monthly_salary').eq('id', mergeId).single(),
  ]);
  if (keep.error || merge.error) throw new Error(keep.error?.message || merge.error?.message);

  // Avoid the unique employee/date conflict before moving the remaining rows.
  const [keepRecords, mergeRecords] = await Promise.all([
    client.from('attendance_records').select('id,record_date').eq('employee_id', keepId),
    client.from('attendance_records').select('id,record_date').eq('employee_id', mergeId),
  ]);
  if (keepRecords.error || mergeRecords.error) throw new Error(keepRecords.error?.message || mergeRecords.error?.message);
  const keepDates = new Set((keepRecords.data || []).map((row: any) => String(row.record_date)));
  const duplicateRecordIds = (mergeRecords.data || []).filter((row: any) => keepDates.has(String(row.record_date))).map((row: any) => row.id);
  if (duplicateRecordIds.length) {
    const deleted = await client.from('attendance_records').delete().in('id', duplicateRecordIds);
    if (deleted.error) throw new Error(deleted.error.message);
  }
  const movedRecords = await client.from('attendance_records').update({ employee_id: keepId }).eq('employee_id', mergeId);
  if (movedRecords.error) throw new Error(movedRecords.error.message);

  // Salary lives on the employee row. Keep the surviving employee's salary and
  // only inherit the merged one when the survivor has none recorded.
  if (!Number(keep.data.monthly_salary || 0) && Number(merge.data.monthly_salary || 0)) {
    const movedSalary = await client.from('employees').update({ monthly_salary: merge.data.monthly_salary }).eq('id', keepId);
    if (movedSalary.error) throw new Error(movedSalary.error.message);
  }
  const movedMessages = await client.from('email_messages').update({ employee_id: keepId }).eq('employee_id', mergeId);
  if (movedMessages.error) throw new Error(movedMessages.error.message);
  const removed = await client.from('employees').delete().eq('id', mergeId);
  if (removed.error) throw new Error(removed.error.message);
  return { data: { kept: keep.data.name, removed: merge.data.name } };
};
export const updateEmployee = async (id: number, data: { name?: string; email?: string; department?: string; employeeNumber?: string; mobile?: string; designation?: string; biometricName?: string; branch?: string; status?: string; monthlySalary?: number | null; shiftTimings?: Record<string, { start: string; end: string }>; eligibleForPaidLeaves?: boolean; eligibleForOvertime?: boolean; salaryLedgerId?: number | null }) => {
  const { data: saved, error } = await directClient().from('employees').update({
    name: data.name, email: data.email, department: data.department, designation: data.designation, biometric_name: data.biometricName,
    employee_number: data.employeeNumber, mobile: data.mobile, branch: data.branch, status: data.status,
    monthly_salary: data.monthlySalary,
    shift_timings: data.shiftTimings,
    eligible_for_paid_leaves: data.eligibleForPaidLeaves, eligible_for_overtime: data.eligibleForOvertime,
    salary_ledger_id: data.salaryLedgerId ?? null,
  }).eq('id', id).select().single();
  return directResult(saved, error);
};
export const createEmployee = async (data: { name: string; email?: string; department?: string; designation?: string; employeeNumber?: string; mobile?: string; branch?: string; status?: string; basicSalary?: number; eligibleForPaidLeaves?: boolean; eligibleForOvertime?: boolean; organisation?: string; biometricName?: string; salaryLedgerId?: number | null }) => {
  const { data: saved, error } = await directClient().from('employees').insert({
    name: data.name,
    email: data.email || `${data.name.toLowerCase().replace(/\s+/g, '.')}@hrpulse.local`,
    department: data.department || 'Rafttar',
    designation: data.designation || null,
    employee_number: data.employeeNumber || null,
    mobile: data.mobile || null,
    branch: data.branch || null,
    status: data.status || 'Active',
    monthly_salary: data.basicSalary || null,
    eligible_for_paid_leaves: data.eligibleForPaidLeaves !== false,
    eligible_for_overtime: data.eligibleForOvertime === true,
    organisation: data.organisation || null,
    biometric_name: data.biometricName || null,
    salary_ledger_id: data.salaryLedgerId ?? null,
  }).select().single();
  return directResult(saved, error);
};

export const deleteEmployee = async (id: number) => {
  const { data, error } = await directClient().from('employees').delete().eq('id', id).select().single();
  return directResult(data, error);
};
export interface ShiftOption {
  id: string;
  name: string;
  roleTarget: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  isOvernight: boolean;
}

export interface EmployeeShiftAssignment extends ShiftOption {
  assignmentId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const mapShift = (row: any): ShiftOption => ({
  id: row.id,
  name: row.name,
  roleTarget: row.roleTarget ?? row.role_target ?? 'GENERAL',
  startTime: row.startTime ?? row.start_time,
  endTime: row.endTime ?? row.end_time,
  graceMinutes: Number(row.graceMinutes ?? row.grace_minutes ?? 15),
  isOvernight: Boolean(row.isOvernight ?? row.is_overnight),
});

const mapAssignment = (row: any): EmployeeShiftAssignment => ({
  ...mapShift(row.shift || row),
  assignmentId: row.assignmentId ?? row.id,
  effectiveFrom: row.effectiveFrom ?? row.effective_from,
  effectiveTo: row.effectiveTo ?? row.effective_to ?? null,
});

export const getShiftOptions = async () => {
  const { data, error } = await directClient().from('shifts').select('*').eq('is_active', true).order('role_target').order('start_time');
  return directResult((data || []).map(mapShift), error);
};

export interface ShiftWindow { start: string; end: string; days: number }
export type DerivedTimings = Record<'morning' | 'evening' | 'night', ShiftWindow | undefined>;

const minutesToClock = (value: number) => {
  const wrapped = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

// Nobody has shift timings on record, so the only real source is what people
// actually punched. Group each employee's days into morning/evening/night by
// punch-in and take the median of each — a median so one stray 02:00 punch
// cannot drag a whole shift. Read-only: nothing is written back to employees,
// which would switch on the importer's shift detection.
export const getDerivedShiftTimings = async () => {
  const client = directClient();
  const records = await fetchAllRows<any>((from, to) => client.from('attendance_records')
    .select('employee_id,time_in_raw,time_out_raw', { count: 'exact' })
    .not('time_in_raw', 'is', null)
    .not('time_out_raw', 'is', null)
    .range(from, to));
  if (records.error) throw new Error(records.error.message);

  const buckets = new Map<number, Record<string, { in: number[]; out: number[] }>>();
  for (const row of records.data || []) {
    const start = timeValueToMinutes(row.time_in_raw);
    const end = timeValueToMinutes(row.time_out_raw);
    if (start === null || end === null) continue;
    const name = start < 12 * 60 ? 'morning' : start < 18 * 60 ? 'evening' : 'night';
    const perEmployee = buckets.get(row.employee_id) || {};
    const bucket = perEmployee[name] || { in: [], out: [] };
    bucket.in.push(start);
    // Keep overnight spans monotonic so the median is not pulled backwards.
    bucket.out.push(end < start ? end + 1440 : end);
    perEmployee[name] = bucket;
    buckets.set(row.employee_id, perEmployee);
  }

  const derived = new Map<number, DerivedTimings>();
  for (const [employeeId, perEmployee] of buckets) {
    const timings: DerivedTimings = { morning: undefined, evening: undefined, night: undefined };
    let any = false;
    for (const name of ['morning', 'evening', 'night'] as const) {
      const bucket = perEmployee[name];
      // Three days is the floor for calling something a pattern rather than a one-off.
      if (!bucket || bucket.in.length < 3) continue;
      timings[name] = { start: minutesToClock(median(bucket.in)), end: minutesToClock(median(bucket.out)), days: bucket.in.length };
      any = true;
    }
    if (any) derived.set(employeeId, timings);
  }
  return { data: derived };
};

// One query for the whole table so the employee list does not fire a request
// per row. Empty until shifts are assigned from the M / E / N modal.
export const getAllShiftAssignments = async () => {
  const { data, error } = await directClient().from('employee_shifts')
    .select('id,employee_id,effective_from,effective_to,shift:shifts(*)')
    .order('effective_from', { ascending: false });
  if (error) throw new Error(error.message);
  const latest = new Map<number, EmployeeShiftAssignment>();
  const today = new Date().toISOString().slice(0, 10);
  for (const row of data || []) {
    if (row.effective_to && String(row.effective_to) < today) continue;
    if (!latest.has(row.employee_id)) latest.set(row.employee_id, mapAssignment(row));
  }
  return { data: latest };
};

export const getEmployeeShiftAssignments = async (employeeId: number) => {
  const { data, error } = await directClient().from('employee_shifts').select('id,effective_from,effective_to,shift:shifts(*)').eq('employee_id', employeeId).order('effective_from', { ascending: false });
  return directResult((data || []).map(mapAssignment), error);
};

export interface SaveEmployeeShiftInput {
  shiftId?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  customShift?: { name: string; roleTarget: string; startTime: string; endTime: string; graceMinutes: number; isOvernight: boolean };
}

export const saveEmployeeShiftAssignment = async (employeeId: number, input: SaveEmployeeShiftInput) => {
  const client = directClient();
  let shiftId = input.shiftId;
  if (input.customShift) {
    const created = await client.from('shifts').insert({
      name: input.customShift.name,
      role_target: input.customShift.roleTarget,
      start_time: input.customShift.startTime,
      end_time: input.customShift.endTime,
      grace_minutes: input.customShift.graceMinutes,
      is_overnight: input.customShift.isOvernight,
    }).select('*').single();
    if (created.error) throw new Error(created.error.message);
    shiftId = created.data.id;
  }
  if (!shiftId) throw new Error('Select a shift or provide custom times');
  const saved = await client.from('employee_shifts').insert({ employee_id: employeeId, shift_id: shiftId, effective_from: input.effectiveFrom, effective_to: input.effectiveTo || null }).select('id,effective_from,effective_to,shift:shifts(*)').single();
  return directResult(saved.data ? mapAssignment(saved.data) : saved.data, saved.error);
};
// SOPs
// There is no `sops` table in Supabase yet — the whole feature lived in the
// retired backend's database.
export const getSops = (_params?: { category?: string; search?: string }) => notMigrated<{ data: any[] }>('SOPs');
export const getSopCategories = () => notMigrated<{ data: string[] }>('SOPs');
export const createSop = (_data: { title: string; category: string; content: string; tags?: string[] }) => notMigrated('SOPs');
export const updateSop = (_id: number, _data: { title: string; category: string; content: string; tags?: string[] }) => notMigrated('SOPs');
export const deleteSop = (_id: number) => notMigrated('SOPs');

// Rules
export const getRules = async () => {
  const { data, error } = await directClient().from('attendance_rules').select('*').order('priority').order('created_at');
  return directResult((data || []).map((row: any) => ({ ...row, ruleType: row.rule_type, isActive: row.is_active, createdAt: row.created_at })), error);
};
type GeneratedRule = { name: string; description: string; ruleType: string; conditions: object; actions: object; priority: number };
export const generateRule = async (policy: string) => {
  const { data, error } = await directClient().functions.invoke('generate-rule', { body: { policy } });
  if (error) throw error;
  return directResult(data as GeneratedRule, null);
};
export const createRule = async (data: { name: string; description: string; ruleType: string; conditions: object; actions: object; priority?: number }) => {
  const { data: saved, error } = await directClient().from('attendance_rules').insert({ name: data.name, description: data.description, rule_type: data.ruleType, conditions: data.conditions, actions: data.actions, priority: data.priority ?? 0 }).select().single();
  return directResult(saved, error);
};
export const updateRule = async (id: number, data: any) => {
  const mapped = { ...data, rule_type: data.ruleType, is_active: data.isActive };
  delete mapped.ruleType; delete mapped.isActive;
  const { data: saved, error } = await directClient().from('attendance_rules').update(mapped).eq('id', id).select().single();
  return directResult(saved, error);
};
export const deleteRule = async (id: number) => {
  const { data, error } = await directClient().from('attendance_rules').delete().eq('id', id);
  return directResult(data, error);
};
export const toggleRule = async (id: number) => {
  const current = await directClient().from('attendance_rules').select('is_active').eq('id', id).single();
  if (current.error) throw new Error(current.error.message);
  const { data, error } = await directClient().from('attendance_rules').update({ is_active: !current.data.is_active }).eq('id', id).select().single();
  return directResult(data, error);
};
export const evaluateRules = async (uploadId: number, autoCreateDrafts = true) => {
  const client = directClient();
  const [{ data: records, error: recordsError }, { data: rules, error: rulesError }] = await Promise.all([
    client.from('attendance_records').select('*, employees(id,name,email)').eq('import_id', uploadId),
    client.from('attendance_rules').select('*').eq('is_active', true),
  ]);
  if (recordsError || rulesError) throw new Error(recordsError?.message || rulesError?.message);
  const matches = (records || []).filter((row: any) => !['normal', 'weekend', 'holiday', 'official', 'present'].includes(String(row.status).toLowerCase()));
  let draftsCreated = 0;
  if (autoCreateDrafts && matches.length) {
    // One draft per EMPLOYEE listing all of their flagged dates. Creating one
    // per flagged record produced dozens of near-identical emails per person
    // (93 for a single employee at worst).
    const byEmployee = new Map<number, { date: string; status: string }[]>();
    for (const row of matches) {
      if (!row.employee_id) continue;
      const list = byEmployee.get(row.employee_id) || [];
      list.push({ date: row.record_date, status: row.status });
      byEmployee.set(row.employee_id, list);
    }
    // Dedupe against drafts already queued for this employee — including
    // orphans (import_id NULL) left behind when an earlier upload was deleted,
    // which an import-scoped check silently missed and re-created every run.
    const existing = await client
      .from('email_messages')
      .select('employee_id')
      .in('employee_id', [...byEmployee.keys()])
      .is('sent_at', null)
      .eq('status', 'draft');
    if (existing.error) throw new Error(existing.error.message);
    const existingIds = new Set((existing.data || []).map((row: any) => row.employee_id));

    const drafts = [...byEmployee.entries()]
      .filter(([employeeId]) => !existingIds.has(employeeId))
      .map(([employeeId, items]) => {
        const sorted = [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const lines = sorted.map(i => `  • ${i.date} — ${i.status}`).join('\n');
        return {
          import_id: uploadId,
          employee_id: employeeId,
          template_type: 'initial',
          subject: 'Attendance clarification required',
          body: `Please clarify the following ${sorted.length} attendance record${sorted.length !== 1 ? 's' : ''}:\n\n${lines}`,
          status: 'draft',
        };
      });
    if (drafts.length) { const saved = await client.from('email_messages').insert(drafts); if (saved.error) throw new Error(saved.error.message); draftsCreated = drafts.length; }
  }
  return { data: { matches, draftsCreated, employeesEvaluated: new Set(matches.map((row: any) => row.employee_id)).size } };
};

// Analytics
export const getAnalyticsOverview = async () => {
  const client = directClient();
  const [employees, imports, messages, sent] = await Promise.all([
    client.from('employees').select('id', { count: 'exact', head: true }),
    client.from('attendance_imports').select('id', { count: 'exact', head: true }),
    client.from('email_messages').select('id', { count: 'exact', head: true }),
    client.from('email_messages').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
  ]);
  const error = employees.error || imports.error || messages.error || sent.error;
  return directResult({ totalEmployees: employees.count || 0, totalUploads: imports.count || 0, totalEmails: messages.count || 0, totalSent: sent.count || 0 }, error);
};
// A record is flagged when it is not an ordinary worked day. Tested on the
// folded status so that ABSENT, "Absent (LOP)" and half_day all count — the
// previous exact-match .in() list made any unlisted casing invisible here while
// the Dispatcher summary still counted it, so the two screens disagreed.
const UNFLAGGED = ['normal', 'present', 'weekend', 'holiday', 'official', 'paid leave'];
const isFlaggedStatus = (status: unknown) => {
  const folded = canonicalStatus(status).toLowerCase().replace(/[_-]+/g, ' ').trim();
  return Boolean(folded) && !UNFLAGGED.includes(folded);
};

export const getMonthlyComparison = async () => {
  const client = directClient();
  const { data: imports, error: importsError } = await client.from('attendance_imports').select('id,period_month').order('period_month');
  if (importsError) throw new Error(importsError.message);
  const result = await Promise.all((imports || []).map(async (row: any) => {
    const { data, error } = await fetchAllRows<any>((from, to) => client.from('attendance_records')
      .select('status', { count: 'exact' }).eq('import_id', row.id).range(from, to));
    if (error) throw new Error(error.message);
    return { month: row.period_month, flagged: (data || []).filter(r => isFlaggedStatus(r.status)).length, sent: 0 };
  }));
  return { data: result };
};
export const getAnalyticsTrends = async (uploadId: number) => {
  // Paged like the Dispatcher summary: a month of records for a large branch
  // runs past PostgREST's 1000-row default, and a truncated read here would
  // quietly under-report every chart on the page.
  const { data, error } = await fetchAllRows<any>((from, to) => directClient().from('attendance_records')
    .select('status,record_date,employee_id', { count: 'exact' })
    .eq('import_id', uploadId)
    .range(from, to));
  if (error) throw new Error(error.message);
  const byStatus: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const byEmployee = new Map<number, number>();
  for (const row of data || []) {
    if (!isFlaggedStatus(row.status)) continue;
    const label = canonicalStatus(row.status) || String(row.status || '');
    byStatus[label] = (byStatus[label] || 0) + 1;
    byDate[row.record_date] = (byDate[row.record_date] || 0) + 1;
    byEmployee.set(row.employee_id, (byEmployee.get(row.employee_id) || 0) + 1);
  }

  const ranked = [...byEmployee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const names = ranked.length
    ? (await directClient().from('employees').select('id,name').in('id', ranked.map(([id]) => id))).data || []
    : [];
  const nameById = new Map<number, string>(names.map((e: any) => [e.id, e.name]));

  return {
    data: {
      byStatus,
      byDate: Object.entries(byDate).map(([date, count]) => ({ date, count })),
      topOffenders: ranked.map(([id, count]) => ({ name: nameById.get(id) || `Employee ${id}`, count })),
    },
  };
};
