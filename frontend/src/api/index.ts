import axios from 'axios';
import * as XLSX from 'xlsx';
import { supabase, supabaseConfigured } from '../lib/supabase';

export const api = axios.create({ baseURL: '/api' });

function directClient() {
  if (!supabaseConfigured || !supabase) throw new Error('Supabase is not configured. Restart the frontend after checking .env.');
  return supabase;
}

function directResult<T>(data: T, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  return { data };
}

const SHIFT_LATE_GRACE_MINUTES = 30;

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
async function fetchAllRows<T>(buildQuery: (from: number, to: number) => any): Promise<{ data: T[]; error: any }> {
  const all: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await buildQuery(from, from + pageSize - 1);
    if (result.error) return { data: all, error: result.error };
    const page = (result.data || []) as T[];
    all.push(...page);
    if (page.length < pageSize) return { data: all, error: null };
  }
}

/**
 * Attach or clear the bearer token used by every request.
 * Called by AuthProvider on login, logout, and on restoring a stored token.
 */
export function setAuthToken(token: string | null): void {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

// A token can expire mid-session. Rather than let every page surface its own
// confusing error, drop the dead token and send the user back to sign in.
api.interceptors.response.use(
  response => response,
  error => {
    const status = error?.response?.status;
    const isLoginAttempt = error?.config?.url?.includes('/auth/login');
    if (status === 401 && !isLoginAttempt) {
      localStorage.removeItem('hrpulse.token');
      setAuthToken(null);
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

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

export const uploadAttendance = async (fileInput: File | File[]) => {
  const files = Array.isArray(fileInput) ? fileInput : [fileInput];
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
  if (!supabaseConfigured || !supabase) return api.post<{ uploadId: number; periodMonth: string; rowCount: number; warnings: string[] }>('/attendance/upload', (() => { const fd = new FormData(); files.forEach(file => fd.append('file', file)); return fd; })());
  if (attendanceFiles.length > 1 || staffFiles.length > 0) {
    let result: any;
    for (const file of attendanceFiles) result = await uploadAttendance(file);
    if (staffFiles.length) {
      const staffResult = await importStaffMaster(staffFiles, result.data.periodMonth);
      result.data.warnings = [...(result.data.warnings || []), ...(staffResult.warnings || [])];
    }
    return result;
  }
  const file = attendanceFiles[0];
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
      item.status = statusMap[statusKey] || String(item.status || 'Normal').trim() || 'Normal';
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
    const employeeKey = String(row.employeeNumber || row.employeeName || '').trim().toLowerCase();
    uniqueRecords.set(`${employeeKey}|${String(row.recordDate)}`, row);
  }
  parsed.length = 0;
  parsed.push(...uniqueRecords.values());

  const client = directClient();
  const employeeRowsByIdentity = new Map<string, { employee_number: string | null; name: string; email: string; organisation: string | null; entity: string | null; department: string | null }>();
  for (const row of parsed) {
    const email = String(row.email || `${row.employeeNumber || row.employeeName}@unknown.local`).trim().toLowerCase();
    const employeeNumber = row.employeeNumber ? String(row.employeeNumber).trim() : null;
    employeeRowsByIdentity.set(employeeNumber || email, { employee_number: employeeNumber, name: String(row.employeeName), email, organisation: row.organisation ? String(row.organisation) : null, entity: row.entity ? String(row.entity) : null, department: row.department ? String(row.department) : null });
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
  const existingEmployees = await client.from('employees').select('id,email,employee_number,name,department,shift_timings,eligible_for_overtime');
  if (existingEmployees.error) throw new Error(`Employees could not be checked: ${existingEmployees.error.message}`);
  const existingEmails = new Set((existingEmployees.data || []).map((row: any) => String(row.email || '').toLowerCase()).filter(Boolean));
  const existingNumbers = new Set((existingEmployees.data || []).map((row: any) => String(row.employee_number || '')).filter(Boolean));
  const existingNames = (existingEmployees.data || []).map((row: any) => String(row.name || '')).filter(Boolean);
  const missingEmployees = dedupedEmployeeRows.filter(row => !existingEmails.has(row.email) && (!row.employee_number || !existingNumbers.has(row.employee_number)) && !existingNames.some(name => employeeNamesMatch(row.name, name)));
  if (missingEmployees.length > 0) {
    const insertedEmployees = await client.from('employees').insert(missingEmployees);
    if (insertedEmployees.error) throw new Error(`Employees could not be saved: ${insertedEmployees.error.message}`);
  }
  const employeesQuery = await client.from('employees').select('id,email,employee_number,name,department,shift_timings,eligible_for_overtime');
  if (employeesQuery.error) throw new Error(`Employees could not be loaded: ${employeesQuery.error.message}`);
  const employeeMap = new Map<string, any>();
  const employeeNumberMap = new Map<string, any>();
  const employeeNameMap = new Map<string, any>();
  for (const row of (employeesQuery.data || []) as any[]) {
    const emailKey = String(row.email || '').toLowerCase();
    const numberKey = String(row.employee_number || '');
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
  const rowEmail = (row: Record<string, string | number | null>) =>
    String(row.email || `${row.employeeNumber || row.employeeName}@unknown.local`).trim().toLowerCase();
  const resolveEmployee = (row: Record<string, string | number | null>) =>
    employeeMap.get(rowEmail(row)) || employeeNumberMap.get(String(row.employeeNumber || '').trim()) || findEmployeeByName(row.employeeName);
  const indexEmployees = (list: any[]) => {
    for (const row of list) {
      const emailKey = String(row.email || '').toLowerCase();
      const numberKey = String(row.employee_number || '');
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
    let finalStatus = sunday && isIt(department) && !paidLeaveStatuses.has(status) ? 'Weekend' : status;
    const timeIn = parseTime(row.timeIn);
    const timeOut = parseTime(row.timeOut);
    let workHours = timeIn !== null && timeOut !== null ? Math.max(0, (timeOut < timeIn ? timeOut + 24 : timeOut) - timeIn) : null;
    let overtimeHours = 0;
    const detectedShift = timeIn === null ? null : nearestConfiguredShift(employee.shift_timings, Math.round(timeIn * 60));
    if (detectedShift && timeIn !== null && !['Absent', 'Weekend', 'Holiday', 'Paid Leave'].includes(finalStatus)) {
      const scheduledEnd = detectedShift.end <= detectedShift.start ? detectedShift.end + 1440 : detectedShift.end;
      const scheduledMinutes = scheduledEnd - detectedShift.start;
      const outMinutes = timeOut === null ? null : Math.round(timeOut * 60) + (timeOut < timeIn ? 1440 : 0);
      const inMinutes = Math.round(timeIn * 60);
      workHours = outMinutes === null ? null : (outMinutes - inMinutes) / 60;
      overtimeHours = outMinutes !== null && employee.eligible_for_overtime ? Math.max(0, (outMinutes - inMinutes - scheduledMinutes) / 60) : 0;
      if (outMinutes === null) finalStatus = 'Missed Swipe';
      else if (outMinutes - inMinutes < scheduledMinutes / 2) finalStatus = 'HALF_DAY';
      else if (inMinutes > detectedShift.start + SHIFT_LATE_GRACE_MINUTES) finalStatus = 'Late Coming';
      else if (outMinutes < scheduledEnd) finalStatus = 'Early Leaving';
      else finalStatus = 'Normal';
    }
    return [{ import_id: importResult.data.id, employee_id: employee.id, record_date: recordDate, status: finalStatus, time_in_raw: row.timeIn ? String(row.timeIn) : null, time_out_raw: row.timeOut ? String(row.timeOut) : null, work_hours: workHours, overtime_hours: overtimeHours, deduction_days: finalStatus === 'Absent' ? 1 : finalStatus === 'HALF_DAY' ? 0.5 : 0, policy_code: isIt(department) ? 'it' : 'non_it' }];
  });
  // Different source employee numbers can still resolve to the same canonical
  // employee (for example SAHIL / sahil jha soft). Deduplicate only after
  // resolving the employee ID, which is the database uniqueness key.
  const uniqueMappedRecords = new Map<string, typeof mappedRecords[number]>();
  for (const record of mappedRecords) {
    const key = `${record.employee_id}|${record.record_date}`;
    const current = uniqueMappedRecords.get(key);
    const score = (value: typeof record) => Number(Boolean(value.time_in_raw)) + Number(Boolean(value.time_out_raw)) + Number(!['Absent', 'Missed Swipe'].includes(value.status));
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
  if (!supabaseConfigured) return api.get('/attendance/uploads');
  const { data, error } = await directClient().from('attendance_imports').select('*').order('uploaded_at', { ascending: false });
  return directResult((data || []).map((row: any) => ({ ...row, periodMonth: row.period_month, rowCount: row.row_count, uploadedAt: row.uploaded_at })), error);
};
export const getAttendanceSummary = async (uploadId: number) => {
  if (!supabaseConfigured) return api.get(`/attendance/summary/${uploadId}`);
  const { data, error } = await fetchAllRows<any>((from, to) => directClient().from('attendance_records').select('*, employees(id,name,email)').eq('import_id', uploadId).range(from, to));
  if (error) throw new Error(error.message);
  const grouped = new Map<number, any>();
  for (const row of data || []) {
    const employee = row.employees || {};
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
  if (!supabaseConfigured) return api.get(`/attendance/records/${uploadId}/${employeeId}`);
  const { data, error } = await directClient().from('attendance_records').select('*').eq('import_id', uploadId).eq('employee_id', employeeId).order('record_date');
  return directResult((data || []).map((row: any) => ({ ...row, recordDate: row.record_date, timeIn: row.time_in || row.time_in_raw, timeOut: row.time_out || row.time_out_raw, timeInRaw: row.time_in_raw, timeOutRaw: row.time_out_raw })), error);
};
export const deleteUpload = (uploadId: number) => api.delete(`/attendance/uploads/${uploadId}`);

// Emails
export const getEmailDrafts = async (uploadId: number) => {
  if (!supabaseConfigured) return api.get(`/emails/drafts/${uploadId}`);
  const { data, error } = await directClient().from('email_messages').select('*, employees(name,email)').eq('import_id', uploadId).order('created_at', { ascending: false });
  return directResult((data || []).map((row: any) => ({ ...row, employeeId: row.employee_id, employeeName: row.employees?.name, employeeEmail: row.employees?.email, templateType: row.template_type, isEdited: row.is_edited, sentAt: row.sent_at })), error);
};
export const updateDraft = async (draftId: number, data: { subject: string; body: string }) => {
  if (!supabaseConfigured) return api.patch(`/emails/drafts/${draftId}`, data);
  const { data: saved, error } = await directClient().from('email_messages').update({ subject: data.subject, body: data.body, is_edited: true }).eq('id', draftId).select().single();
  return directResult(saved, error);
};
export const sendEmail = (draftId: number) => {
  if (supabaseConfigured) return Promise.reject(new Error('Email sending is disabled in the Supabase draft-only version.'));
  return api.post(`/emails/send/${draftId}`);
};
export const sendBulk = (draftIds: number[]) => {
  if (supabaseConfigured) return Promise.reject(new Error('Email sending is disabled in the Supabase draft-only version.'));
  return api.post('/emails/send-bulk', { draftIds });
};
export const getEmailHistory = async (month?: string, employeeId?: number) => {
  if (!supabaseConfigured) return api.get('/emails/history', { params: { month, employeeId } });
  let query = directClient().from('email_messages').select('*, employees(name,email)').not('sent_at', 'is', null).order('sent_at', { ascending: false });
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (month) query = query.gte('sent_at', `${month}-01T00:00:00Z`).lt('sent_at', `${month}-32T00:00:00Z`);
  const { data, error } = await query;
  return directResult((data || []).map((row: any) => ({ ...row, employeeName: row.employees?.name, employeeEmail: row.employees?.email, sentAt: row.sent_at })), error);
};
export const checkPendingReminders = () => {
  if (supabaseConfigured) return Promise.resolve({ data: { created: 0, checked: 0 } });
  return api.post<{ created: number; checked: number }>('/emails/remind-pending');
};

// Salary
// Salary lives on employees.monthly_salary — one current salary per employee,
// maintained from the Employee Master screen and the staff-master import. The
// `month` argument is accepted so callers can keep passing the viewed month,
// but there is no per-month salary history to select from.
export const getSalaryConfigs = async (month?: string) => {
  if (!supabaseConfigured) return api.get('/salary/configs', { params: { month } });
  const { data, error } = await directClient().from('employees').select('id,monthly_salary');
  return directResult((data || []).map((row: any) => ({ employeeId: row.id, basicSalary: row.monthly_salary == null ? null : Number(row.monthly_salary) })), error);
};
export const getSalaryDeductions = async (uploadId: number) => {
  if (!supabaseConfigured) return api.get(`/salary/deductions/${uploadId}`);
  const client = directClient();
  const upload = await client.from('attendance_imports').select('period_month').eq('id', uploadId).single();
  if (upload.error) throw new Error(upload.error.message);
  const periodStart = `${upload.data.period_month}-01`;
  const nextMonth = new Date(`${periodStart}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const periodEnd = nextMonth.toISOString().slice(0, 10);
  // Use the month as the source of truth. Imports are merged/replaced during
  // re-upload, so the newest import ID may not own every valid record.
  const records = await fetchAllRows<any>((from, to) => client.from('attendance_records').select('employee_id,record_date,status,work_hours,overtime_hours,time_in,policy_code,employees(id,name,email,department,organisation,entity,eligible_for_paid_leaves)').gte('record_date', periodStart).lt('record_date', periodEnd).range(from, to));
  if (records.error) throw new Error(records.error.message);
  const rows = records.data || [];
  // The 31st remains in attendance history, but payroll is always a 30-day
  // month. Exclude it from every LOP input (absence, half-day, late, etc.).
  const payrollRows = rows.filter((row: any) => {
    const date = new Date(`${String(row.record_date).slice(0, 10)}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.getUTCDate() !== 31;
  });
  const ids = [...new Set(rows.map((row: any) => row.employee_id))];
  if (!ids.length) return { data: [] };
  const salaries = await client.from('employees').select('id,monthly_salary').in('id', ids);
  if (salaries.error) throw new Error(salaries.error.message);
  const salaryMap = new Map<number, number>();
  for (const row of salaries.data || []) salaryMap.set(row.id, Number(row.monthly_salary || 0));
  const [{ data: activeRules, error: rulesError }, { data: settings, error: settingsError }] = await Promise.all([
    client.from('attendance_rules').select('rule_type,conditions,actions,description,name').eq('is_active', true),
    client.from('settings').select('key,value'),
  ]);
  if (rulesError || settingsError) throw new Error(rulesError?.message || settingsError?.message);
  const policyText = JSON.stringify(activeRules || []).toLowerCase();
  const settingMap = new Map((settings || []).map((row: any) => [row.key, row.value]));
  let lateAfterMinutes = Number(settingMap.get('late_after_minutes') || 570);
  let lateEvery = Number(settingMap.get('late_occurrences_for_deduction') || 3);
  let halfDayHours = Number(settingMap.get('half_day_threshold_hours') || 4);
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
  for (const row of payrollRows as any[]) {
    const employee = row.employees || {};
    const item = grouped.get(row.employee_id) || { employeeId: row.employee_id, employeeName: employee.name || '', employeeEmail: employee.email || '', department: employee.department || '', organisation: employee.organisation || '', entity: employee.entity || '', eligibleForPaidLeaves: employee.eligible_for_paid_leaves === true, presentDays: 0, absentDays: 0, halfDays: 0, missedSwipeDays: 0, lateOccurrences: 0, paidLeaveUsed: 0, overtimeHours: 0, extraDays: 0, overtimeEligibleDays: 0, itRecords: 0 };
    if (String(row.policy_code || '').toLowerCase() === 'it') item.itRecords++;
    const status = String(row.status || '').toLowerCase();
    // Rafttar is the exception; every other entity follows the hospital shift
    // ladder. Matched here rather than by organisation alone because the IT
    // team is recorded as "Rafttar/Hope".
    const rafttarStaff = /rafttar/i.test(`${employee.organisation || ''} ${employee.entity || ''} ${employee.department || ''}`);
    const workingDay = !['absent', 'weekend', 'holiday', 'paid leave'].includes(status);
    const hours = row.work_hours === null || row.work_hours === undefined ? null : Number(row.work_hours);

    if (workingDay && hours !== null) {
      if (rafttarStaff) {
        // Standard 09:00-18:00 day. Overtime is earned only once the excess
        // beyond eight hours passes two hours; anything less is one shift.
        item.presentDays++;
        if (hours - 8 > 2) item.overtimeHours += hours - 8;
        if (hours < halfDayHours) item.halfDays++;
      } else {
        // Hospital ladder: under 7h is half a day, 7-10h is a full day, beyond
        // 10h earns half a shift extra and 12h or more counts as two shifts.
        // The 7h floor is a grace band for staff who fall minutes short.
        const credit = hours >= 12 ? 2 : hours > 10 ? 1.5 : hours >= 7 ? 1 : 0.5;
        item.presentDays += credit;
        if (credit > 1) item.extraDays += credit - 1;
        if (credit === 0.5) item.halfDays++;
      }
    } else if (['normal', 'present', 'late', 'late coming', 'early leaving'].includes(status)) {
      // A working day with no usable punch span still counts as attendance.
      item.presentDays++;
    }
    if (status === 'half_day' || status === 'half day') item.presentDays += 0.5;
    if (status === 'absent') item.absentDays++;
    if (status.includes('missed') || status.includes('incomplete')) item.missedSwipeDays++;
    const checkInMinutes = timeInMinutes(row.time_in);
    if (status.includes('late') || (checkInMinutes !== null && checkInMinutes > lateAfterMinutes)) item.lateOccurrences++;
    if (status.includes('paid leave') || status.includes('casual leave') || status.includes('sick leave')) item.paidLeaveUsed++;
    grouped.set(row.employee_id, item);
  }
  const result = [...grouped.values()].map(item => {
    const basicSalary = salaryMap.get(item.employeeId) || 0;
    const dailySalary = basicSalary / 30;
    const isIt = item.itRecords > 0 || /\bit\b|information technology/i.test(`${item.department} ${item.organisation} ${item.entity}`);
    // Non-IT staff work on Sundays and receive four paid leaves per month.
    // IT staff receive Sundays as weekly offs; the Paid Leave Yes/No setting
    // grants the selected IT employee two additional paid leaves per month.
    const leaveLimit = isIt ? (item.eligibleForPaidLeaves ? 2 : 0) : 4;
    const protectedAbsentDays = Math.min(item.absentDays, Math.max(0, leaveLimit - item.paidLeaveUsed));
    const chargeableAbsentDays = Math.max(0, item.absentDays - protectedAbsentDays);
    // chargeableAbsentDays already excludes the paid-leave allowance. Do not
    // add absence beyond that allowance a second time.
    const excessPaidLeave = Math.max(0, item.paidLeaveUsed - leaveLimit);
    const lateDeductionCount = Math.floor(item.lateOccurrences / lateEvery);
    const absenceDeduction = chargeableAbsentDays * dailySalary;
    const halfDayDeduction = item.halfDays * dailySalary * 0.5;
    const lateDeduction = lateDeductionCount * dailySalary;
    const excessLeaveDeduction = excessPaidLeave * dailySalary;
    const totalLopAmount = absenceDeduction + halfDayDeduction + lateDeduction + excessLeaveDeduction;
    const lopDays = chargeableAbsentDays + item.halfDays * 0.5 + lateDeductionCount + excessPaidLeave;
    // Hospital staff are paid for the extra shift credit earned above one day.
    // Rafttar overtime is pro-rata on the hours beyond eight, where eight hours
    // is a full day, so the hourly rate is a thirtieth of salary over eight.
    const extraDayAmount = item.extraDays * dailySalary;
    const overtimeAmount = item.overtimeHours * (dailySalary / 8);
    const displayedPaidLeave = item.paidLeaveUsed + protectedAbsentDays;
    return { ...item, isIt, leaveLimit, protectedAbsentDays, chargeableAbsentDays, excessPaidLeave, paidLeaveUsed: displayedPaidLeave, lateDeductionCount, lateAfterMinutes, lateEvery, halfDayHours, lopDays, lopAmount: totalLopAmount, extraDayAmount, overtimeAmount, netPayable: Math.max(0, basicSalary - totalLopAmount + extraDayAmount + overtimeAmount), dailySalary, totalLopAmount, basicSalary };
  });
  // Deductions are derived on every read, so there is nothing to cache back to
  // the database. The previous write-back also stored an undefined
  // half_day_deduction, because that value never made it onto the result rows.
  return { data: result };
};

// Settings
export const getSettings = async () => {
  if (!supabaseConfigured) return api.get('/settings');
  const { data, error } = await directClient().from('settings').select('key,value');
  return directResult(Object.fromEntries((data || []).map((row: any) => [row.key, row.value])), error);
};
export const saveSettings = async (data: Record<string, string>) => {
  if (!supabaseConfigured) return api.put('/settings', data);
  const { data: saved, error } = await directClient().from('settings').upsert(Object.entries(data).map(([key, value]) => ({ key, value })));
  return directResult(saved, error);
};
export const getTemplates = async () => {
  if (!supabaseConfigured) return api.get('/settings/templates');
  const { data, error } = await directClient().from('email_templates').select('*').order('type');
  return directResult(data || [], error);
};
export const saveTemplate = async (type: string, data: { subject: string; body: string }) => {
  if (!supabaseConfigured) return api.put(`/settings/templates/${type}`, data);
  const { data: saved, error } = await directClient().from('email_templates').upsert({ type, subject: data.subject, body: data.body }, { onConflict: 'type' }).select().single();
  return directResult(saved, error);
};
export const testSmtp = () => api.post('/settings/test-smtp');

// Employees
export const getEmployees = async () => {
  if (!supabaseConfigured) return api.get('/employees');
  const { data, error } = await directClient().from('employees').select('*').order('name');
  if (error) return directResult(null, error);
  return directResult((data || []).map((row: any) => ({
    ...row, employeeId: row.employee_number, photoUrl: row.photo_url, createdAt: row.created_at,
    actualDesignation: row.designation, designation: row.biometric_name || row.designation, biometricName: row.biometric_name,
    basicSalary: row.monthly_salary == null ? null : Number(row.monthly_salary),
    shiftTimings: row.shift_timings || {}, eligibleForPaidLeaves: row.eligible_for_paid_leaves, eligibleForOvertime: row.eligible_for_overtime,
  })), null);
};
export const getEmployee = (id: number) => supabaseConfigured ? directClient().from('employees').select('*').eq('id', id).single() : api.get(`/employees/${id}`);
export const mergeEmployees = async (keepId: number, mergeId: number) => {
  if (!supabaseConfigured) return api.post('/employees/merge', { keepId, mergeId });
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
export const updateEmployee = async (id: number, data: { name?: string; email?: string; department?: string; employeeNumber?: string; mobile?: string; designation?: string; biometricName?: string; branch?: string; status?: string; monthlySalary?: number | null; shiftTimings?: Record<string, { start: string; end: string }>; eligibleForPaidLeaves?: boolean; eligibleForOvertime?: boolean }) => {
  if (!supabaseConfigured) return api.patch(`/employees/${id}`, data);
  const { data: saved, error } = await directClient().from('employees').update({
    name: data.name, email: data.email, department: data.department, designation: data.designation, biometric_name: data.biometricName,
    employee_number: data.employeeNumber, mobile: data.mobile, branch: data.branch, status: data.status,
    monthly_salary: data.monthlySalary,
    shift_timings: data.shiftTimings,
    eligible_for_paid_leaves: data.eligibleForPaidLeaves, eligible_for_overtime: data.eligibleForOvertime,
  }).eq('id', id).select().single();
  return directResult(saved, error);
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
  if (!supabaseConfigured) return api.get<ShiftOption[]>('/shifts').then(response => ({ data: response.data.map(mapShift) }));
  const { data, error } = await directClient().from('shifts').select('*').eq('is_active', true).order('role_target').order('start_time');
  return directResult((data || []).map(mapShift), error);
};

export const getEmployeeShiftAssignments = async (employeeId: number) => {
  if (!supabaseConfigured) return api.get<EmployeeShiftAssignment[]>(`/shifts/employees/${employeeId}`).then(response => ({ data: response.data.map(mapAssignment) }));
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
  if (!supabaseConfigured) return api.post<EmployeeShiftAssignment>(`/shifts/employees/${employeeId}`, input).then(response => ({ data: mapAssignment(response.data) }));
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
export const uploadEmployeePhoto = (id: number, file: File) => {
  const fd = new FormData();
  fd.append('photo', file);
  return api.post(`/employees/${id}/photo`, fd);
};

// SOPs
export const getSops = (params?: { category?: string; search?: string }) => api.get('/sops', { params });
export const getSopCategories = () => api.get('/sops/categories');
export const getSop = (id: number) => api.get(`/sops/${id}`);
export const createSop = (data: { title: string; category: string; content: string; tags?: string[] }) => api.post('/sops', data);
export const updateSop = (id: number, data: { title: string; category: string; content: string; tags?: string[] }) => api.put(`/sops/${id}`, data);
export const deleteSop = (id: number) => api.delete(`/sops/${id}`);

// Rules
export const getRules = async () => {
  if (!supabaseConfigured) return api.get('/rules');
  const { data, error } = await directClient().from('attendance_rules').select('*').order('priority').order('created_at');
  return directResult((data || []).map((row: any) => ({ ...row, ruleType: row.rule_type, isActive: row.is_active, createdAt: row.created_at })), error);
};
export const generateRule = (policy: string) => api.post<{
  name: string; description: string; ruleType: string; conditions: object; actions: object; priority: number;
}>('/rules/generate', { policy });
export const createRule = async (data: { name: string; description: string; ruleType: string; conditions: object; actions: object; priority?: number }) => {
  if (!supabaseConfigured) return api.post('/rules', data);
  const { data: saved, error } = await directClient().from('attendance_rules').insert({ name: data.name, description: data.description, rule_type: data.ruleType, conditions: data.conditions, actions: data.actions, priority: data.priority ?? 0 }).select().single();
  return directResult(saved, error);
};
export const updateRule = async (id: number, data: any) => {
  if (!supabaseConfigured) return api.put(`/rules/${id}`, data);
  const mapped = { ...data, rule_type: data.ruleType, is_active: data.isActive };
  delete mapped.ruleType; delete mapped.isActive;
  const { data: saved, error } = await directClient().from('attendance_rules').update(mapped).eq('id', id).select().single();
  return directResult(saved, error);
};
export const deleteRule = async (id: number) => {
  if (!supabaseConfigured) return api.delete(`/rules/${id}`);
  const { data, error } = await directClient().from('attendance_rules').delete().eq('id', id);
  return directResult(data, error);
};
export const toggleRule = async (id: number) => {
  if (!supabaseConfigured) return api.patch(`/rules/${id}/toggle`);
  const current = await directClient().from('attendance_rules').select('is_active').eq('id', id).single();
  if (current.error) throw new Error(current.error.message);
  const { data, error } = await directClient().from('attendance_rules').update({ is_active: !current.data.is_active }).eq('id', id).select().single();
  return directResult(data, error);
};
export const evaluateRules = async (uploadId: number, autoCreateDrafts = true) => {
  if (!supabaseConfigured) return api.post<{ matches: any[]; draftsCreated: number; employeesEvaluated: number }>(`/rules/evaluate/${uploadId}`, { autoCreateDrafts });
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
  if (!supabaseConfigured) return api.get('/analytics/overview');
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
export const getMonthlyComparison = async () => {
  if (!supabaseConfigured) return api.get('/analytics/monthly-comparison');
  const client = directClient();
  const { data: imports, error: importsError } = await client.from('attendance_imports').select('id,period_month').order('period_month');
  if (importsError) throw new Error(importsError.message);
  const result = await Promise.all((imports || []).map(async (row: any) => {
    const { count, error } = await client.from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('import_id', row.id)
      .in('status', ['Absent', 'Missed Swipe', 'Late Coming', 'Early Leaving', 'Half Day', 'HALF_DAY', 'LATE', 'ABSENT']);
    if (error) throw new Error(error.message);
    return { month: row.period_month, flagged: count || 0, sent: 0 };
  }));
  return { data: result };
};
export const getAnalyticsTrends = async (uploadId: number) => {
  if (!supabaseConfigured) return api.get(`/analytics/trends/${uploadId}`);
  const { data, error } = await directClient().from('attendance_records').select('status,record_date').eq('import_id', uploadId).in('status', ['Absent', 'Missed Swipe', 'Late Coming', 'Early Leaving', 'Half Day', 'HALF_DAY', 'LATE', 'ABSENT']);
  if (error) throw new Error(error.message);
  const byStatus: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  for (const row of data || []) { byStatus[row.status] = (byStatus[row.status] || 0) + 1; byDate[row.record_date] = (byDate[row.record_date] || 0) + 1; }
  return { data: { byStatus, byDate: Object.entries(byDate).map(([date, count]) => ({ date, count })) } };
};
