import * as XLSX from 'xlsx';
import { format, parse, isValid } from 'date-fns';

export interface ParsedRecord {
  employeeNumber: string;
  employeeName: string;
  email: string;
  organisation: string;
  entity: string;
  recordDate: string;
  status: string;
  timeIn: string;
  timeOut: string;
}

export interface ParseResult {
  records: ParsedRecord[];
  periodMonth: string;
  warnings: string[];
}

export interface StaffMasterRecord {
  name: string;
  designation: string;
  basicSalary: number;
  organisation: string;
}

export interface StaffMasterResult {
  recognized: boolean;
  records: StaffMasterRecord[];
}

// Map SmartTime column headers to canonical keys
const HEADER_MAP: Record<string, string> = {
  'employee number': 'employeeNumber',
  'employee no': 'employeeNumber',
  'emp no': 'employeeNumber',
  'emp number': 'employeeNumber',
  'employee name': 'employeeName',
  'emp name': 'employeeName',
  'name': 'employeeName',
  'email address': 'email',
  'email': 'email',
  'e-mail': 'email',
  'organisation': 'organisation',
  'organization': 'organisation',
  'entity': 'entity',
  'date in': 'dateIn',
  'date': 'dateIn',
  'attendance date': 'dateIn',
  'date out': 'dateOut',
  'type': 'type',
  'attendance type': 'type',
  'sub type': 'subType',
  'time in': 'timeIn',
  'in time': 'timeIn',
  'punch in': 'timeIn',
  'time out': 'timeOut',
  'out time': 'timeOut',
  'punch out': 'timeOut',
};

// Map SmartTime type values to canonical status
const STATUS_MAP: Record<string, string> = {
  'normal': 'Normal',
  'weak end': 'Weekend',
  'weekend': 'Weekend',
  'holiday': 'Holiday',
  'late coming': 'Late Coming',
  'late': 'Late Coming',
  'early leaving': 'Early Leaving',
  'early leave': 'Early Leaving',
  'absent': 'Absent',
  'absence': 'Absent',
  'missed swipe': 'Missed Swipe',
  'incomplete': 'Missed Swipe',
  'official': 'Official',
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
  if (typeof value === 'string') {
    const str = value.trim();
    // Try common formats
    const formats = ['dd-MM-yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy', 'MM-dd-yyyy'];
    for (const fmt of formats) {
      const d = parse(str, fmt, new Date());
      if (isValid(d)) return format(d, 'yyyy-MM-dd');
    }
    // Try native Date parse
    const d = new Date(str);
    if (isValid(d)) return format(d, 'yyyy-MM-dd');
  }
  return null;
}

function normalizeStatus(raw: string): string {
  const key = raw.toLowerCase().trim();
  return STATUS_MAP[key] || raw.trim();
}

/** Parse the separate employee master workbook used for salary/company data. */
export function parseStaffMaster(buffer: Buffer): StaffMasterResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const headerIndex = rows.findIndex(row => {
    const text = row.map(value => String(value ?? '').toLowerCase()).join(' ');
    return /name/.test(text) && /basic\s*salary/.test(text);
  });
  if (headerIndex < 0) return { recognized: false, records: [] };
  const headers = rows[headerIndex].map(value => String(value ?? '').toLowerCase().trim());
  const nameIndex = headers.findIndex(value => /^name$|employee|staff/.test(value));
  const designationIndex = headers.findIndex(value => /designation|desingation|role/.test(value));
  const salaryIndex = headers.findIndex(value => /basic\s*salary|salary/.test(value));
  const organisationIndex = headers.findIndex(value => /organisation|organization|company/.test(value));
  const records = rows.slice(headerIndex + 1).flatMap(row => {
    const name = String(row[nameIndex] ?? '').trim();
    if (!name) return [];
    const salary = Number(String(row[salaryIndex] ?? '').replace(/[^0-9.]/g, ''));
    return [{
      name,
      designation: String(row[designationIndex] ?? '').trim(),
      basicSalary: Number.isFinite(salary) ? salary : 0,
      organisation: String(row[organisationIndex] ?? '').trim(),
    }];
  });
  return { recognized: true, records };
}

export function parseAttendanceExcel(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  const warnings: string[] = [];

  // GDHR's monthly "List of Logs" export is a matrix: row 3 contains
  // `No.`, `Name`, `1`, `2`, ... and each following employee row contains
  // newline-separated punches for each day. It has no explicit date column.
  const matrixHeaderIndex = rows.findIndex(row => {
    const name = String(row[1] ?? '').trim();
    return /^name$/i.test(name) && row.slice(2, 40).some(value => /^\d{1,2}$/.test(String(value ?? '').trim()));
  });
  const durationText = rows.slice(0, 4).flat().map(value => String(value ?? '')).find(value => /\d{1,2}\/\d{1,2}\/\d{4}\s*~\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) || '';
  const duration = durationText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*~\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (matrixHeaderIndex >= 0 && duration) {
    if (duration[2] !== duration[5] || duration[3] !== duration[6]) {
      throw new Error('This attendance report spans more than one month. Please upload one month at a time.');
    }
    const year = Number(duration[3]);
    const month = Number(duration[2]);
    const maxDay = Math.min(Number(duration[4]), rows[matrixHeaderIndex].length - 2);
    const records: ParsedRecord[] = [];
    for (let index = matrixHeaderIndex + 2; index < rows.length; index++) {
      const row = rows[index] as unknown[];
      if (!/^\d+$/.test(String(row[0] ?? '').trim())) continue;
      const employeeName = String(row[1] ?? '').trim();
      if (!employeeName) continue;
      for (let day = 1; day <= maxDay; day++) {
        const cell = String(row[day + 1] ?? '').trim();
        const times = cell.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        const recordDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isSunday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
        records.push({
          employeeNumber: String(row[0]).trim(),
          employeeName,
          email: '',
          organisation: '',
          entity: '',
          recordDate,
          status: times.length === 0 ? (isSunday ? 'Weekend' : 'Absent') : times.length === 1 ? 'Missed Swipe' : 'Normal',
          timeIn: times[0] || '',
          timeOut: times.length > 1 ? times[times.length - 1] : '',
        });
      }
    }
    return { records, periodMonth: `${year}-${String(month).padStart(2, '0')}`, warnings };
  }

  // Find header row (first row containing 'employee' or 'name')
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] as string[];
    const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
    if (rowStr.includes('employee') || rowStr.includes('emp name')) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // Fallback: use first row
    headerRowIndex = 0;
    warnings.push('Could not detect header row — using first row as headers');
  }

  const headers = (rows[headerRowIndex] as string[]).map(normalizeHeader);
  const records: ParsedRecord[] = [];
  const dates: string[] = [];

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

    const rawStatus = String(obj['type'] || obj['status'] || 'Normal').trim();
    const status = normalizeStatus(rawStatus);

    const email = String(obj['email'] || '').trim().toLowerCase();

    records.push({
      employeeNumber: String(obj['employeeNumber'] || '').trim(),
      employeeName,
      email,
      organisation: String(obj['organisation'] || '').trim(),
      entity: String(obj['entity'] || '').trim(),
      recordDate,
      status,
      timeIn: String(obj['timeIn'] || '').trim(),
      timeOut: String(obj['timeOut'] || '').trim(),
    });
  }

  // Derive period month from data dates
  let periodMonth = format(new Date(), 'yyyy-MM');
  if (dates.length > 0) {
    const sorted = [...dates].sort();
    periodMonth = sorted[0].substring(0, 7);
  }

  return { records, periodMonth, warnings };
}
