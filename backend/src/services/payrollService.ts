// Payroll computation engine.
// Pure functions — given attendance records, employees, salary configs and
// settings, derive per-employee attendance breakdown + salary.

import type { MatchedRuleEffect } from './salaryRules';
import {
  attendanceTimeToMinutes as timeToMinutes,
  isLateArrival,
  lateDeductionDays as calculateLateDeductionDays,
  LATE_GRACE_MINUTES,
} from './latePolicy';

export interface DayBreakdown {
  date: string;
  rawStatus: string;
  classification: 'present' | 'half' | 'absent' | 'paid_leave' | 'weekly_off' | 'holiday' | 'missing_punch' | 'late' | 'early';
  timeIn: string | null;
  timeOut: string | null;
  workingHours: number;
  overtimeHours: number;
  isOvertime: boolean;
  isLate: boolean;
  paidLeaveFraction: number;
  unpaidLeaveFraction: number;
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
  lateDaysPerDeduction: number; // late days required for one salary-day deduction (default 3)
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
  paidLeaveEligible: boolean;
  paidLeaveLimit: number;
  paidLeaveRemaining: number;
  unpaidApprovedLeave: number;
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
  overtimeDates: string[];
  paidLeaveDates: string[];
  paidLeaveDetails: Array<{ date: string; fraction: number; source: 'approved_request' | 'automatic_absence' }>;
  unpaidLeaveDetails: Array<{ date: string; fraction: number; source: 'approved_request' | 'automatic_absence' }>;
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
  lateGraceMinutes: LATE_GRACE_MINUTES,
  shiftStart: '09:00',
  otThresholdHours: 2,
  otMultiplier: 1.5,
  latePenaltyDays: 0,
  paidLeaveDays: 2,
  lateDaysPerDeduction: 3,
};

export const NON_IT_PAID_LEAVE_DAYS = 4;

export interface PaidLeavePolicy {
  eligible: boolean;
  limit: number;
  sundayIsWeeklyOff: boolean;
  source: 'non_it_department' | 'it_employee_eligibility';
}

export function parseSettings(raw: Record<string, string>): PayrollSettings {
  const num = (k: string, def: number) => {
    const v = parseFloat(raw[k]);
    return isNaN(v) ? def : v;
  };
  return {
    workingDays: Math.max(1, num('working_days', DEFAULT_PAYROLL_SETTINGS.workingDays)),
    missedSwipeWeight: num('missed_swipe_weight', DEFAULT_PAYROLL_SETTINGS.missedSwipeWeight),
    standardWorkingHours: num('standard_working_hours', DEFAULT_PAYROLL_SETTINGS.standardWorkingHours),
    halfDayHours: num('half_day_hours', DEFAULT_PAYROLL_SETTINGS.halfDayHours),
    lateGraceMinutes: num('late_grace_minutes', DEFAULT_PAYROLL_SETTINGS.lateGraceMinutes),
    shiftStart: raw['shift_start'] || DEFAULT_PAYROLL_SETTINGS.shiftStart,
    otThresholdHours: num('ot_threshold_hours', DEFAULT_PAYROLL_SETTINGS.otThresholdHours),
    otMultiplier: num('ot_multiplier', DEFAULT_PAYROLL_SETTINGS.otMultiplier),
    latePenaltyDays: num('late_penalty_days', DEFAULT_PAYROLL_SETTINGS.latePenaltyDays),
    paidLeaveDays: Math.max(0, Math.min(31, num('paid_leave_days', DEFAULT_PAYROLL_SETTINGS.paidLeaveDays))),
    lateDaysPerDeduction: Math.max(1, num('late_days_per_deduction', DEFAULT_PAYROLL_SETTINGS.lateDaysPerDeduction)),
  };
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

export function qualifyingOvertimeHours(
  overtimeEligible: boolean,
  status: string,
  timeIn: unknown,
  timeOut: unknown,
  shiftEnd: unknown,
  thresholdHours = DEFAULT_PAYROLL_SETTINGS.otThresholdHours,
) {
  if (!overtimeEligible || /absent|weekly[ _]off|weekend|holiday|leave|missing|missed[ _]swipe/i.test(status)) return 0;
  const inMinutes = timeToMinutes(timeIn);
  const outMinutes = timeToMinutes(timeOut);
  const shiftEndMinutes = timeToMinutes(shiftEnd) ?? 18 * 60;
  if (inMinutes == null || outMinutes == null || outMinutes < inMinutes) return 0;
  const overtimeMinutes = outMinutes - shiftEndMinutes;
  return overtimeMinutes > Math.max(0, thresholdHours) * 60 ? overtimeMinutes / 60 : 0;
}

export interface RawDay {
  recordDate: string;
  status: string;
  timeIn: string | null;
  timeOut: string | null;
  approvedLeaveFraction?: number;
  approvedLeavePaid?: boolean;
  approvedPaidLeaveFraction?: number;
  approvedUnpaidLeaveFraction?: number;
  payrollLeaveFraction?: number;
  leaveAllocationSource?: 'approved_request' | 'automatic_absence';
}

// recordDate is "YYYY-MM-DD" — parse as a local calendar date to avoid UTC drift.
export function isPayrollDay(recordDate: string): boolean {
  const match = String(recordDate || '').slice(0, 10).match(/^\d{4}-\d{2}-(\d{2})$/);
  if (!match) return false;
  const day = Number(match[1]);
  return day >= 1 && day <= 30;
}

export function isSunday(recordDate: string): boolean {
  const parts = recordDate.split('T')[0].split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.getDay() === 0;
}

export function isItDepartment(department?: string | null) {
  return String(department || '').trim().toLowerCase() === 'it';
}

export function paidLeavePolicyForEmployee(
  emp: { department?: string | null; paid_leaves_eligible?: boolean | null },
  configuredItPaidLeaveDays: number,
): PaidLeavePolicy {
  if (!isItDepartment(emp.department)) {
    return {
      eligible: true,
      limit: NON_IT_PAID_LEAVE_DAYS,
      sundayIsWeeklyOff: false,
      source: 'non_it_department',
    };
  }

  const eligible = emp.paid_leaves_eligible === true;
  return {
    eligible,
    limit: eligible ? Math.max(0, Math.min(31, Number(configuredItPaidLeaveDays) || 0)) : 0,
    sundayIsWeeklyOff: true,
    source: 'it_employee_eligibility',
  };
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

function workingHoursForDay(day: RawDay) {
  const inMin = timeToMinutes(day.timeIn);
  const outMin = timeToMinutes(day.timeOut);
  return inMin != null && outMin != null && outMin >= inMin ? (outMin - inMin) / 60 : 0;
}

/**
 * Allocate the employee's monthly paid-leave allowance in date order.
 * Attendance wins over an overlapping leave request. Eligible employees receive
 * the allowance automatically on their first genuine absences of the month.
 */
export function allocatePaidLeaveFractions(
  emp: { department?: string | null; paid_leaves_eligible?: boolean | null },
  days: RawDay[],
  paidLeaveDays: number,
  settings: PayrollSettings,
): RawDay[] {
  const policy = paidLeavePolicyForEmployee(emp, paidLeaveDays);
  const eligible = policy.eligible;
  const limit = policy.limit;
  let remaining = limit;
  const itDepartment = isItDepartment(emp.department);
  return days
    .map(day => ({ ...day }))
    .filter(day => isPayrollDay(day.recordDate))
    .sort((a, b) => a.recordDate.localeCompare(b.recordDate))
    .map(day => {
      const approvedFraction = Math.max(0, Math.min(1, Number(day.approvedLeaveFraction) || 0));
      const workingHours = workingHoursForDay(day);
      const classification = applyDepartmentWeeklyOffPolicy(
        classifyStatus(day.status, workingHours, settings.halfDayHours),
        day.recordDate,
        itDepartment,
      );

      let leaveFraction = 0;
      let source: RawDay['leaveAllocationSource'];
      if (classification === 'absent') {
        leaveFraction = approvedFraction > 0 ? approvedFraction : 1;
        source = approvedFraction > 0 ? 'approved_request' : 'automatic_absence';
      } else if (classification === 'half' && approvedFraction > 0) {
        // A half day of work may be combined with at most a half day of leave.
        leaveFraction = Math.min(approvedFraction, 0.5);
        source = 'approved_request';
      }

      // A full attended day, holiday, or weekly off never consumes leave.
      const explicitlyUnpaid = source === 'approved_request' && day.approvedLeavePaid === false;
      const paidFraction = leaveFraction > 0 && eligible && !explicitlyUnpaid
        ? Math.min(leaveFraction, remaining)
        : 0;
      const unpaidFraction = Math.max(0, leaveFraction - paidFraction);
      remaining = Math.max(0, remaining - paidFraction);
      return {
        ...day,
        payrollLeaveFraction: leaveFraction,
        leaveAllocationSource: source,
        approvedPaidLeaveFraction: paidFraction,
        approvedUnpaidLeaveFraction: unpaidFraction,
      };
    });
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
    shift_start_time?: string | null;
    shift_end_time?: string | null;
    overtime_eligible?: boolean | null;
    paid_leaves_eligible?: boolean | null;
  },
  days: RawDay[],
  monthlySalary: number,
  paidLeaveDays: number,
  settings: PayrollSettings,
): PayrollRow {
  const paidLeavePolicy = paidLeavePolicyForEmployee(emp, paidLeaveDays);
  const normalizedPaidLeaveLimit = paidLeavePolicy.limit;
  const salaryDivisor = settings.workingDays;
  const dailySalary = monthlySalary > 0 ? monthlySalary / salaryDivisor : 0;
  const overtimeDailySalary = monthlySalary > 0 ? monthlySalary / salaryDivisor : 0;
  const overtimePayPerDay = overtimeDailySalary / 2;
  const hourlyRate = settings.standardWorkingHours > 0 ? dailySalary / settings.standardWorkingHours : 0;

  const shiftStart = emp.shift_start_time || settings.shiftStart;
  const overtimeEligible = emp.overtime_eligible === true;
  const itDepartment = isItDepartment(emp.department);

  const allocatedDays = allocatePaidLeaveFractions(emp, days, normalizedPaidLeaveLimit, settings);
  let presentDays = 0, halfDays = 0, absentDays = 0, approvedPaidLeave = 0, unpaidApprovedLeave = 0, lateDays = 0, missingPunches = 0;
  let weeklyOffs = 0, holidays = 0, totalWorkingHours = 0, totalOvertimeHours = 0, overtimeDays = 0, punchCount = 0;

  for (const day of allocatedDays) {
    const inMin = timeToMinutes(day.timeIn);
    const outMin = timeToMinutes(day.timeOut);
    if (day.timeIn || day.timeOut) punchCount++;
    let workingHours = 0;
    if (inMin != null && outMin != null && outMin >= inMin) {
      workingHours = (outMin - inMin) / 60;
    }
    let classification = classifyStatus(day.status, workingHours, settings.halfDayHours);
    classification = applyDepartmentWeeklyOffPolicy(classification, day.recordDate, itDepartment);
    const dayOvertimeHours = qualifyingOvertimeHours(
      overtimeEligible,
      classification,
      day.timeIn,
      day.timeOut,
      emp.shift_end_time,
      settings.otThresholdHours,
    );
    const leaveFraction = Math.max(0, Math.min(1, Number(day.payrollLeaveFraction || 0)));
    if (leaveFraction > 0 && classification !== 'weekly_off' && classification !== 'holiday') {
      const paidFraction = Math.max(0, Math.min(leaveFraction, Number(day.approvedPaidLeaveFraction) || 0));
      const unpaidFraction = Math.max(0, leaveFraction - paidFraction);
      approvedPaidLeave += paidFraction;
      if (day.leaveAllocationSource === 'approved_request') unpaidApprovedLeave += unpaidFraction;
      absentDays += unpaidFraction;
      const uncoveredFraction = 1 - leaveFraction;
      if (uncoveredFraction > 0) {
        if (workingHours > 0) {
          presentDays += uncoveredFraction;
          totalWorkingHours += workingHours;
        } else {
          absentDays += uncoveredFraction;
        }
      }
      continue;
    }
    const isLate = isLateArrival(classification, day.timeIn, shiftStart, settings.lateGraceMinutes);

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

  // Eligible employees receive their configured monthly allowance on the first
  // genuine absences. Attendance always overrides an overlapping leave request.
  const paidLeave = approvedPaidLeave;
  const unpaidAbsent = absentDays;
  // Attendance-paid days are counted for reporting, but salary starts from the
  // monthly amount. Unpaid absence and half-day impact are listed as deductions.
  // Missing-punch days count as present and do not cut salary.
  const payableDays = presentDays + halfDays * 0.5 + weeklyOffs + holidays + paidLeave;
  const overtimeHoursRounded = Math.round(totalOvertimeHours * 10) / 10;
  const overtimePay = Math.round(overtimeDays * overtimePayPerDay);
  const absentDeduction = Math.round(unpaidAbsent * dailySalary);
  const halfDayDeduction = Math.round(halfDays * (dailySalary / 2));
  // Gross salary is the fixed monthly salary reference. Overtime pay is added to the
  // final net amount for overtime-eligible employees who worked qualifying overtime,
  // so the net can exceed the gross salary by the overtime pay earned.
  const grossSalary = Math.round(monthlySalary);

  // Deductions: late penalties only. Missing punches are displayed and notified,
  // but no salary amount is deducted for them.
  const missedPenalty = 0;
  // Late deduction: every N late days (configurable, default 3) = 1 salary-day deduction.
  const lateDeductionDays = calculateLateDeductionDays(lateDays, settings.lateDaysPerDeduction);
  const latePenalty = dailySalary * lateDeductionDays;
  const totalDeductions = Math.round(absentDeduction + halfDayDeduction + missedPenalty + latePenalty);
  // Net salary = gross minus deductions, plus overtime pay for eligible employees.
  // Clamped to never go below 0. Overtime pay can make net exceed gross.
  const netSalary = Math.max(0, grossSalary - totalDeductions + overtimePay);

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
    paidLeaveEligible: paidLeavePolicy.eligible,
    paidLeaveLimit: normalizedPaidLeaveLimit,
    paidLeaveRemaining: Math.max(0, normalizedPaidLeaveLimit - paidLeave),
    unpaidApprovedLeave,
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
  emp: { email?: string | null; department?: string | null; shift_start_time?: string | null; shift_end_time?: string | null; overtime_eligible?: boolean | null; paid_leaves_eligible?: boolean | null },
  days: RawDay[],
  settings: PayrollSettings,
  matchedRules: MatchedRuleEffect[] = [],
): EmployeePayrollDetail {
  const shiftStart = emp.shift_start_time || settings.shiftStart;
  const overtimeEligible = emp.overtime_eligible === true;
  const itDepartment = isItDepartment(emp.department);
  const allocatedDays = allocatePaidLeaveFractions(emp, days, row.paidLeaveLimit, settings);
  const breakdown: DayBreakdown[] = allocatedDays.map((day) => {
    const inMin = timeToMinutes(day.timeIn);
    const outMin = timeToMinutes(day.timeOut);
    let workingHours = 0;
    if (inMin != null && outMin != null && outMin >= inMin) workingHours = (outMin - inMin) / 60;
    const classification = classifyStatus(day.status, workingHours, settings.halfDayHours);
    let effectiveClassification = applyDepartmentWeeklyOffPolicy(classification, day.recordDate, itDepartment);
    const paidLeaveFraction = Number(day.approvedPaidLeaveFraction) || 0;
    const unpaidLeaveFraction = Number(day.approvedUnpaidLeaveFraction) || 0;
    if (paidLeaveFraction >= 1 && workingHours === 0) effectiveClassification = 'paid_leave';
    const overtimeHours = qualifyingOvertimeHours(
      overtimeEligible,
      effectiveClassification,
      day.timeIn,
      day.timeOut,
      emp.shift_end_time,
      settings.otThresholdHours,
    );
    const isLate = isLateArrival(effectiveClassification, day.timeIn, shiftStart, settings.lateGraceMinutes);
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
      paidLeaveFraction,
      unpaidLeaveFraction,
    };
  });

  const overtimePay = row.overtimePay;
  const absencePenalty = row.absentDeduction + row.halfDayDeduction;
  const missedPenalty = 0;
  const latePenalty = row.dailySalary * row.lateDeductionDays;
  const sortedBreakdown = breakdown.sort((a, b) => (a.date < b.date ? -1 : 1));
  const sourceDayByDate = new Map(allocatedDays.map(day => [day.recordDate, day]));
  const paidLeaveDetails = sortedBreakdown
    .map(day => {
      const source = sourceDayByDate.get(day.date);
      return {
        date: day.date,
        fraction: Number(source?.approvedPaidLeaveFraction) || 0,
        source: source?.leaveAllocationSource || 'automatic_absence',
      };
    })
    .filter(day => day.fraction > 0);
  const unpaidLeaveDetails = sortedBreakdown
    .map(day => {
      const source = sourceDayByDate.get(day.date);
      return {
        date: day.date,
        fraction: Number(source?.approvedUnpaidLeaveFraction) || 0,
        source: source?.leaveAllocationSource || 'automatic_absence',
      };
    })
    .filter(day => day.fraction > 0);
  const paidLeaveDates = sortedBreakdown
    .filter(day => Number(sourceDayByDate.get(day.date)?.approvedPaidLeaveFraction || 0) > 0)
    .map(day => day.date);
  const unpaidAbsenceDates = sortedBreakdown
    .filter(day => {
      const source = sourceDayByDate.get(day.date);
      if (Number(source?.approvedUnpaidLeaveFraction || 0) > 0) return true;
      const paidFraction = Number(source?.approvedPaidLeaveFraction || 0);
      return day.classification === 'absent' && paidFraction < 1;
    })
    .map(day => day.date);
  const lateDates = sortedBreakdown.filter(day => day.isLate).map(day => day.date);
  const missingPunchDates = sortedBreakdown.filter(day => day.classification === 'missing_punch').map(day => day.date);
  const halfDayDates = sortedBreakdown.filter(day => day.classification === 'half').map(day => day.date);
  const overtimeDates = sortedBreakdown.filter(day => day.isOvertime).map(day => day.date);
  const datesByRuleMetric: Record<string, string[]> = {
    absentDays: unpaidAbsenceDates,
    lateComingDays: lateDates,
    missedSwipeDays: missingPunchDates,
    earlyLeavingDays: sortedBreakdown.filter(day => day.classification === 'early').map(day => day.date),
    halfDays: halfDayDates,
    overtimeDays: overtimeDates,
    overtimeHours: overtimeDates,
    totalFlagged: sortedBreakdown
      .filter(day => ['absent', 'late', 'missing_punch', 'early', 'half'].includes(day.classification))
      .map(day => day.date),
  };
  const visibleMatchedRules = matchedRules.map((rule) => {
    const dates = rule.dates || datesByRuleMetric[String(rule.conditionMetric || '')] || [];
    const totalAmount = rule.deductionAmount > 0 ? rule.deductionAmount : rule.allowanceAmount;
    return {
      ...rule,
      dates,
      totalAmount,
      amountPerDate: rule.amountPerDate || Math.round(totalAmount / Math.max(1, dates.length || Number(rule.repeatCount) || 1)),
    };
  });
  if (row.halfDays > 0) {
    visibleMatchedRules.push({
      id: -1001,
      name: `Working hours below ${settings.halfDayHours} hours mark Half Day`,
      label: `${row.halfDays} half day${row.halfDays === 1 ? '' : 's'} detected. Deduction is already included in Half-Day Deduction, so it is not added again as a rule deduction.`,
      deductionAmount: 0,
      allowanceAmount: 0,
      amount: 0,
      source: 'payroll_policy',
      policyDeductionAmount: row.halfDayDeduction,
      dates: halfDayDates,
      amountPerDate: Math.round(row.dailySalary / 2),
      totalAmount: row.halfDayDeduction,
      formula: `${row.halfDays} half day${row.halfDays === 1 ? '' : 's'} x Monthly Salary / ${settings.workingDays} / 2`,
      reason: 'Worked less than configured half-day hours',
      effectType: 'deduction',
    });
  }

  return {
    ...row,
    email: emp.email || null,
    workingDays: settings.workingDays,
    standardWorkingHours: settings.standardWorkingHours,
    otMultiplier: settings.otMultiplier,
    overtimePay,
    penaltyDeduction: Math.round(absencePenalty + missedPenalty + latePenalty),
    lateDates,
    overtimeDates,
    paidLeaveDates,
    paidLeaveDetails,
    unpaidLeaveDetails,
    unpaidAbsenceDates,
    missingPunchDates,
    halfDayDates,
    matchedRules: visibleMatchedRules,
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
