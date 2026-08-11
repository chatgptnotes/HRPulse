import prisma from '../db/prisma';
import { calculateLOP, DEFAULT_HALF_DAY_LOP_WEIGHT } from './lopService';
import { countStatuses, isPayrollDeductibleDate, type AttendanceCounts } from './attendanceStatus';
import { evaluateRulesForUpload, computeRuleLop, type RuleMatch, type RuleLopBreakdown } from './ruleEngine';

/// Authoritative loss-of-pay calculation for an upload.
///
/// Every consumer — the attendance summary, the salary deductions endpoint, the
/// rule-evaluation endpoint and the email generator — goes through this one
/// function. Before it existed the same arithmetic was reimplemented in four
/// routes, which is how the four copies came to disagree about which statuses
/// count. It is also the figure that will become a voucher amount in Adamrit, so
/// there must be exactly one of it.
///
/// ── ORDERING ────────────────────────────────────────────────────────────────
/// Rule CONDITIONS can test `lopDays`, and rule ACTIONS can add to it. That is
/// circular unless the two are separated, so evaluation runs in two phases:
///
///   1. base LOP  — from attendance counts alone (absences, missed swipes,
///                  half days). This is what `lopDays` conditions are tested
///                  against.
///   2. final LOP — base plus whatever penalty the matched rules impose.
///
/// A rule therefore cannot trigger off a penalty imposed by another rule in the
/// same run. That is deliberate: the alternative is an evaluation order that
/// depends on rule priority and silently changes pay when a rule is reordered.

export interface EmployeeDeduction {
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  counts: AttendanceCounts;
  basicSalary: number;
  workingDays: number;
  /** LOP days from attendance counts only. */
  baseLopDays: number;
  /** LOP days added by matched rules. */
  ruleLopDays: number;
  /** base + rule. */
  lopDays: number;
  lopAmount: number;
  ruleMatch: RuleMatch | null;
  ruleLop: RuleLopBreakdown | null;
  leaveLimit: number;
}

export interface DeductionContext {
  workingDays: number;
  missedSwipeWeight: number;
  halfDayWeight: number;
}

export async function loadDeductionContext(): Promise<DeductionContext> {
  const rows = await prisma.setting.findMany();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    // Salary deductions always use a fixed 30-day payroll month. A date on the
    // 31st is retained as attendance history but never contributes to payroll.
    workingDays: 30,
    missedSwipeWeight: parseFloat(settings['missed_swipe_weight'] || '0.5'),
    halfDayWeight: parseFloat(settings['half_day_lop_weight'] || String(DEFAULT_HALF_DAY_LOP_WEIGHT)),
  };
}

/**
 * Compute deductions for every employee in an upload.
 *
 * Pure read — writes nothing. Callers that need email drafts or persisted
 * results do that themselves from the returned data.
 */
export async function computeDeductionsForUpload(uploadId: number): Promise<EmployeeDeduction[]> {
  const context = await loadDeductionContext();

  const employees = await prisma.employee.findMany({
    where: { attendanceRecords: { some: { uploadId } } },
    include: {
      attendanceRecords: { where: { uploadId }, orderBy: { recordDate: 'asc' } },
      salaryConfigs: { orderBy: { effectiveMonth: 'desc' }, take: 1 },
    },
  });

  // Phase 1 — base LOP from attendance counts.
  const base = employees.map(emp => {
    const payrollRecords = emp.attendanceRecords.filter(record => isPayrollDeductibleDate(record.recordDate));
    const counts = countStatuses(payrollRecords);
    const basicSalary = Number(emp.salaryConfigs[0]?.basicSalary ?? 0);

    // Determine if employee is Rafttar/IT staff for leave limit calculation
    const rafttarStaff = /rafttar/i.test(`${emp.organisation || ''} ${emp.entity || ''} ${emp.department || ''}`);
    const isIt = /\bit\b|information technology/i.test(`${emp.department || ''} ${emp.organisation || ''} ${emp.entity || ''}`);
    // IT staff get 6 paid leaves (4 Sundays + 2 extra), non-IT get 4 (including Sundays)
    const leaveLimit = rafttarStaff || isIt ? 6 : 4;

    // Calculate protected absences (covered by allowance) vs chargeable (unpaid)
    const protectedAbsent = Math.min(counts.absentDays, Math.max(0, leaveLimit - counts.paidLeaveDays));
    counts.protectedAbsentDays = protectedAbsent;
    counts.chargeableAbsentDays = Math.max(0, counts.absentDays - protectedAbsent);

    const { baseLopDays } = calculateLOP({
      basicSalary,
      absentDays: counts.chargeableAbsentDays, // Use only unpaid absences for LOP calculation
      missedSwipeDays: counts.missedSwipeDays,
      halfDays: counts.halfDays,
      workingDays: context.workingDays,
      missedSwipeWeight: context.missedSwipeWeight,
      halfDayWeight: context.halfDayWeight,
    });
    return { emp, counts, basicSalary, baseLopDays, leaveLimit };
  });

  // Phase 2 — evaluate rules against the base figures.
  const matches = await evaluateRulesForUpload(
    uploadId,
    base.map(b => ({
      employeeId: b.emp.id,
      employeeName: b.emp.name,
      employeeEmail: b.emp.email,
      absentDays: b.counts.absentDays,
      missedSwipeDays: b.counts.missedSwipeDays,
      lateComingDays: b.counts.lateComingDays,
      earlyLeavingDays: b.counts.earlyLeavingDays,
      halfDays: b.counts.halfDays,
      flaggedTotal: b.counts.flaggedTotal,
      lopDays: b.baseLopDays,
    }))
  );
  const matchByEmployee = new Map(matches.map(m => [m.employeeId, m]));

  // Phase 3 — apply rule penalties and recompute.
  return base.map(({ emp, counts, basicSalary, leaveLimit }) => {
    const ruleMatch = matchByEmployee.get(emp.id) ?? null;
    const ruleLop = ruleMatch ? computeRuleLop(ruleMatch.triggeredRules) : null;

    const result = calculateLOP({
      basicSalary,
      absentDays: counts.chargeableAbsentDays, // Use only unpaid absences for LOP calculation
      missedSwipeDays: counts.missedSwipeDays,
      halfDays: counts.halfDays,
      workingDays: context.workingDays,
      missedSwipeWeight: context.missedSwipeWeight,
      halfDayWeight: context.halfDayWeight,
      ruleLopDays: ruleLop?.additionalLopDays ?? 0,
    });

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      employeeEmail: emp.email,
      counts,
      basicSalary,
      workingDays: context.workingDays,
      baseLopDays: result.baseLopDays,
      ruleLopDays: result.ruleLopDays,
      lopDays: result.lopDays,
      lopAmount: result.lopAmount,
      ruleMatch,
      ruleLop,
      leaveLimit,
    };
  });
}
