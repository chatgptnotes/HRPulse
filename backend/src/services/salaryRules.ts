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
        priority: r.priority,
      };
    })
    .filter((r: SalaryRule) =>
      r.deductDays > 0 || r.deductAmount > 0 || r.deductPercent > 0 ||
      r.allowanceAmount > 0 || r.allowancePercent > 0,
    );
}

// Compute one matched rule's rupee impact. Returns deduction and allowance amounts
// and a human label describing whichever effects fired.
function ruleImpact(
  rule: SalaryRule,
  monthlySalary: number,
  dailySalary: number,
): { deduction: number; allowance: number; label: string } {
  const parts: string[] = [];
  let deduction = 0;
  let allowance = 0;
  if (rule.deductDays > 0) {
    deduction += dailySalary * rule.deductDays;
    parts.push(`deduct ${rule.deductDays} day${rule.deductDays > 1 ? 's' : ''}`);
  }
  if (rule.deductAmount > 0) {
    deduction += rule.deductAmount;
    parts.push(`deduct INR ${rule.deductAmount}`);
  }
  if (rule.deductPercent > 0) {
    const v = monthlySalary * rule.deductPercent / 100;
    deduction += v;
    parts.push(`deduct ${rule.deductPercent}%`);
  }
  if (rule.allowanceAmount > 0) {
    allowance += rule.allowanceAmount;
    parts.push(`allowance INR ${rule.allowanceAmount}`);
  }
  if (rule.allowancePercent > 0) {
    const v = monthlySalary * rule.allowancePercent / 100;
    allowance += v;
    parts.push(`allowance ${rule.allowancePercent}%`);
  }
  return { deduction, allowance, label: parts.join(' + ') };
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
    const impact = ruleImpact(r, monthlySalary, dailySalary);
    deductDays += r.deductDays;
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
