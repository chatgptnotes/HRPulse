import { supabase } from '../db/supabase';

// Salary-affecting rules.
//
// A rule affects salary through one or more `actions` fields. Any combination is
// supported, so a single rule can both deduct and add:
//   - deductDays        : N days cut (× dailySalary)
//   - deductAmount      : flat rupee deduction
//   - deductPercent     : % of monthly salary deducted
//   - allowanceAmount   : flat rupee addition
//   - allowancePercent  : % of monthly salary added
//   - overtimeHalfDayAllowance : add half-day salary (dailySalary / 2)
//
// `conditions.department` and `conditions.shift` optionally scope a rule; when omitted
// the rule applies to everyone. Conditions reuse the same attendance metrics as the
// email rule engine (absentDays, lateComingDays, missedSwipeDays, earlyLeavingDays,
// halfDays, overtimeDays, overtimeHours, totalFlagged).

interface Range { gte?: number; lte?: number }
interface RuleConditions {
  department?: string;
  shift?: string;
  absentDays?: Range;
  lateComingDays?: Range;
  missedSwipeDays?: Range;
  earlyLeavingDays?: Range;
  halfDays?: Range;
  overtimeDays?: Range;
  overtimeHours?: Range;
  totalFlagged?: Range;
}

export interface SalaryRule {
  id: number;
  name: string;
  department: string | null;
  shift: string | null;
  conditions: RuleConditions;
  deductDays: number;
  deductAmount: number;
  deductPercent: number;
  allowanceAmount: number;
  allowancePercent: number;
  overtimeHalfDayAllowance: boolean;
  repeat: boolean;
  priority: number;
}

export interface AttendanceSummary {
  absentDays: number;
  lateComingDays: number;
  missedSwipeDays: number;
  earlyLeavingDays: number;
  halfDays: number;
  overtimeDays: number;
  overtimeHours: number;
  totalFlagged: number;
}

// One matched rule's effect on an employee's salary.
// amount is the signed net rupee impact (negative = deduction, positive = addition).
export interface MatchedRuleEffect {
  id: number;
  name: string;
  label: string;
  deductionAmount: number;
  allowanceAmount: number;
  amount: number;
  repeatCount?: number;
  conditionMetric?: keyof AttendanceSummary;
  threshold?: number;
  amountPerDate?: number;
  formula?: string;
  reason?: string;
  effectType?: 'deduction' | 'allowance' | 'neutral';
  source?: 'salary_rule' | 'payroll_policy';
  policyDeductionAmount?: number;
  dates?: string[];
}

export interface SalaryRuleResult {
  deductDays: number;          // sum of deductDays across matched rules
  deductionAmount: number;     // total ₹ deducted by rules (incl. days-based)
  allowanceAmount: number;     // total ₹ added by rules
  matchedRules: MatchedRuleEffect[];
}

// Build the attendance summary a rule is evaluated against, from raw day records.
export function buildSummary(
  days: Array<{ status: string; overtimeHours?: number }>,
): AttendanceSummary {
  let absentDays = 0, lateComingDays = 0, missedSwipeDays = 0, earlyLeavingDays = 0, halfDays = 0, overtimeDays = 0, overtimeHours = 0;
  for (const d of days) {
    if (d.status === 'Absent') absentDays++;
    else if (d.status === 'Late Coming') lateComingDays++;
    else if (d.status === 'Missed Swipe') missedSwipeDays++;
    else if (d.status === 'Early Leaving') earlyLeavingDays++;
    else if (d.status === 'Half Day' || d.status === 'Half') halfDays++;
    const dayOvertime = Math.max(0, Number(d.overtimeHours) || 0);
    if (dayOvertime > 0) {
      overtimeDays++;
      overtimeHours += dayOvertime;
    }
  }
  return {
    absentDays,
    lateComingDays,
    missedSwipeDays,
    earlyLeavingDays,
    halfDays,
    overtimeDays,
    overtimeHours: Math.round(overtimeHours * 10) / 10,
    totalFlagged: absentDays + lateComingDays + missedSwipeDays + earlyLeavingDays + halfDays,
  };
}

function matchRange(value: number, cond: Range | undefined): boolean {
  if (!cond) return true;
  if (cond.gte !== undefined && value < cond.gte) return false;
  if (cond.lte !== undefined && value > cond.lte) return false;
  return true;
}

// Load active rules that have ANY salary effect (any of the five action fields > 0).
export async function loadSalaryRules(): Promise<SalaryRule[]> {
  const { data, error } = await supabase
    .from('attendance_rules')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (error) throw new Error(`loadSalaryRules: ${error.message}`);
  return (data || [])
    .map((r: any) => {
      const conditions = (r.conditions || {}) as RuleConditions;
      const a = r.actions || {};
      return {
        id: r.id,
        name: r.name,
        department: conditions.department || null,
        shift: conditions.shift || null,
        conditions,
        deductDays: Math.max(0, Number(a.deductDays) || 0),
        deductAmount: Math.max(0, Number(a.deductAmount) || 0),
        deductPercent: Math.max(0, Number(a.deductPercent) || 0),
        allowanceAmount: Math.max(0, Number(a.allowanceAmount) || 0),
        allowancePercent: Math.max(0, Number(a.allowancePercent) || 0),
        overtimeHalfDayAllowance: a.overtimeHalfDayAllowance === true,
        repeat: a.repeat === true,
        priority: r.priority,
      };
    })
    .filter((r: SalaryRule) =>
      r.deductDays > 0 || r.deductAmount > 0 || r.deductPercent > 0 ||
      r.allowanceAmount > 0 || r.allowancePercent > 0 || r.overtimeHalfDayAllowance,
    );
}

const REPEAT_METRICS: Array<keyof AttendanceSummary> = [
  'absentDays',
  'lateComingDays',
  'missedSwipeDays',
  'earlyLeavingDays',
  'halfDays',
  'overtimeDays',
  'overtimeHours',
  'totalFlagged',
];

function repeatCountForRule(rule: SalaryRule, summary: AttendanceSummary): number {
  if (!rule.repeat) return 1;
  for (const metric of REPEAT_METRICS) {
    const cond = rule.conditions[metric];
    const threshold = Number(cond?.gte);
    if (!Number.isFinite(threshold) || threshold <= 0) continue;
    return Math.max(1, Math.floor((Number(summary[metric]) || 0) / threshold));
  }
  return 1;
}

function primaryCondition(rule: SalaryRule): { metric?: keyof AttendanceSummary; threshold?: number } {
  for (const metric of REPEAT_METRICS) {
    const cond = rule.conditions[metric];
    const threshold = cond?.gte ?? cond?.lte;
    if (threshold !== undefined) return { metric, threshold: Number(threshold) || 0 };
  }
  return {};
}

// Compute one matched rule's rupee impact. Returns deduction and allowance amounts
// and a human label describing whichever effects fired.
function ruleImpact(
  rule: SalaryRule,
  monthlySalary: number,
  dailySalary: number,
  repeatCount: number,
): { deduction: number; allowance: number; label: string; amountPerDate: number; formula: string; reason: string; effectType: 'deduction' | 'allowance' | 'neutral' } {
  const parts: string[] = [];
  let deduction = 0;
  let allowance = 0;
  let amountPerDate = 0;
  let formula = 'Salary rule calculation';
  let reason = 'Rule matched this employee attendance summary';
  let effectType: 'deduction' | 'allowance' | 'neutral' = 'neutral';
  const scaledDeductDays = rule.deductDays * repeatCount;
  const scaledDeductAmount = rule.deductAmount * repeatCount;
  const scaledDeductPercent = rule.deductPercent * repeatCount;
  const scaledAllowanceAmount = rule.allowanceAmount * repeatCount;
  const scaledAllowancePercent = rule.allowancePercent * repeatCount;
  const scaledOvertimeHalfDayAllowance = (dailySalary / 2) * repeatCount;
  if (rule.deductDays > 0) {
    deduction += dailySalary * scaledDeductDays;
    parts.push(`deduct ${scaledDeductDays} day${scaledDeductDays > 1 ? 's' : ''}`);
    amountPerDate = Math.round(dailySalary);
    formula = `${scaledDeductDays} salary day${scaledDeductDays > 1 ? 's' : ''} x INR ${Math.round(dailySalary)}`;
    reason = 'Attendance rule deducted salary days';
    effectType = 'deduction';
  }
  if (rule.deductAmount > 0) {
    deduction += scaledDeductAmount;
    parts.push(`deduct INR ${scaledDeductAmount}`);
    amountPerDate = Math.round(scaledDeductAmount / Math.max(1, repeatCount));
    formula = `Fixed rule deduction INR ${scaledDeductAmount}`;
    reason = 'Attendance rule deducted a fixed amount';
    effectType = 'deduction';
  }
  if (rule.deductPercent > 0) {
    const v = monthlySalary * scaledDeductPercent / 100;
    deduction += v;
    parts.push(`deduct ${scaledDeductPercent}%`);
    amountPerDate = Math.round(v / Math.max(1, repeatCount));
    formula = `${scaledDeductPercent}% of monthly salary INR ${Math.round(monthlySalary)}`;
    reason = 'Attendance rule deducted a salary percentage';
    effectType = 'deduction';
  }
  if (rule.allowanceAmount > 0) {
    allowance += scaledAllowanceAmount;
    parts.push(`allowance INR ${scaledAllowanceAmount}`);
    amountPerDate = Math.round(scaledAllowanceAmount / Math.max(1, repeatCount));
    formula = `Fixed rule allowance INR ${scaledAllowanceAmount}`;
    reason = 'Attendance rule added a fixed allowance';
    effectType = 'allowance';
  }
  if (rule.allowancePercent > 0) {
    const v = monthlySalary * scaledAllowancePercent / 100;
    allowance += v;
    parts.push(`allowance ${scaledAllowancePercent}%`);
    amountPerDate = Math.round(v / Math.max(1, repeatCount));
    formula = `${scaledAllowancePercent}% of monthly salary INR ${Math.round(monthlySalary)}`;
    reason = 'Attendance rule added a salary percentage';
    effectType = 'allowance';
  }
  if (rule.overtimeHalfDayAllowance) {
    allowance += scaledOvertimeHalfDayAllowance;
    parts.push(`add ${repeatCount} half-day overtime pay`);
    amountPerDate = Math.round(dailySalary / 2);
    formula = `${repeatCount} overtime day${repeatCount > 1 ? 's' : ''} x Monthly Salary / 30 / 2`;
    reason = 'Overtime eligible employee worked more than 2 hours after shift end';
    effectType = 'allowance';
  }
  if (rule.repeat && repeatCount > 1) parts.push(`${repeatCount}x repeat`);
  return { deduction, allowance, label: parts.join(' + '), amountPerDate, formula, reason, effectType };
}

// Evaluate salary rules for one employee. Returns total deduction days, deduction
// and allowance rupee amounts, and a per-rule breakdown for UI display.
export function evaluateSalaryRules(
  summary: AttendanceSummary,
  department: string | null,
  shift: string | null,
  rules: SalaryRule[],
  monthlySalary: number,
  dailySalary: number,
): SalaryRuleResult {
  const matched: SalaryRule[] = [];
  for (const rule of rules) {
    if (rule.department && rule.department !== department) continue;
    if (rule.shift && rule.shift !== shift) continue;
    const c = rule.conditions;
    if (!matchRange(summary.absentDays, c.absentDays)) continue;
    if (!matchRange(summary.lateComingDays, c.lateComingDays)) continue;
    if (!matchRange(summary.missedSwipeDays, c.missedSwipeDays)) continue;
    if (!matchRange(summary.earlyLeavingDays, c.earlyLeavingDays)) continue;
    if (!matchRange(summary.halfDays, c.halfDays)) continue;
    if (!matchRange(summary.overtimeDays, c.overtimeDays)) continue;
    if (!matchRange(summary.overtimeHours, c.overtimeHours)) continue;
    if (!matchRange(summary.totalFlagged, c.totalFlagged)) continue;
    matched.push(rule);
  }

  let deductDays = 0;
  let deductionAmount = 0;
  let allowanceAmount = 0;
  const matchedRules: MatchedRuleEffect[] = [];
  for (const r of matched) {
    const repeatCount = repeatCountForRule(r, summary);
    const condition = primaryCondition(r);
    const impact = ruleImpact(r, monthlySalary, dailySalary, repeatCount);
    deductDays += r.deductDays * repeatCount;
    deductionAmount += impact.deduction;
    allowanceAmount += impact.allowance;
    const net = impact.allowance - impact.deduction;
    if (net !== 0 || impact.deduction > 0 || impact.allowance > 0) {
      matchedRules.push({
        id: r.id,
        name: r.name,
        label: impact.label,
        deductionAmount: Math.round(impact.deduction),
        allowanceAmount: Math.round(impact.allowance),
        amount: Math.round(net),
        repeatCount,
        conditionMetric: condition.metric,
        threshold: condition.threshold,
        amountPerDate: impact.amountPerDate,
        formula: impact.formula,
        reason: impact.reason,
        effectType: impact.effectType,
      });
    }
  }
  return {
    deductDays,
    deductionAmount: Math.round(deductionAmount),
    allowanceAmount: Math.round(allowanceAmount),
    matchedRules,
  };
}
