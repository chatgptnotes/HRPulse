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

export function parseAttendanceExcel(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  const warnings: string[] = [];

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
