import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabase, getSettings } from '../db/supabase';
import {
  buildEmployeeDetail,
  computeEmployeePayroll,
  parseSettings,
  PayrollRow,
} from '../services/payrollService';
import {
  buildSummary,
  evaluateSalaryRules,
  loadSalaryRules,
  MatchedRuleEffect,
  SalaryRule,
} from '../services/salaryRules';
import { insertHrNotification, upsertHrNotification } from '../services/hrNotificationService';
import { employeeDocumentUpload, findEmployeeDocument, listEmployeeDocuments, saveEmployeeDocument } from '../services/employeeDocumentService';

const router = Router();

const PAGE_SIZE = 1000;
const DEFAULT_NOTIFICATION_LIMIT = 50;

type EssEmployee = {
  id: number;
  employee_number?: string | null;
  external_uuid?: string | null;
  name: string;
  email?: string | null;
  photo_url?: string | null;
  department?: string | null;
  designation?: string | null;
  shift?: string | null;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
  joining_date?: string | null;
  monthly_salary?: number | null;
  paid_leaves_eligible?: boolean | null;
  overtime_eligible?: boolean | null;
};

type EssRequest = Request & {
  essEmployee?: EssEmployee;
  essIdentity?: Record<string, string>;
};

const leaveRequestSchema = z.object({
  leaveType: z.string().trim().min(1).max(80),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(1000).optional().default(''),
});

function integrationToken() {
  return process.env.HRPULSE_ESS_TOKEN || process.env.ESS_INTEGRATION_TOKEN || process.env.ADAMRIT_INTEGRATION_TOKEN || '';
}

function tokenFrom(req: Request) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-hrpulse-integration-token'] || req.headers['x-adamrit-integration-token'] || '').trim();
}

function isMissingRelation(message: string) {
  return /relation .* does not exist|schema cache|does not exist/i.test(message || '');
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return currentDate().slice(0, 7);
}

function monthBounds(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next = mon === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
  return { start, next };
}

function fillNotAttemptedMonth(days: Array<{ recordDate: string; status: string; timeIn: string | null; timeOut: string | null }>, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return days;
  const [year, mon] = month.split('-').map(Number);
  const totalDays = Math.min(new Date(year, mon, 0).getDate(), 30);
  const byDate = new Map(days.map((day) => [String(day.recordDate).slice(0, 10), day]));
  return Array.from({ length: totalDays }, (_, index) => {
    const recordDate = `${month}-${String(index + 1).padStart(2, '0')}`;
    return byDate.get(recordDate) || { recordDate, status: 'Not Attempted', timeIn: null, timeOut: null };
  });
}

function inclusiveLeaveDays(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function workingHours(timeIn?: string | null, timeOut?: string | null) {
  const toMinutes = (value?: string | null) => {
    if (!value) return null;
    const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  };
  const a = toMinutes(timeIn);
  const b = toMinutes(timeOut);
  if (a == null || b == null || b < a) return 0;
  return Math.round(((b - a) / 60) * 10) / 10;
}

function isShortAttendedDay(record: any, halfDayHours: number) {
  const status = normalizeAttendanceStatus(record.status);
  if (['absent', 'missing_punch', 'holiday', 'weekly_off', 'leave'].includes(status)) return false;
  const hours = workingHours(record.time_in, record.time_out);
  return hours > 0 && hours < halfDayHours;
}

function normalizeAttendanceStatus(status: string) {
  const s = String(status || '').toLowerCase();
  if (s.includes('absent')) return 'absent';
  if (s.includes('half')) return 'half_day';
  if (s.includes('late')) return 'late';
  if (s.includes('missed') || s.includes('missing') || s.includes('incomplete')) return 'missing_punch';
  if (s.includes('holiday')) return 'holiday';
  if (s.includes('weekend') || s.includes('weekly')) return 'weekly_off';
  if (s.includes('leave')) return 'leave';
  return 'present';
}

function attendancePercentage(summary: { present: number; halfDay: number; workingDays: number }) {
  if (summary.workingDays <= 0) return 0;
  return Math.round(((summary.present + summary.halfDay * 0.5) / summary.workingDays) * 1000) / 10;
}

function todayKeyDate() {
  return new Date().toISOString().slice(0, 10);
}

function escapePdfText(value: unknown) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ');
}

function buildSimplePdf(lines: string[]) {
  const content = [
    'BT',
    '/F1 12 Tf',
    '50 780 Td',
    ...lines.flatMap((line, idx) => [
      idx === 0 ? '/F1 18 Tf' : '/F1 12 Tf',
      `(${escapePdfText(line)}) Tj`,
      '0 -22 Td',
    ]),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function money(value: unknown) {
  return `INR ${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

function payslipPdfText(x: number, y: number, text: string, size = 10, font: 'F1' | 'F2' = 'F1') {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function payslipLine(x1: number, y: number, x2: number, width = 0.8) {
  return `${width} w ${x1} ${y} m ${x2} ${y} l S`;
}

function payslipRect(x: number, y: number, w: number, h: number, fill = false) {
  return fill ? `${x} ${y} ${w} ${h} re f` : `${x} ${y} ${w} ${h} re S`;
}

function payslipRow(label: string, value: string, x: number, y: number, w = 230) {
  return [
    payslipPdfText(x, y, label, 9),
    payslipPdfText(x + w - 85, y, value, 9, 'F2'),
    payslipLine(x, y - 8, x + w, 0.4),
  ];
}

function buildPayslipPdf(employee: EssEmployee, detail: any, periodMonth: string) {
  const generated = new Date().toLocaleString('en-IN');
  const employeeId = employee.employee_number || String(employee.id);
  const lines = [
    '0.96 0.98 1 rg',
    payslipRect(0, 0, 612, 792, true),
    '0.05 0.09 0.18 rg',
    payslipRect(40, 660, 532, 78, true),
    '1 1 1 rg',
    payslipPdfText(58, 708, 'HRPulse Payslip', 22, 'F2'),
    payslipPdfText(58, 686, `Salary period: ${periodMonth}`, 10),
    payslipPdfText(438, 708, 'FINAL NET SALARY', 9, 'F2'),
    payslipPdfText(438, 685, money(detail.netSalary), 20, 'F2'),

    '0 0 0 RG',
    '1 1 1 rg',
    payslipRect(40, 520, 255, 115, true),
    payslipRect(317, 520, 255, 115, true),
    '0.88 0.91 0.96 RG',
    payslipRect(40, 520, 255, 115),
    payslipRect(317, 520, 255, 115),
    payslipPdfText(58, 612, 'Employee Details', 12, 'F2'),
    ...payslipRow('Employee', employee.name || '-', 58, 590),
    ...payslipRow('Employee ID', employeeId, 58, 568),
    ...payslipRow('Department', employee.department || '-', 58, 546),
    ...payslipRow('Designation', employee.designation || '-', 58, 524),
    payslipPdfText(335, 612, 'Salary Summary', 12, 'F2'),
    ...payslipRow('Gross Salary', money(detail.grossSalary), 335, 590),
    ...payslipRow('Total Deductions', money(detail.totalDeductions), 335, 568),
    ...payslipRow('Net Salary', money(detail.netSalary), 335, 546),
    ...payslipRow('Payable Days', `${detail.payableDays || 0}`, 335, 524),

    payslipPdfText(58, 485, 'Attendance Summary', 13, 'F2'),
    '1 1 1 rg',
    payslipRect(40, 348, 532, 118, true),
    '0.88 0.91 0.96 RG',
    payslipRect(40, 348, 532, 118),
    ...payslipRow('Present Days', String(detail.presentDays || 0), 58, 444),
    ...payslipRow('Absent Days', String(detail.absentDays || 0), 58, 422),
    ...payslipRow('Half Days', String(detail.halfDays || 0), 58, 400),
    ...payslipRow('Late Count', String(detail.lateDays || 0), 335, 444),
    ...payslipRow('Missing Punches', String(detail.missingPunches || 0), 335, 422),
    ...payslipRow('Working Days', String(detail.workingDays || 0), 335, 400),
    ...payslipRow('Overtime Pay', money(detail.overtimePay), 335, 378),
    ...payslipRow('Half Day Deduction', money(detail.halfDayDeduction), 58, 378),

    payslipPdfText(58, 312, 'Earnings', 13, 'F2'),
    payslipPdfText(335, 312, 'Deductions', 13, 'F2'),
    '1 1 1 rg',
    payslipRect(40, 185, 255, 105, true),
    payslipRect(317, 185, 255, 105, true),
    '0.88 0.91 0.96 RG',
    payslipRect(40, 185, 255, 105),
    payslipRect(317, 185, 255, 105),
    ...payslipRow('Monthly Salary', money(detail.monthlySalary), 58, 268),
    ...payslipRow('Overtime Pay', money(detail.overtimePay), 58, 246),
    ...payslipRow('Rule Allowances', money(detail.ruleAllowanceAmount), 58, 224),
    ...payslipRow('Gross Salary', money(detail.grossSalary), 58, 202),
    ...payslipRow('Absent Deduction', money(detail.absentDeduction), 335, 268),
    ...payslipRow('Half-Day Deduction', money(detail.halfDayDeduction), 335, 246),
    ...payslipRow('Rule Deductions', money(detail.ruleDeductionAmount), 335, 224),
    ...payslipRow('Total Deductions', money(detail.totalDeductions), 335, 202),

    '0.91 0.98 0.94 rg',
    payslipRect(40, 120, 532, 46, true),
    '0.06 0.47 0.30 rg',
    payslipPdfText(58, 148, 'Final Net Salary', 11, 'F2'),
    payslipPdfText(430, 142, money(detail.netSalary), 20, 'F2'),
    '0.39 0.45 0.55 rg',
    payslipPdfText(40, 76, `Generated by HRPulse on ${generated}. This is a system generated payslip.`, 8),
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(lines, 'utf8')} >>\nstream\n${lines}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

async function audit(req: EssRequest, action: string, status: 'success' | 'denied' | 'error', details: Record<string, unknown> = {}) {
  try {
    await supabase.from('ess_audit_logs').insert({
      employee_id: req.essEmployee?.id || null,
      action,
      actor_source: 'adamrit',
      actor_external_id: req.essIdentity?.externalUserId || req.essIdentity?.adamritUserId || null,
      ip_address: req.ip || null,
      user_agent: req.headers['user-agent'] || null,
      status,
      details,
    });
  } catch {
    // Audit logging must not break ESS reads if the optional migration is pending.
  }
}

async function tryInsertNotification(row: Record<string, unknown>) {
  try {
    await insertHrNotification(row as any);
  } catch {
    // Optional persistence; ESS reads should still work before migrations run.
  }
}

async function tryUpsertNotification(row: Record<string, unknown>) {
  try {
    await upsertHrNotification(row as any);
  } catch {
    // Optional persistence; ESS reads should still work before migrations run.
  }
}

async function findEmployee(identity: Record<string, string>) {
  const id = Number(identity.employeeId || '');
  if (Number.isInteger(id) && id > 0) {
    const { data, error } = await supabase.from('employees').select('*').eq('id', id).single();
    if (!error && data) return data as EssEmployee;
  }

  const email = identity.email?.toLowerCase();
  if (email) {
    const { data, error } = await supabase.from('employees').select('*').ilike('email', email).single();
    if (!error && data) return data as EssEmployee;
  }

  const employeeNumber = identity.employeeNumber || identity.employeeCode;
  if (employeeNumber) {
    const { data, error } = await supabase.from('employees').select('*').eq('employee_number', employeeNumber).single();
    if (!error && data) return data as EssEmployee;
  }

  const externalUuid = identity.externalUuid;
  if (externalUuid) {
    const { data, error } = await supabase.from('employees').select('*').eq('external_uuid', externalUuid).single();
    if (!error && data) return data as EssEmployee;
  }

  return null;
}

async function essAuth(req: EssRequest, res: Response, next: NextFunction) {
  const expected = integrationToken();
  if (!expected && process.env.NODE_ENV === 'production') {
    res.status(503).json({ error: 'ESS integration token is not configured' });
    return;
  }
  if (expected && tokenFrom(req) !== expected) {
    await audit(req, 'auth', 'denied', { reason: 'invalid_token' });
    res.status(401).json({ error: 'Invalid ESS integration token' });
    return;
  }

  const identity = {
    employeeId: String(req.headers['x-employee-id'] || req.query.employeeId || '').trim(),
    employeeNumber: String(req.headers['x-employee-number'] || req.headers['x-employee-code'] || req.query.employeeNumber || req.query.employeeCode || '').trim(),
    employeeCode: String(req.headers['x-employee-code'] || req.query.employeeCode || '').trim(),
    externalUuid: String(req.headers['x-employee-uuid'] || req.headers['x-external-uuid'] || req.query.externalUuid || '').trim(),
    email: String(req.headers['x-employee-email'] || req.query.email || '').trim(),
    externalUserId: String(req.headers['x-adamrit-user-id'] || req.query.externalUserId || '').trim(),
    adamritUserId: String(req.headers['x-adamrit-user-id'] || '').trim(),
  };

  const filtered = Object.fromEntries(Object.entries(identity).filter(([, v]) => v));
  if (!Object.keys(filtered).some((k) => ['employeeId', 'employeeNumber', 'employeeCode', 'externalUuid', 'email'].includes(k))) {
    await audit(req, 'auth', 'denied', { reason: 'missing_identity' });
    res.status(400).json({ error: 'Employee identity is required' });
    return;
  }

  const employee = await findEmployee(filtered);
  if (!employee) {
    await audit(req, 'auth', 'denied', { reason: 'employee_not_linked', identity: filtered });
    res.status(404).json({ error: 'HR profile is not linked' });
    return;
  }

  req.essEmployee = employee;
  req.essIdentity = filtered;
  next();
}

async function latestUpload(month?: string) {
  let query = supabase.from('attendance_uploads').select('*').order('uploaded_at', { ascending: false }).limit(1);
  if (month) query = query.eq('period_month', month);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || [])[0] || null;
}

async function allAttendanceRecords(employeeId: number, month?: string) {
  const out: any[] = [];
  let offset = 0;
  while (true) {
    let query = supabase
      .from('attendance_records')
      .select('record_date, status, time_in, time_out, upload_id')
      .eq('employee_id', employeeId)
      .order('record_date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (month) {
      const { start, next } = monthBounds(month);
      query = query.gte('record_date', start).lt('record_date', next);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

async function recordsForUpload(employeeId: number, uploadId: number) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('record_date, status, time_in, time_out')
    .eq('employee_id', employeeId)
    .eq('upload_id', uploadId)
    .order('record_date', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    recordDate: r.record_date,
    status: r.status,
    timeIn: r.time_in || null,
    timeOut: r.time_out || null,
  }));
}

async function recordsForMonth(employeeId: number, month: string) {
  const { start, next } = monthBounds(month);
  const { data, error } = await supabase
    .from('attendance_records')
    .select('record_date, status, time_in, time_out')
    .eq('employee_id', employeeId)
    .gte('record_date', start)
    .lt('record_date', next)
    .order('record_date', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    recordDate: r.record_date,
    status: r.status,
    timeIn: r.time_in || null,
    timeOut: r.time_out || null,
  }));
}

async function salaryForEmployee(employee: EssEmployee) {
  const { data } = await supabase
    .from('salary_configs')
    .select('basic_salary, effective_month')
    .eq('employee_id', employee.id)
    .order('effective_month', { ascending: false })
    .limit(1);
  return Number(employee.monthly_salary) || Number((data || [])[0]?.basic_salary) || 0;
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

function buildRuleDays(days: any[], employee: EssEmployee) {
  const shiftEndMin = timeToMinutes(employee.shift_end_time) ?? 1080;
  const overtimeEligible = employee.overtime_eligible === true;
  return days.map((day) => {
    const outMin = timeToMinutes(day.timeOut);
    const overtimeMinutes = overtimeEligible && shiftEndMin != null && outMin != null ? outMin - shiftEndMin : 0;
    return {
      status: day.status,
      overtimeHours: overtimeMinutes > 120 ? overtimeMinutes / 60 : 0,
    };
  });
}

function applyRulesToRow(row: PayrollRow, days: any[], employee: EssEmployee, monthlySalary: number, rules: SalaryRule[]): MatchedRuleEffect[] {
  if (!rules.length || row.dailySalary <= 0) return [];
  const res = evaluateSalaryRules(buildSummary(buildRuleDays(days, employee)), employee.department || null, employee.shift || null, rules, monthlySalary, row.dailySalary);
  row.ruleDeductionDays = res.deductDays;
  row.ruleDeductionAmount = res.deductionAmount;
  row.ruleAllowanceAmount = res.allowanceAmount;
  row.grossSalary += res.allowanceAmount;
  row.totalDeductions += res.deductionAmount;
  row.netSalary = row.grossSalary - row.totalDeductions;
  return res.matchedRules;
}

async function payrollDetail(employee: EssEmployee, uploadId: number) {
  const [settingsRaw, days, monthlySalary, rules] = await Promise.all([
    getSettings(),
    recordsForUpload(employee.id, uploadId),
    salaryForEmployee(employee),
    loadSalaryRules().catch(() => []),
  ]);
  const settings = parseSettings(settingsRaw);
  const paidLeaveDays = employee.paid_leaves_eligible === true ? settings.paidLeaveDays : 0;
  const row = computeEmployeePayroll(employee as any, days, monthlySalary, paidLeaveDays, settings);
  const matched = applyRulesToRow(row, days, employee, monthlySalary, rules);
  return buildEmployeeDetail(row, employee, days, settings, matched);
}

async function payrollDetailForMonth(employee: EssEmployee, month: string) {
  const [settingsRaw, days, monthlySalary, rules] = await Promise.all([
    getSettings(),
    recordsForMonth(employee.id, month),
    salaryForEmployee(employee),
    loadSalaryRules().catch(() => []),
  ]);
  if (!days.length) return null;
  const settings = parseSettings(settingsRaw);
  const paidLeaveDays = employee.paid_leaves_eligible === true ? settings.paidLeaveDays : 0;
  const filledDays = fillNotAttemptedMonth(days, month);
  const row = computeEmployeePayroll(employee as any, filledDays, monthlySalary, paidLeaveDays, settings);
  const matched = applyRulesToRow(row, filledDays, employee, monthlySalary, rules);
  return buildEmployeeDetail(row, employee, filledDays, settings, matched);
}

function mapAttendanceRecord(r: any, halfDayHours = 4) {
  const classification = isShortAttendedDay(r, halfDayHours) ? 'half_day' : normalizeAttendanceStatus(r.status);
  return {
    date: r.record_date,
    punchIn: r.time_in || null,
    punchOut: r.time_out || null,
    workingHours: workingHours(r.time_in, r.time_out),
    status: classification === 'half_day' ? 'Half Day' : r.status,
    classification,
  };
}

function summarizeAttendance(records: any[], workingDaysSetting: number, halfDayHours = 4) {
  const summary = {
    present: 0,
    absent: 0,
    halfDay: 0,
    lateCount: 0,
    missingPunches: 0,
    overtimeHours: 0,
    workingDays: workingDaysSetting,
    attendancePercentage: 0,
  };

  for (const record of records) {
    const status = isShortAttendedDay(record, halfDayHours) ? 'half_day' : normalizeAttendanceStatus(record.status);
    if (status === 'absent') summary.absent++;
    else if (status === 'half_day') summary.halfDay++;
    else if (!['holiday', 'weekly_off'].includes(status)) summary.present++;
    if (status === 'late') summary.lateCount++;
    if (status === 'missing_punch') summary.missingPunches++;
  }

  summary.attendancePercentage = attendancePercentage(summary);
  return summary;
}

async function ensureAlertNotifications(employee: EssEmployee, month: string, records: any[], summary: ReturnType<typeof summarizeAttendance>) {
  const settings: Record<string, string> = await getSettings().catch(() => ({} as Record<string, string>));
  const lowAttendanceThreshold = Number(settings['ess_low_attendance_threshold'] || settings['low_attendance_threshold'] || 75);
  const lowAttendanceDaysThreshold = Number(settings['ess_low_attendance_days_threshold'] || settings['low_attendance_days_threshold'] || 5);
  const missingPunchThreshold = Number(settings['ess_missing_punch_threshold'] || 2);
  const notifications: Array<{ key: string; type: string; title: string; body: string; severity: string; metadata: Record<string, unknown> }> = [];

  let lateStreak = 0;
  for (const record of records) {
    if (normalizeAttendanceStatus(record.status) === 'late') {
      lateStreak++;
      if (lateStreak >= 3) break;
    } else if (!['holiday', 'weekly_off'].includes(normalizeAttendanceStatus(record.status))) {
      lateStreak = 0;
    }
  }
  if (lateStreak >= 3) {
    notifications.push({
      key: `attendance:${month}:three_consecutive_late`,
      type: 'three_consecutive_late',
      title: 'Three consecutive late arrivals',
      body: 'You have three consecutive late attendance records. Please review your punch timings.',
      severity: 'warning',
      metadata: { month, lateStreak },
    });
  }
  if (summary.missingPunches > missingPunchThreshold) {
    notifications.push({
      key: `attendance:${month}:multiple_missing_punches`,
      type: 'multiple_missing_punches',
      title: 'Multiple missing punches',
      body: `You have ${summary.missingPunches} missing punch records this month. Please regularize them with HR. No salary deduction has been applied for missing punches.`,
      severity: 'warning',
      metadata: { month, missingPunches: summary.missingPunches, threshold: missingPunchThreshold },
    });
  }
  const lowAttendanceIssueDays = summary.absent + summary.halfDay;
  if (
    lowAttendanceIssueDays >= lowAttendanceDaysThreshold ||
    (summary.attendancePercentage > 0 && summary.attendancePercentage < lowAttendanceThreshold)
  ) {
    const reminderDate = todayKeyDate();
    notifications.push({
      key: `attendance:${month}:${reminderDate}:low_attendance_reminder`,
      type: 'low_attendance_reminder',
      title: 'Attendance reminder',
      body: `Your attendance needs attention for ${month}. Issue days: ${lowAttendanceIssueDays}. Attendance: ${summary.attendancePercentage}%. Please regularize leave or contact HR.`,
      severity: 'critical',
      metadata: { month, reminderDate, issueDays: lowAttendanceIssueDays, attendancePercentage: summary.attendancePercentage, threshold: lowAttendanceThreshold, daysThreshold: lowAttendanceDaysThreshold },
    });
  }

  for (const item of notifications) {
    await tryUpsertNotification({
      employee_id: employee.id,
      notification_key: item.key,
      type: item.type,
      title: item.title,
      body: item.body,
      severity: item.severity,
      source: 'hrpulse',
      metadata: item.metadata,
    });
  }

  return notifications;
}

router.use(essAuth);

router.get('/profile', async (req: EssRequest, res: Response) => {
  const emp = req.essEmployee!;
  await audit(req, 'profile.read', 'success');
  res.json({
    id: emp.id,
    employeeNumber: emp.employee_number || '',
    externalUuid: emp.external_uuid || '',
    name: emp.name,
    email: emp.email || '',
    department: emp.department || '',
    designation: emp.designation || '',
    shift: emp.shift || '',
    shiftStartTime: emp.shift_start_time || '',
    shiftEndTime: emp.shift_end_time || '',
    joiningDate: emp.joining_date || null,
    photoUrl: emp.photo_url || null,
  });
});

router.get('/documents', async (req: EssRequest, res: Response) => {
  try {
    const documents = await listEmployeeDocuments(req.essEmployee!.id);
    await audit(req, 'documents.read', 'success', { count: documents.length });
    res.json(documents);
  } catch (err: any) {
    await audit(req, 'documents.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/documents', employeeDocumentUpload.single('file'), async (req: EssRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Document file is required' });
      return;
    }
    const document = await saveEmployeeDocument({
      employeeId: req.essEmployee!.id,
      file: req.file,
      documentType: String(req.body?.documentType || req.body?.type || 'General Document'),
      source: 'adamrit',
      uploadedBy: req.essIdentity?.externalUserId || req.essIdentity?.adamritUserId || req.essEmployee?.email || null,
    });
    await audit(req, 'documents.upload', 'success', { documentId: document.id, filename: document.originalFilename });
    res.status(201).json(document);
  } catch (err: any) {
    await audit(req, 'documents.upload', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/documents/:documentId/download', async (req: EssRequest, res: Response) => {
  try {
    const document = await findEmployeeDocument(req.essEmployee!.id, req.params.documentId);
    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    await audit(req, 'documents.download', 'success', { documentId: document.client.id });
    res.setHeader('Content-Type', document.row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.row.original_filename)}"`);
    res.sendFile(document.absolutePath);
  } catch (err: any) {
    await audit(req, 'documents.download', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/attendance/today', async (req: EssRequest, res: Response) => {
  try {
    const date = String(req.query.date || currentDate());
    const { data, error } = await supabase
      .from('attendance_records')
      .select('record_date, status, time_in, time_out, upload_id')
      .eq('employee_id', req.essEmployee!.id)
      .eq('record_date', date)
      .order('upload_id', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    await audit(req, 'attendance.today.read', 'success', { date });
    const row = (data || [])[0];
    const settings = parseSettings(await getSettings());
    res.json(row ? mapAttendanceRecord(row, settings.halfDayHours) : { date, punchIn: null, punchOut: null, workingHours: 0, status: 'No Record', classification: 'none' });
  } catch (err: any) {
    await audit(req, 'attendance.today.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/attendance/monthly', async (req: EssRequest, res: Response) => {
  try {
    const month = String(req.query.month || currentMonth());
    const settings = parseSettings(await getSettings());
    const records = await allAttendanceRecords(req.essEmployee!.id, month);
    const summary = summarizeAttendance(records, settings.workingDays, settings.halfDayHours);
    const payrollDetail = await payrollDetailForMonth(req.essEmployee!, month);
    if (payrollDetail) summary.overtimeHours = payrollDetail.overtimeHours;
    await ensureAlertNotifications(req.essEmployee!, month, records, summary).catch(() => []);
    await audit(req, 'attendance.monthly.read', 'success', { month });
    res.json({ month, ...summary });
  } catch (err: any) {
    await audit(req, 'attendance.monthly.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/attendance/history', async (req: EssRequest, res: Response) => {
  try {
    const month = req.query.month ? String(req.query.month) : undefined;
    const settings = parseSettings(await getSettings());
    const records = await allAttendanceRecords(req.essEmployee!.id, month);
    await audit(req, 'attendance.history.read', 'success', { month });
    res.json(records.map((record) => mapAttendanceRecord(record, settings.halfDayHours)));
  } catch (err: any) {
    await audit(req, 'attendance.history.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/attendance/calendar', async (req: EssRequest, res: Response) => {
  try {
    const month = String(req.query.month || currentMonth());
    const settings = parseSettings(await getSettings());
    const records = await allAttendanceRecords(req.essEmployee!.id, month);
    await audit(req, 'attendance.calendar.read', 'success', { month });
    res.json({
      month,
      days: records.map((record) => mapAttendanceRecord(record, settings.halfDayHours)),
    });
  } catch (err: any) {
    await audit(req, 'attendance.calendar.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/payroll/current', async (req: EssRequest, res: Response) => {
  try {
    const month = req.query.month ? String(req.query.month) : currentMonth();
    const detail = await payrollDetailForMonth(req.essEmployee!, month);
    if (!detail) {
      res.json(null);
      return;
    }
    await audit(req, 'payroll.current.read', 'success', { periodMonth: month });
    res.json({
      periodMonth: month,
      grossSalary: detail.grossSalary,
      deductions: detail.totalDeductions,
      netSalary: detail.netSalary,
      payableDays: detail.payableDays,
      workingDays: detail.workingDays,
      presentDays: detail.presentDays,
      absentDays: detail.absentDays,
      absentDeduction: detail.absentDeduction,
      halfDays: detail.halfDays,
      halfDayDeduction: detail.halfDayDeduction,
      lateCount: detail.lateDays,
      missingPunches: detail.missingPunches,
      overtimeHours: detail.overtimeHours,
      overtimePay: detail.overtimePay,
      attendancePercentage: attendancePercentage({
        present: detail.presentDays,
        halfDay: detail.halfDays,
        workingDays: detail.workingDays,
      }),
      status: detail.status,
    });
  } catch (err: any) {
    await audit(req, 'payroll.current.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/payroll/history', async (req: EssRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('attendance_uploads')
      .select('period_month, uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const rows = [];
    const months: string[] = Array.from(
      new Set<string>((data || []).map((upload: any) => String(upload.period_month || '')).filter(Boolean)),
    ).slice(0, 24);
    for (const periodMonth of months) {
      const detail = await payrollDetailForMonth(req.essEmployee!, periodMonth);
      if (!detail) continue;
      rows.push({
        periodMonth,
        uploadedAt: (data || []).find((upload: any) => upload.period_month === periodMonth)?.uploaded_at || null,
        grossSalary: detail.grossSalary,
        deductions: detail.totalDeductions,
        netSalary: detail.netSalary,
        payableDays: detail.payableDays,
        workingDays: detail.workingDays,
        halfDays: detail.halfDays,
        absentDeduction: detail.absentDeduction,
        halfDayDeduction: detail.halfDayDeduction,
        overtimeHours: detail.overtimeHours,
        overtimePay: detail.overtimePay,
        status: detail.status,
      });
    }
    await audit(req, 'payroll.history.read', 'success');
    res.json(rows);
  } catch (err: any) {
    await audit(req, 'payroll.history.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/payslips/:periodMonth', async (req: EssRequest, res: Response) => {
  try {
    const periodMonth = req.params.periodMonth;
    const detail = await payrollDetailForMonth(req.essEmployee!, periodMonth);
    if (!detail) {
      res.status(404).json({ error: 'Payroll period not found' });
      return;
    }
    const pdf = buildPayslipPdf(req.essEmployee!, detail, periodMonth);
    await audit(req, 'payslip.download', 'success', { periodMonth });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${periodMonth}-${req.essEmployee!.id}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    await audit(req, 'payslip.download', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/leaves', async (req: EssRequest, res: Response) => {
  try {
    const [{ data: balances, error: bErr }, { data: requests, error: rErr }] = await Promise.all([
      supabase.from('leave_balances').select('*').eq('employee_id', req.essEmployee!.id),
      supabase.from('leave_requests').select('*').eq('employee_id', req.essEmployee!.id).order('created_at', { ascending: false }),
    ]);
    if ((bErr && isMissingRelation(bErr.message)) || (rErr && isMissingRelation(rErr.message))) {
      res.status(503).json({ error: 'Leave management is not configured in HRPulse yet' });
      return;
    }
    if (bErr) throw new Error(bErr.message);
    if (rErr) throw new Error(rErr.message);
    await audit(req, 'leaves.read', 'success');
    res.json({
      balances: (balances || []).map((b: any) => ({
        leaveType: b.leave_type,
        openingBalance: Number(b.opening_balance) || 0,
        accrued: Number(b.accrued) || 0,
        used: Number(b.used) || 0,
        pending: Number(b.pending) || 0,
        available: Number(b.available) || 0,
        periodYear: b.period_year,
      })),
      requests: (requests || []).map((r: any) => ({
        id: r.id,
        leaveType: r.leave_type,
        startDate: r.start_date,
        endDate: r.end_date,
        reason: r.reason || '',
        status: r.status,
        approverNotes: r.approver_notes || '',
        requestedAt: r.created_at,
        decidedAt: r.decided_at,
      })),
    });
  } catch (err: any) {
    await audit(req, 'leaves.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/leaves/request', async (req: EssRequest, res: Response) => {
  try {
    const parsed = leaveRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if (parsed.data.endDate < parsed.data.startDate) {
      res.status(400).json({ error: 'endDate must be on or after startDate' });
      return;
    }
    const { data, error } = await supabase
      .from('leave_requests')
      .insert({
        employee_id: req.essEmployee!.id,
        leave_type: parsed.data.leaveType,
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate,
        reason: parsed.data.reason,
        status: 'pending',
        source: 'adamrit',
        external_request_id: String(req.headers['x-idempotency-key'] || '') || null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const periodYear = Number(parsed.data.startDate.slice(0, 4));
    const days = inclusiveLeaveDays(parsed.data.startDate, parsed.data.endDate);
    const balanceResult = await supabase
      .from('leave_balances')
      .select('id, pending')
      .eq('employee_id', req.essEmployee!.id)
      .eq('leave_type', parsed.data.leaveType)
      .eq('period_year', periodYear)
      .maybeSingle();
    if (!balanceResult.error && balanceResult.data) {
      await supabase
        .from('leave_balances')
        .update({ pending: Number(balanceResult.data.pending) + days })
        .eq('id', balanceResult.data.id);
    }

    await tryInsertNotification({
      employee_id: req.essEmployee!.id,
      notification_key: `leave:${data.id}:submitted`,
      type: 'leave_request_submitted',
      title: 'Leave request submitted',
      body: `Your ${parsed.data.leaveType} request is pending HR approval.`,
      severity: 'info',
      source: 'hrpulse',
      metadata: { leaveRequestId: data.id },
    });

    await audit(req, 'leave.request.create', 'success', { leaveRequestId: data.id });
    res.status(201).json({
      id: data.id,
      leaveType: data.leave_type,
      startDate: data.start_date,
      endDate: data.end_date,
      reason: data.reason || '',
      status: data.status,
      requestedAt: data.created_at,
    });
  } catch (err: any) {
    await audit(req, 'leave.request.create', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/notifications', async (req: EssRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit || DEFAULT_NOTIFICATION_LIMIT) || DEFAULT_NOTIFICATION_LIMIT, 100);
    const { data, error } = await supabase
      .from('hr_notifications')
      .select('*')
      .eq('employee_id', req.essEmployee!.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingRelation(error.message)) {
        res.json([]);
        return;
      }
      throw new Error(error.message);
    }
    await audit(req, 'notifications.read', 'success', { limit });
    res.json((data || []).map((n: any) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      severity: n.severity,
      readAt: n.read_at,
      createdAt: n.created_at,
      metadata: n.metadata || {},
    })));
  } catch (err: any) {
    await audit(req, 'notifications.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/read-all', async (req: EssRequest, res: Response) => {
  try {
    const readAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('hr_notifications')
      .update({ read_at: readAt })
      .eq('employee_id', req.essEmployee!.id)
      .is('read_at', null)
      .select('id');
    if (error) throw new Error(error.message);
    await audit(req, 'notifications.read_all', 'success', { count: data?.length || 0 });
    res.json({ updated: data?.length || 0, readAt });
  } catch (err: any) {
    await audit(req, 'notifications.read_all', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/notifications/:id/read', async (req: EssRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Valid notification id is required' });
      return;
    }
    const readAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('hr_notifications')
      .update({ read_at: readAt })
      .eq('id', id)
      .eq('employee_id', req.essEmployee!.id)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    await audit(req, 'notification.read', 'success', { notificationId: id });
    res.json({ id, readAt });
  } catch (err: any) {
    await audit(req, 'notification.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/alerts', async (req: EssRequest, res: Response) => {
  try {
    const month = String(req.query.month || currentMonth());
    const settings = parseSettings(await getSettings());
    const records = await allAttendanceRecords(req.essEmployee!.id, month);
    const summary = summarizeAttendance(records, settings.workingDays, settings.halfDayHours);
    const alerts = await ensureAlertNotifications(req.essEmployee!, month, records, summary).catch(() => []);
    await audit(req, 'alerts.read', 'success', { month });
    res.json(alerts);
  } catch (err: any) {
    await audit(req, 'alerts.read', 'error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
