import * as XLSX from 'xlsx';
import { format, parse, isValid } from 'date-fns';

export interface ParsedRecord {
  employeeNumber: string;
  biometricId: string;
  employeeName: string;
  email: string;
  organisation: string;
  entity: string;
  department: string;
  designation: string;
  shift: string;
  recordDate: string;
  status: string;
  timeIn: string;
  timeOut: string;
  workingHours: number;
}

export interface ParseResult {
  records: ParsedRecord[];
  periodMonth: string;
  periodYear: string;
  warnings: string[];
}

// Map SmartTime column headers to canonical keys
const HEADER_MAP: Record<string, string> = {
  'employee number': 'employeeNumber',
  'employee no': 'employeeNumber',
  'emp no': 'employeeNumber',
  'emp number': 'employeeNumber',
  'emp id': 'employeeNumber',
  'employee id': 'employeeNumber',
  'biometric id': 'biometricId',
  'biometric': 'biometricId',
  'machine id': 'biometricId',
  'punch id': 'biometricId',
  'employee name': 'employeeName',
  'emp name': 'employeeName',
  'name': 'employeeName',
  'email address': 'email',
  'email': 'email',
  'e-mail': 'email',
  'organisation': 'organisation',
  'organization': 'organisation',
  'department': 'department',
  'dept': 'department',
  'designation': 'designation',
  'job title': 'designation',
  'position': 'designation',
  'shift': 'shift',
  'entity': 'entity',
  'date in': 'dateIn',
  'date': 'dateIn',
  'attendance date': 'dateIn',
  'punch date': 'dateIn',
  'date out': 'dateOut',
  'type': 'type',
  'attendance type': 'type',
  'attendance status': 'type',
  'status': 'type',
  'sub type': 'subType',
  'time in': 'timeIn',
  'in time': 'timeIn',
  'punch in': 'timeIn',
  'first punch': 'timeIn',
  'in time.1': 'timeIn',
  'time out': 'timeOut',
  'out time': 'timeOut',
  'punch out': 'timeOut',
  'last punch': 'timeOut',
  'out time.1': 'timeOut',
  'punch time': 'punchTime',
  'punch': 'punchTime',
  'time': 'punchTime',
};

// Map SmartTime type values to canonical status
const STATUS_MAP: Record<string, string> = {
  'normal': 'Normal',
  'present': 'Normal',
  'weak end': 'Weekend',
  'weekend': 'Weekend',
  'weekly off': 'Weekend',
  'holiday': 'Holiday',
  'late coming': 'Late Coming',
  'late': 'Late Coming',
  'early leaving': 'Early Leaving',
  'early leave': 'Early Leaving',
  'absent': 'Absent',
  'absence': 'Absent',
  'awol': 'Absent',
  'missed swipe': 'Missed Swipe',
  'incomplete': 'Missed Swipe',
  'missing punch': 'Missed Swipe',
  'official': 'Official',
  'paid leave': 'Paid Leave',
  'leave': 'Paid Leave',
};

function normalizeHeader(h: string): string {
  return HEADER_MAP[h.toLowerCase().trim()] || h.toLowerCase().replace(/\s+/g, '_');
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const d = new Date(date.y, date.m - 1, date.d);
      return format(d, 'yyyy-MM-dd');
    }
  }
  if (value instanceof Date) {
    return isValid(value) ? format(value, 'yyyy-MM-dd') : null;
  }
  if (typeof value === 'string') {
    const str = value.trim();
    const formats = ['dd-MM-yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy', 'MM-dd-yyyy', 'dd-MMM-yyyy'];
    for (const fmt of formats) {
      const d = parse(str, fmt, new Date());
      if (isValid(d)) return format(d, 'yyyy-MM-dd');
    }
    const d = new Date(str);
    if (isValid(d)) return format(d, 'yyyy-MM-dd');
  }
  return null;
}

// Parse a time value to minutes since midnight (for sorting/aggregate). Accepts
// "HH:MM", "HH:MM:SS", Excel fractions, and pure numbers like "900".
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

function minutesToLabel(min: number | null): string {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Cross-tab (pivot) sheet support ────────────────────────────────────────
// Sheets where employees are rows (NUMBER, NAME) and the days of the month are
// columns, each cell holding punch in/out times or status codes.

interface DayColumn { header: string; colIndex: number; dayNumber: number | null; date: string | null; }
interface PeriodInfo { year: string; month: string; } // "2026", "07"
interface CellPunch { timeIn: string; timeOut: string; status: string; }

const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const MONTH_TO_NUM: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Extract all "HH:MM" (optionally with am/pm) or 3-4 digit (e.g. 900, 1830) or
// Excel-fraction times from a free-form cell string.
function extractTimesFromCell(raw: unknown): number[] {
  const out: number[] = [];
  if (raw == null) return out;
  if (typeof raw === 'number') {
    const t = timeToMinutes(raw);
    if (t != null) out.push(t);
    return out;
  }
  const str = String(raw).trim();
  if (!str) return out;
  // labeled times: "In:09:00" / "Out: 06:00 PM"
  const matches = str.matchAll(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/gi);
  for (const m of matches) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[4]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (h < 24 && min < 60) out.push(h * 60 + min);
  }
  // also 3-4 digit pure numbers embedded (e.g. "900-1830")
  if (out.length === 0) {
    const nums = str.matchAll(/\b(\d{3,4})\b/g);
    for (const n of nums) {
      const v = parseInt(n[1], 10);
      const h = Math.floor(v / 100);
      const min = v % 100;
      if (h < 24 && min < 60) out.push(h * 60 + min);
    }
  }
  return out;
}

// Interpret a single cross-tab cell → in/out + a status hint.
function parseCellPunches(raw: unknown): CellPunch {
  const times = extractTimesFromCell(raw);
  if (times.length >= 2) {
    const inMin = Math.min(...times);
    const outMin = Math.max(...times);
    return { timeIn: minutesToLabel(inMin), timeOut: minutesToLabel(outMin), status: 'Normal' };
  }
  if (times.length === 1) {
    // A lone 00:00 is a "no data" marker in many exports, not a real punch.
    if (times[0] === 0) return { timeIn: '', timeOut: '', status: 'Absent' };
    return { timeIn: minutesToLabel(times[0]), timeOut: '', status: 'Missed Swipe' };
  }
  // No times — treat as a status code
  const code = String(raw ?? '').trim().toLowerCase();
  if (!code) return { timeIn: '', timeOut: '', status: 'Absent' };
  if (/^(a|ab|abs|absent|awol|x|-)\b/.test(code)) return { timeIn: '', timeOut: '', status: 'Absent' };
  if (/^(wo|w|we|off|week\s*end|weekend)/.test(code)) return { timeIn: '', timeOut: '', status: 'Weekend' };
  if (/^(h|hol|holiday)/.test(code)) return { timeIn: '', timeOut: '', status: 'Holiday' };
  if (/^(l|lc|late)/.test(code)) return { timeIn: '', timeOut: '', status: 'Late Coming' };
  if (/^(cl|sl|el|pl|leave|lop)/.test(code)) return { timeIn: '', timeOut: '', status: 'Paid Leave' };
  if (/^(p|pr|present|\u2713|✓)/.test(code)) return { timeIn: '', timeOut: '', status: 'Normal' };
  // Unrecognized non-empty value → treat as present marker
  return { timeIn: '', timeOut: '', status: 'Normal' };
}

// Decide whether a header cell denotes a day of the month.
function detectDayColumn(header: unknown): { isDay: boolean; dayNumber: number | null; date: string | null } {
  const s = String(header ?? '').trim();
  if (!s) return { isDay: false, dayNumber: null, date: null };
  // pure day number 1..31
  if (/^([1-9]|[12][0-9]|3[01])$/.test(s)) return { isDay: true, dayNumber: parseInt(s, 10), date: null };
  // full date header
  const d = parseExcelDate(s);
  if (d) return { isDay: true, dayNumber: null, date: d };
  // "1", "1 Mon", "1-Mon", "01 (Mon)", "Day 1"
  const m = s.match(/(?:day\s*)?([1-9]|[12][0-9]|3[01])/i);
  if (m && /^(day|\d)/i.test(s)) return { isDay: true, dayNumber: parseInt(m[1], 10), date: null };
  return { isDay: false, dayNumber: null, date: null };
}

// Find NUMBER and NAME column indices in a header row.
function findEmpColumns(headers: string[]): { numIdx: number; nameIdx: number } {
  let numIdx = -1, nameIdx = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (numIdx === -1 && /(emp|staff|employee|id|no|code|number|biometric)/.test(h) && !h.includes('name')) numIdx = i;
    if (nameIdx === -1 && /(name|employee name|emp name|staff name|full name)/.test(h)) nameIdx = i;
  }
  return { numIdx, nameIdx };
}

// Scan the first ~6 rows for a month + year (e.g. "July 2026", "Jul 2026", "07/2026", "2026-07").
function detectPeriod(rows: unknown[][]): PeriodInfo | null {
  const scan = rows.slice(0, 8).map(r => (r || []).map(c => String(c ?? '')).join(' ')).join(' | ');
  // "July 2026" / "Jul 2026"
  const m1 = scan.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-/]+(\d{4})/i);
  if (m1) {
    const mon = MONTH_TO_NUM[m1[1].toLowerCase().substring(0, 3)];
    if (mon) return { year: m1[2], month: mon };
  }
  // numeric: 2026-07 / 07-2026 / 07/2026
  const m2 = scan.match(/(\d{4})[-/](0?[1-9]|1[0-2])\b/);
  if (m2) return { year: m2[1], month: m2[2].padStart(2, '0') };
  const m3 = scan.match(/\b(0?[1-9]|1[0-2])[-/](\d{4})\b/);
  if (m3) return { year: m3[2], month: m3[1].padStart(2, '0') };
  return null;
}

// Convert a cross-tab (pivot) sheet into long-format ParsedRecords.
export function convertCrossTab(rows: unknown[][]): ParseResult | null {
  const warnings: string[] = [];

  // Locate the header row: first row containing a NAME column AND >= 5 day columns.
  let headerIdx = -1;
  let headers: string[] = [];
  let dayCols: DayColumn[] = [];
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const cand = (rows[i] || []).map(c => String(c ?? '').trim());
    const { nameIdx } = findEmpColumns(cand);
    if (nameIdx === -1) continue;
    const dc: DayColumn[] = [];
    for (let j = 0; j < cand.length; j++) {
      const r = detectDayColumn(cand[j]);
      if (r.isDay) dc.push({ header: cand[j], colIndex: j, dayNumber: r.dayNumber, date: r.date });
    }
    if (dc.length >= 5) { headerIdx = i; headers = cand; dayCols = dc; break; }
  }
  if (headerIdx === -1) return null; // not a cross-tab sheet

  const { numIdx, nameIdx } = findEmpColumns(headers);

  // Determine the period month/year for day-number columns.
  const period = detectPeriod(rows);
  const periodMonth = period ? `${period.year}-${period.month}` : format(new Date(), 'yyyy-MM');
  const periodYear = period ? period.year : format(new Date(), 'yyyy');
  const daysInMonth = new Date(parseInt(periodYear), parseInt(period ? period.month : format(new Date(), 'MM')), 0).getDate();

  const records: ParsedRecord[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = String(row[nameIdx] ?? '').trim();
    if (!name) continue;
    // Skip rows whose "Name" cell is actually punch data (e.g. "08:35\n14:58")
    // rather than a real name — these are header/summary blocks in some exports.
    if (/\d{1,2}:\d{2}/.test(name) || name.includes('\n')) continue;
    const num = numIdx >= 0 ? String(row[numIdx] ?? '').trim() : '';

    for (const dc of dayCols) {
      // Resolve the date for this column
      let recordDate: string | null = dc.date;
      if (!recordDate && dc.dayNumber) {
        if (dc.dayNumber > daysInMonth) continue;
        recordDate = `${periodMonth}-${String(dc.dayNumber).padStart(2, '0')}`;
      }
      if (!recordDate) continue;

      const cell = row[dc.colIndex];
      const cellStr = String(cell ?? '').trim();

      // Derive the weekday from the date so blanks can be classified.
      // getDay: 0=Sun .. 6=Sat. This company works Mon–Sat with Sunday off,
      // so weekend = Sunday only.
      const parts = recordDate.split('-').map(Number);
      const dow = (parts.length === 3 && parts[0] && parts[1])
        ? new Date(parts[0], parts[1] - 1, parts[2]).getDay()
        : 1;
      const isWeekend = dow === 0; // Sunday off

      // Emit a record for every cell so the full sheet shows:
      //   empty + Sunday    → Weekend (off)
      //   empty + Mon–Sat   → Absent
      //   non-empty         → parsed punches (Normal / Missed Swipe / explicit Absent)
      const punch = cellStr ? parseCellPunches(cell) : { timeIn: '', timeOut: '', status: (isWeekend ? 'Weekend' : 'Absent') };

      records.push({
        employeeNumber: num,
        biometricId: '',
        employeeName: name,
        email: '',
        organisation: '',
        entity: '',
        department: '',
        designation: '',
        shift: '',
        recordDate,
        status: punch.status,
        timeIn: punch.timeIn,
        timeOut: punch.timeOut,
        workingHours: computeWorkingHours(punch.timeIn, punch.timeOut),
      });
    }
  }

  if (!period) warnings.push('Could not detect month/year in the sheet — used current month for day-number columns. Add a month/year title cell for accuracy.');
  return { records, periodMonth, periodYear, warnings };
}

function computeWorkingHours(timeIn: string, timeOut: string): number {
  const a = timeToMinutes(timeIn);
  const b = timeToMinutes(timeOut);
  if (a == null || b == null || b < a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}

function normalizeStatus(raw: string): string {
  const key = raw.toLowerCase().trim();
  return STATUS_MAP[key] || raw.trim();
}

interface RawPunch {
  employeeKey: string;
  employeeNumber: string;
  biometricId: string;
  employeeName: string;
  email: string;
  organisation: string;
  entity: string;
  department: string;
  designation: string;
  shift: string;
  recordDate: string;
  status: string;
  times: number[]; // minutes since midnight for every punch found on this row
}

export function parseAttendanceExcel(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  // Try cross-tab (pivot) layout first: NUMBER, NAME, day-columns with punches.
  const crossTab = convertCrossTab(rows);
  if (crossTab && crossTab.records.length > 0) return crossTab;

  const warnings: string[] = [];

  // Find header row (first row containing 'employee' or 'name' or 'punch')
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] as string[];
    const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
    if (rowStr.includes('employee') || rowStr.includes('emp name') || rowStr.includes('punch')) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    warnings.push('Could not detect header row — using first row as headers');
  }

  const headers = (rows[headerRowIndex] as string[]).map(normalizeHeader);
  const dates: string[] = [];

  // Group punches by employee + date so we can derive first/last punch even
  // when the export has one row per punch (rather than one row per day).
  const groups = new Map<string, RawPunch>();

  const employeeKeyOf = (o: Record<string, unknown>, name: string) =>
    String(o['biometricId'] || o['employeeNumber'] || '').trim() || name.trim().toLowerCase();

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? '';
    });

    const employeeName = String(obj['employeeName'] || '').trim();
    if (!employeeName) continue;

    const rawDate = obj['dateIn'] || obj['date'] || '';
    const recordDate = parseExcelDate(rawDate);
    if (!recordDate) {
      warnings.push(`Row ${i + 1}: Could not parse date "${rawDate}" for "${employeeName}"`);
      continue;
    }
    dates.push(recordDate);

    const employeeKey = `${employeeKeyOf(obj, employeeName)}__${recordDate}`;

    // Collect every time-ish field on this row.
    const times: number[] = [];
    for (const key of ['timeIn', 'timeOut', 'punchTime', 'dateIn', 'dateOut']) {
      const v = obj[key];
      if (key === 'dateIn' || key === 'dateOut') {
        // Only treat as a time if it parses to a small number (Excel time fraction)
        if (typeof v === 'number' && v > 0 && v < 1) {
          const t = timeToMinutes(v);
          if (t != null) times.push(t);
        }
      } else {
        const t = timeToMinutes(v);
        if (t != null) times.push(t);
      }
    }

    const rawStatus = String(obj['type'] || obj['status'] || '').trim();
    const status = rawStatus ? normalizeStatus(rawStatus) : '';
    const email = String(obj['email'] || '').trim().toLowerCase();

    const existing = groups.get(employeeKey);
    if (existing) {
      existing.times.push(...times);
      if (status && !existing.status) existing.status = status;
      if (!existing.email && email) existing.email = email;
    } else {
      groups.set(employeeKey, {
        employeeKey,
        employeeNumber: String(obj['employeeNumber'] || '').trim(),
        biometricId: String(obj['biometricId'] || '').trim(),
        employeeName,
        email,
        organisation: String(obj['organisation'] || '').trim(),
        entity: String(obj['entity'] || '').trim(),
        department: String(obj['department'] || '').trim(),
        designation: String(obj['designation'] || '').trim(),
        shift: String(obj['shift'] || '').trim(),
        recordDate,
        status,
        times,
      });
    }
  }

  const records: ParsedRecord[] = [];
  for (const g of groups.values()) {
    const sorted = g.times.filter((t, i) => t != null && g.times.indexOf(t) === i).sort((a, b) => a - b);
    const inMin = sorted.length > 0 ? sorted[0] : null;
    const outMin = sorted.length > 1 ? sorted[sorted.length - 1] : (sorted.length === 1 ? sorted[0] : null);
    let workingHours = 0;
    if (inMin != null && outMin != null && outMin >= inMin) workingHours = (outMin - inMin) / 60;

    let status = g.status;
    if (!status) {
      if (sorted.length === 0) status = 'Absent';
      else if (sorted.length === 1) status = 'Missed Swipe';
      else status = 'Normal';
    }

    records.push({
      employeeNumber: g.employeeNumber,
      biometricId: g.biometricId,
      employeeName: g.employeeName,
      email: g.email,
      organisation: g.organisation,
      entity: g.entity,
      department: g.department,
      designation: g.designation,
      shift: g.shift,
      recordDate: g.recordDate,
      status,
      timeIn: inMin != null ? minutesToLabel(inMin) : '',
      timeOut: outMin != null ? minutesToLabel(outMin) : '',
      workingHours: Math.round(workingHours * 100) / 100,
    });
  }

  // Derive period month/year from data dates
  let periodMonth = format(new Date(), 'yyyy-MM');
  let periodYear = format(new Date(), 'yyyy');
  if (dates.length > 0) {
    const sorted = [...dates].sort();
    periodMonth = sorted[0].substring(0, 7);
    periodYear = sorted[0].substring(0, 4);
  }

  return { records, periodMonth, periodYear, warnings };
}

export interface InspectionReport {
  sheetName: string;
  totalRows: number;
  headerRowIndex: number;
  detectedBy: string;
  rawHeaders: string[];
  normalizedHeaders: string[];
  sampleRows: unknown[][];
  fieldMatch: Array<{ field: string; description: string; matchedFrom: string | null }>;
  looksLikeCrossTab: boolean;
  extractedRecordCount: number;
  sampleRecords: ParsedRecord[];
  periodMonth: string;
  periodYear: string;
  warnings: string[];
}

const NEEDED_FIELDS: Array<{ field: string; description: string; keys: string[] }> = [
  { field: 'employeeName', description: 'Employee name', keys: ['employeeName'] },
  { field: 'employeeNumber', description: 'Employee ID / number', keys: ['employeeNumber'] },
  { field: 'biometricId', description: 'Biometric ID', keys: ['biometricId'] },
  { field: 'date', description: 'Attendance date', keys: ['dateIn', 'date'] },
  { field: 'status', description: 'Attendance type / status', keys: ['type'] },
  { field: 'timeIn', description: 'In time / first punch', keys: ['timeIn', 'punchTime'] },
  { field: 'timeOut', description: 'Out time / last punch', keys: ['timeOut'] },
  { field: 'department', description: 'Department', keys: ['department'] },
  { field: 'designation', description: 'Designation', keys: ['designation'] },
  { field: 'shift', description: 'Shift', keys: ['shift'] },
  { field: 'email', description: 'Email', keys: ['email'] },
];

// Read the Excel and return a full diagnostic report — WITHOUT writing to the DB.
// Shows the raw headers, what each mapped to, sample rows, and why rows are/aren't
// being extracted. Powers the "Inspect Excel" feature.
export function inspectAttendanceExcel(buffer: Buffer): InspectionReport {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  // Detect header row: prefer a row with a NAME column + >=5 day columns
  // (cross-tab), else fall back to the keyword search.
  let headerRowIndex = -1;
  let detectedBy = '';
  let isCrossTab = false;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const cand = (rows[i] || []).map(c => String(c ?? '').trim());
    const { nameIdx } = findEmpColumns(cand);
    if (nameIdx !== -1) {
      const dayCount = cand.filter(h => detectDayColumn(h).isDay).length;
      if (dayCount >= 5) {
        headerRowIndex = i; detectedBy = `Cross-tab header (NAME + ${dayCount} day columns) found in row ${i + 1}`; isCrossTab = true; break;
      }
    }
  }
  if (headerRowIndex === -1) {
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const row = rows[i] as string[];
      const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
      if (rowStr.includes('employee') || rowStr.includes('emp name') || rowStr.includes('punch')) {
        headerRowIndex = i; detectedBy = `Found keyword in row ${i + 1}`; break;
      }
    }
  }
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    detectedBy = 'No keyword found — defaulted to row 1';
  }

  const headerRow = (rows[headerRowIndex] as unknown[]) || [];
  const rawHeaders = headerRow.map(h => String(h ?? '').trim());
  const normalizedHeaders = rawHeaders.map(normalizeHeader);

  // Build the column -> raw header match report
  const fieldMatch = NEEDED_FIELDS.map(({ field, description, keys }) => {
    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (keys.includes(normalizedHeaders[i])) {
        return { field, description, matchedFrom: rawHeaders[i] || `Column ${i + 1}` };
      }
    }
    return { field, description, matchedFrom: null };
  });

  const dayColumnCount = rawHeaders.filter(h => detectDayColumn(h).isDay).length;
  const looksLikeCrossTab = isCrossTab || dayColumnCount >= 5;

  // Sample rows: first 8 data rows after the header
  const sampleRows = rows.slice(headerRowIndex + 1, headerRowIndex + 9).map(r => (r as unknown[]));

  // Run the real parser to see what it extracts
  const parsed = parseAttendanceExcel(buffer);

  return {
    sheetName,
    totalRows: rows.length,
    headerRowIndex,
    detectedBy,
    rawHeaders,
    normalizedHeaders,
    sampleRows,
    fieldMatch,
    looksLikeCrossTab,
    extractedRecordCount: parsed.records.length,
    sampleRecords: parsed.records.slice(0, 5),
    periodMonth: parsed.periodMonth,
    periodYear: parsed.periodYear,
    warnings: parsed.warnings,
  };
}
