// Payroll computation engine.
// Pure functions — given attendance records, employees, salary configs and
// settings, derive per-employee attendance breakdown + salary.

import type { MatchedRuleEffect } from './salaryRules';

export interface DayBreakdown {
  date: string;
  rawStatus: string;
  classification: 'present' | 'half' | 'absent' | 'weekly_off' | 'holiday' | 'missing_punch' | 'late' | 'early';
  timeIn: string | null;
  timeOut: string | null;
  workingHours: number;
  overtimeHours: number;
  isOvertime: boolean;
  isLate: boolean;
}

export interface PayrollSettings {
  workingDays: number;
  missedSwipeWeight: number;
  standardWorkingHours: number;
  halfDayHours: number;
  lateGraceMinutes: number;
  shiftStart: string; // "HH:MM"
  otThresholdHours: number;
  otMultiplier: number;
  latePenaltyDays: number; // LOP days per late occurrence
  paidLeaveDays: number; // fixed paid leave days granted per month
}

export interface PayrollRow {
  employeeId: number;
  employeeNumber: string | null;
  biometricId: string | null;
  employeeName: string;
  department: string | null;
  designation: string | null;
  shift: string | null;
  monthlySalary: number;
  dailySalary: number;
  hourlyRate: number;
  presentDays: number;
  halfDays: number;
  totalAbsentDays: number;
  absentDays: number;
  lateDays: number;
  lateDeductionDays: number;
  missingPunches: number;
  punchCount: number;
  weeklyOffs: number;
  holidays: number;
  paidLeave: number;
  totalWorkingHours: number;
  overtimeHours: number;
  overtimePay: number;
  absentDeduction: number;
  halfDayDeduction: number;
  payableDays: number;
  grossSalary: number;
  totalDeductions: number;
  ruleDeductionDays: number;
  ruleDeductionAmount: number;
  ruleAllowanceAmount: number;
  netSalary: number;
  status: string;
}

export interface PayrollSummary {
  totalEmployees: number;
  presentEmployees: number;
  absentEmployees: number;
  halfDayEmployees: number;
  totalOvertimeHours: number;
  totalSalaryPayable: number;
}

export interface EmployeePayrollDetail extends PayrollRow {
  email: string | null;
  workingDays: number;
  standardWorkingHours: number;
  otMultiplier: number;
  overtimePay: number;
  penaltyDeduction: number;
  lateDates: string[];
  paidLeaveDates: string[];
  unpaidAbsenceDates: string[];
  missingPunchDates: string[];
  halfDayDates: string[];
  matchedRules: MatchedRuleEffect[];
  days: DayBreakdown[];
}

export interface PayrollResult {
  rows: PayrollRow[];
  summary: PayrollSummary;
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  workingDays: 30,
  missedSwipeWeight: 0.5,
  standardWorkingHours: 9,
  halfDayHours: 4,
  lateGraceMinutes: 15,
  shiftStart: '09:00',
  otThresholdHours: 9,
  otMultiplier: 1.5,
  latePenaltyDays: 0,
  paidLeaveDays: 2,
};

export function parseSettings(raw: Record<string, string>): PayrollSettings {
  const num = (k: string, def: number) => {
    const v = parseFloat(raw[k]);
    return isNaN(v) ? def : v;
  };
  return {
    workingDays: 30,
    missedSwipeWeight: num('missed_swipe_weight', DEFAULT_PAYROLL_SETTINGS.missedSwipeWeight),
    standardWorkingHours: num('standard_working_hours', DEFAULT_PAYROLL_SETTINGS.standardWorkingHours),
    halfDayHours: num('half_day_hours', DEFAULT_PAYROLL_SETTINGS.halfDayHours),
    lateGraceMinutes: num('late_grace_minutes', DEFAULT_PAYROLL_SETTINGS.lateGraceMinutes),
    shiftStart: raw['shift_start'] || DEFAULT_PAYROLL_SETTINGS.shiftStart,
    otThresholdHours: num('ot_threshold_hours', DEFAULT_PAYROLL_SETTINGS.otThresholdHours),
    otMultiplier: num('ot_multiplier', DEFAULT_PAYROLL_SETTINGS.otMultiplier),
    latePenaltyDays: num('late_penalty_days', DEFAULT_PAYROLL_SETTINGS.latePenaltyDays),
    paidLeaveDays: num('paid_leave_days', DEFAULT_PAYROLL_SETTINGS.paidLeaveDays),
  };
}

// Parse "HH:MM" or "HH:MM:SS" (or Excel fractional) to minutes since midnight.
function timeToMinutes(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value > 0 && value < 1) return Math.round(value * 24 * 60); // Excel fraction of a day
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
  // Fallback: pure number like "900" => 9:00, or "930" => 9:30
  if (/^\d{3,4}$/.test(str)) {
    const n = parseInt(str, 10);
    const h = Math.floor(n / 100);
    const min = n % 100;
    if (h < 24 && min < 60) return h * 60 + min;
  }
  return null;
}

function minutesToLabel(min: number | null): string | null {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function classifyStatus(rawStatus: string, workingHours: number, halfDayHours = DEFAULT_PAYROLL_SETTINGS.halfDayHours): DayBreakdown['classification'] {
  const s = (rawStatus || '').toLowerCase().trim();
  if (s === 'absent' || s === 'absence' || s === 'awol') return 'absent';
  if (s === 'not attempted' || s === 'not uploaded') return 'absent';
  if (s === 'weekend' || s === 'weak end' || s === 'weekly off') return 'weekly_off';
  if (s === 'holiday') return 'holiday';
  if (s === 'missed swipe' || s === 'incomplete' || s === 'missing punch') return 'missing_punch';
  if (workingHours > 0 && workingHours < halfDayHours) return 'half';
  if (s === 'late coming' || s === 'late') return 'late';
  if (s === 'early leaving' || s === 'early leave') return 'early';
  if (s === 'paid leave' || s === 'leave' || s === 'annual leave' || s === 'sick leave') return 'present'; // paid leave counts as paid
  // Normal / Official / present — refine by hours
  if (workingHours > 0 && workingHours < halfDayHours) return 'half';
  return 'present';
}

interface RawDay {
  recordDate: string;
  status: string;
  timeIn: string | null;
  timeOut: string | null;
}

// recordDate is "YYYY-MM-DD" — parse as a local calendar date to avoid UTC drift.
function isSunday(recordDate: string): boolean {
  const parts = recordDate.split('T')[0].split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.getDay() === 0;
}

function isItDepartment(department?: string | null) {
  return String(department || '').trim().toLowerCase() === 'it';
}

function paidLeaveAllowance(emp: { department?: string | null }) {
  return isItDepartment(emp.department) ? 2 : 4;
}

function applyDepartmentWeeklyOffPolicy(
  classification: DayBreakdown['classification'],
  recordDate: string,
  itDepartment: boolean,
): DayBreakdown['classification'] {
  if (itDepartment && isSunday(recordDate)) return 'weekly_off';
  if (!itDepartment && classification === 'weekly_off') return 'absent';
  return classification;
}

export function computeEmployeePayroll(
  emp: {
    id: number;
    employee_number?: string | null;
    biometric_id?: string | null;
    name: string;
    email?: string | null;
    department?: string | null;
    designation?: string | null;
    shift?: string | null;
    shift_end_time?: string | null;
    overtime_eligible?: boolean | null;
  },
  days: RawDay[],
  monthlySalary: number,
  _paidLeaveDays: number,
  settings: PayrollSettings,
): PayrollRow {
  const salaryDivisor = 30;
  const dailySalary = monthlySalary > 0 ? monthlySalary / salaryDivisor : 0;
  const overtimeDailySalary = monthlySalary > 0 ? monthlySalary / 30 : 0;
  const overtimePayPerDay = overtimeDailySalary / 2;
  const hourlyRate = settings.standardWorkingHours > 0 ? dailySalary / settings.standardWorkingHours : 0;

  const shiftStartMin = timeToMinutes(settings.shiftStart) ?? 540; // 9:00 default
  const shiftEndMin = timeToMinutes(emp.shift_end_time) ?? 1080; // Default 18:00 for 9-to-6 shifts.
  const overtimeEligible = emp.overtime_eligible === true;
  const itDepartment = isItDepartment(emp.department);

  let presentDays = 0, halfDays = 0, absentDays = 0, lateDays = 0, missingPunches = 0;
  let weeklyOffs = 0, holidays = 0, totalWorkingHours = 0, totalOvertimeHours = 0, overtimeDays = 0, punchCount = 0;

  for (const day of days) {
    const inMin = timeToMinutes(day.timeIn);
    const outMin = timeToMinutes(day.timeOut);
    if (day.timeIn || day.timeOut) punchCount++;
    let workingHours = 0;
    if (inMin != null && outMin != null && outMin >= inMin) {
      workingHours = (outMin - inMin) / 60;
    }
    const overtimeMinutes = overtimeEligible && shiftEndMin != null && outMin != null ? outMin - shiftEndMin : 0;
    const dayOvertimeHours = overtimeMinutes > 120
      ? overtimeMinutes / 60
      : 0;
    let classification = classifyStatus(day.status, workingHours, settings.halfDayHours);
    classification = applyDepartmentWeeklyOffPolicy(classification, day.recordDate, itDepartment);
    const isLate = (classification === 'late') ||
      ((classification === 'present' || classification === 'half') && inMin != null && inMin > shiftStartMin + settings.lateGraceMinutes);

    switch (classification) {
      case 'absent': absentDays++; break;
      case 'weekly_off': weeklyOffs++; break;
      case 'holiday': holidays++; break;
      case 'missing_punch': missingPunches++; presentDays++; break;
      case 'half': halfDays++; totalWorkingHours += workingHours; break;
      case 'late':
      case 'early':
      case 'present':
      default:
        presentDays++;
        totalWorkingHours += workingHours;
        break;
    }
    if (dayOvertimeHours > 0) {
      overtimeDays++;
      totalOvertimeHours += dayOvertimeHours;
    }
    if (isLate && classification !== 'late') lateDays++;
    if (classification === 'late') lateDays++;
  }

  // Paid leave excuses up to `paidLeaveDays` actual absent days (those days are
  // paid, not cut). Remaining absences stay unpaid.
  const paidLeave = Math.min(paidLeaveAllowance(emp), absentDays);
  const unpaidAbsent = absentDays - paidLeave;
  // Attendance-paid days are counted for reporting, but salary starts from the
  // monthly amount. Unpaid absence and half-day impact are listed as deductions.
  // Missing-punch days count as present and do not cut salary.
  const payableDays = presentDays + halfDays * 0.5 + weeklyOffs + holidays + paidLeave;
  const overtimeHoursRounded = Math.round(totalOvertimeHours * 10) / 10;
  const overtimePay = Math.round(overtimeDays * overtimePayPerDay);
  const absentDeduction = Math.round(unpaidAbsent * dailySalary);
  const halfDayDeduction = Math.round(halfDays * (dailySalary / 2));
  const grossSalary = Math.round(monthlySalary + overtimePay);

  // Deductions: late penalties only. Missing punches are displayed and notified,
  // but no salary amount is deducted for them.
  const missedPenalty = 0;
  // Every 3 late punches = 1 day salary deduction (hardcoded policy).
  const lateDeductionDays = Math.floor(lateDays / 3);
  const latePenalty = dailySalary * lateDeductionDays;
  const totalDeductions = Math.round(absentDeduction + halfDayDeduction + missedPenalty + latePenalty);
  const netSalary = grossSalary - totalDeductions;

  let status = 'Processed';
  if (monthlySalary <= 0) status = 'No Salary Config';

  return {
    employeeId: emp.id,
    employeeNumber: emp.employee_number || null,
    biometricId: emp.biometric_id || null,
    employeeName: emp.name,
    department: emp.department || null,
    designation: emp.designation || null,
    shift: emp.shift || null,
    monthlySalary,
    dailySalary,
    hourlyRate,
    presentDays,
    halfDays,
    totalAbsentDays: absentDays,
    absentDays: unpaidAbsent,
    lateDays,
    lateDeductionDays,
    missingPunches,
    punchCount,
    weeklyOffs,
    holidays,
    paidLeave,
    totalWorkingHours: Math.round(totalWorkingHours * 10) / 10,
    overtimeHours: overtimeHoursRounded,
    overtimePay,
    absentDeduction,
    halfDayDeduction,
    payableDays: settings.workingDays,
    grossSalary,
    totalDeductions,
    ruleDeductionDays: 0,
    ruleDeductionAmount: 0,
    ruleAllowanceAmount: 0,
    netSalary,
    status,
  };
}

export function buildEmployeeDetail(
  row: PayrollRow,
  emp: { email?: string | null; department?: string | null; shift_end_time?: string | null; overtime_eligible?: boolean | null },
  days: RawDay[],
  settings: PayrollSettings,
  matchedRules: MatchedRuleEffect[] = [],
): EmployeePayrollDetail {
  const shiftStartMin = timeToMinutes(settings.shiftStart) ?? 540;
  const shiftEndMin = timeToMinutes(emp.shift_end_time) ?? 1080; // Default 18:00 for 9-to-6 shifts.
  const overtimeEligible = emp.overtime_eligible === true;
  const itDepartment = isItDepartment(emp.department);
  const breakdown: DayBreakdown[] = days.map((day) => {
    const inMin = timeToMinutes(day.timeIn);
    const outMin = timeToMinutes(day.timeOut);
    let workingHours = 0;
    if (inMin != null && outMin != null && outMin >= inMin) workingHours = (outMin - inMin) / 60;
    const overtimeMinutes = overtimeEligible && shiftEndMin != null && outMin != null ? outMin - shiftEndMin : 0;
    const overtimeHours = overtimeMinutes > 120
      ? overtimeMinutes / 60
      : 0;
    const classification = classifyStatus(day.status, workingHours, settings.halfDayHours);
    const effectiveClassification = applyDepartmentWeeklyOffPolicy(classification, day.recordDate, itDepartment);
    const isLate = (classification === 'late') ||
      ((classification === 'present' || classification === 'half') && inMin != null && inMin > shiftStartMin + settings.lateGraceMinutes);
    return {
      date: day.recordDate,
      rawStatus: day.status,
      classification: effectiveClassification,
      timeIn: minutesToLabel(inMin),
      timeOut: minutesToLabel(outMin),
      workingHours: Math.round(workingHours * 10) / 10,
      overtimeHours: Math.round(overtimeHours * 10) / 10,
      isOvertime: overtimeHours > 0,
      isLate,
    };
  });

  const overtimePay = row.overtimePay;
  const absencePenalty = row.absentDeduction + row.halfDayDeduction;
  const missedPenalty = 0;
  const latePenalty = row.dailySalary * row.lateDeductionDays;
  const sortedBreakdown = breakdown.sort((a, b) => (a.date < b.date ? -1 : 1));
  const absenceDays = sortedBreakdown.filter(day => day.classification === 'absent');
  const paidLeaveDates = absenceDays.slice(0, row.paidLeave).map(day => day.date);
  const unpaidAbsenceDates = absenceDays.slice(row.paidLeave).map(day => day.date);
  const lateDates = sortedBreakdown.filter(day => day.isLate).map(day => day.date);
  const missingPunchDates = sortedBreakdown.filter(day => day.classification === 'missing_punch').map(day => day.date);
  const halfDayDates = sortedBreakdown.filter(day => day.classification === 'half').map(day => day.date);

  return {
    ...row,
    email: emp.email || null,
    workingDays: settings.workingDays,
    standardWorkingHours: settings.standardWorkingHours,
    otMultiplier: settings.otMultiplier,
    overtimePay,
    penaltyDeduction: Math.round(absencePenalty + missedPenalty + latePenalty),
    lateDates,
    paidLeaveDates,
    unpaidAbsenceDates,
    missingPunchDates,
    halfDayDates,
    matchedRules,
    days: sortedBreakdown,
  };
}

export function summarize(rows: PayrollRow[]): PayrollSummary {
  return {
    totalEmployees: rows.length,
    presentEmployees: rows.filter(r => r.presentDays + r.halfDays > 0).length,
    absentEmployees: rows.filter(r => r.absentDays > 0).length,
    halfDayEmployees: rows.filter(r => r.halfDays > 0).length,
    totalOvertimeHours: Math.round(rows.reduce((a, r) => a + r.overtimeHours, 0) * 10) / 10,
    totalSalaryPayable: rows.reduce((a, r) => a + r.netSalary, 0),
  };
}
