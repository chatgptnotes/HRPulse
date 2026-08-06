import prisma from '../db/prisma';

interface EmployeeSummary {
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  absentDays: number;
  missedSwipeDays: number;
  lateComingDays: number;
  earlyLeavingDays: number;
  /** Biometric-engine half days. 0 for periods sourced from Excel only. */
  halfDays: number;
  flaggedTotal: number;
  lopDays: number;
}

interface RuleConditions {
  absentDays?: { gte?: number; lte?: number };
  missedSwipeDays?: { gte?: number; lte?: number };
  lateComingDays?: { gte?: number; lte?: number };
  earlyLeavingDays?: { gte?: number; lte?: number };
  halfDays?: { gte?: number; lte?: number };
  totalFlagged?: { gte?: number; lte?: number };
  lopDays?: { gte?: number; lte?: number };
  /**
   * NOT IMPLEMENTED — declared by the seeded AWOL rule (seed.ts:192) but never
   * evaluated below, so that rule currently matches any 3 absent days rather
   * than 3 consecutive ones. Left as-is here: honouring it needs per-date
   * records, which EmployeeSummary does not carry.
   */
  consecutive?: boolean;
}

interface RuleActions {
  templateType: 'initial' | 'reminder' | 'escalation';
  severity: 'notice' | 'warning' | 'critical';
  notifyManager?: boolean;
  notifyHRDirector?: boolean;
  disciplinaryRisk?: boolean;
  awol?: boolean;
  /**
   * NOT APPLIED to the calculation, on purpose.
   *
   * The seeded rules use it to restate a per-status weight that the LOP formula
   * already applies from settings — 'Missed Biometric' declares 0.5, and
   * `missed_swipe_weight` is already 0.5. Applying it as a multiplier on the
   * total would discount an employee's absences too, halving a deduction that
   * has nothing to do with missed swipes.
   *
   * Occurrences are reported in `RuleLopBreakdown.ignoredMultipliers` so the
   * inconsistency stays visible instead of silently changing pay.
   */
  lopMultiplier?: number;
  /** Additional LOP days imposed by this rule. Applied — see `computeRuleLop`. */
  lopDays?: number;
  includeLopDetails?: boolean;
  wpsNotice?: boolean;
  integrityFlag?: boolean;
  initiateInvestigation?: boolean;
}

function matchesCondition(value: number, cond: { gte?: number; lte?: number }): boolean {
  if (cond.gte !== undefined && value < cond.gte) return false;
  if (cond.lte !== undefined && value > cond.lte) return false;
  return true;
}

function evaluateRule(emp: EmployeeSummary, conditions: RuleConditions): boolean {
  if (conditions.absentDays && !matchesCondition(emp.absentDays, conditions.absentDays)) return false;
  if (conditions.missedSwipeDays && !matchesCondition(emp.missedSwipeDays, conditions.missedSwipeDays)) return false;
  if (conditions.lateComingDays && !matchesCondition(emp.lateComingDays, conditions.lateComingDays)) return false;
  if (conditions.earlyLeavingDays && !matchesCondition(emp.earlyLeavingDays, conditions.earlyLeavingDays)) return false;
  if (conditions.halfDays && !matchesCondition(emp.halfDays, conditions.halfDays)) return false;
  if (conditions.totalFlagged && !matchesCondition(emp.flaggedTotal, conditions.totalFlagged)) return false;
  if (conditions.lopDays && !matchesCondition(emp.lopDays, conditions.lopDays)) return false;
  return true;
}

export interface RuleMatch {
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  triggeredRules: Array<{ id: number; name: string; ruleType: string; severity: string; actions: RuleActions }>;
  highestSeverity: 'notice' | 'warning' | 'critical';
  recommendedTemplate: 'initial' | 'reminder' | 'escalation';
  flags: { notifyManager: boolean; notifyHRDirector: boolean; disciplinaryRisk: boolean; awol: boolean };
}

const SEVERITY_RANK: Record<string, number> = { notice: 1, warning: 2, critical: 3 };
const TEMPLATE_FOR_SEVERITY: Record<string, 'initial' | 'reminder' | 'escalation'> = {
  notice: 'initial',
  warning: 'reminder',
  critical: 'escalation',
};

export interface RuleLopBreakdown {
  /** Extra LOP days the matched rules impose, on top of the attendance-derived base. */
  additionalLopDays: number;
  /** Which rule type contributed what, for showing the employee why. */
  byRuleType: Record<string, { lopDays: number; ruleName: string }>;
  /**
   * Rules that declare `lopMultiplier`, which is NOT applied. See the note on
   * `RuleActions.lopMultiplier`.
   */
  ignoredMultipliers: Array<{ ruleName: string; lopMultiplier: number }>;
}

/**
 * Turn matched rules into an LOP adjustment.
 *
 * Within one `ruleType` the seeded rules are graduated tiers of the same
 * offence — late coming at 1-3 / 4-6 / 7+ — so their penalties MUST NOT stack;
 * the largest applicable tier wins. Across different rule types (late coming vs
 * early leaving) the penalties are for different offences, so they add.
 */
export function computeRuleLop(triggeredRules: RuleMatch['triggeredRules']): RuleLopBreakdown {
  const byRuleType: RuleLopBreakdown['byRuleType'] = {};
  const ignoredMultipliers: RuleLopBreakdown['ignoredMultipliers'] = [];

  for (const rule of triggeredRules) {
    if (typeof rule.actions.lopMultiplier === 'number') {
      ignoredMultipliers.push({ ruleName: rule.name, lopMultiplier: rule.actions.lopMultiplier });
    }

    const lopDays = rule.actions.lopDays;
    if (typeof lopDays !== 'number' || lopDays <= 0) continue;

    const current = byRuleType[rule.ruleType];
    if (!current || lopDays > current.lopDays) {
      byRuleType[rule.ruleType] = { lopDays, ruleName: rule.name };
    }
  }

  const additionalLopDays = Object.values(byRuleType).reduce((sum, entry) => sum + entry.lopDays, 0);
  return { additionalLopDays, byRuleType, ignoredMultipliers };
}

export async function evaluateRulesForUpload(uploadId: number, summaries: EmployeeSummary[]): Promise<RuleMatch[]> {
  const rules = await prisma.attendanceRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  const results: RuleMatch[] = [];

  for (const emp of summaries) {
    if (emp.flaggedTotal === 0) continue;

    const triggered: RuleMatch['triggeredRules'] = [];

    for (const rule of rules) {
      const conditions = rule.conditions as RuleConditions;
      const actions = rule.actions as unknown as RuleActions;
      if (evaluateRule(emp, conditions)) {
        triggered.push({ id: rule.id, name: rule.name, ruleType: rule.ruleType, severity: actions.severity, actions });
      }
    }

    if (triggered.length === 0) continue;

    const highestSeverity = triggered.reduce((max, r) =>
      (SEVERITY_RANK[r.severity] || 0) > (SEVERITY_RANK[max] || 0) ? r.severity as any : max,
      'notice' as 'notice' | 'warning' | 'critical'
    );

    const flags = triggered.reduce((acc, r) => ({
      notifyManager: acc.notifyManager || !!r.actions.notifyManager,
      notifyHRDirector: acc.notifyHRDirector || !!r.actions.notifyHRDirector,
      disciplinaryRisk: acc.disciplinaryRisk || !!r.actions.disciplinaryRisk,
      awol: acc.awol || !!r.actions.awol,
    }), { notifyManager: false, notifyHRDirector: false, disciplinaryRisk: false, awol: false });

    results.push({
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      employeeEmail: emp.employeeEmail,
      triggeredRules: triggered,
      highestSeverity,
      recommendedTemplate: TEMPLATE_FOR_SEVERITY[highestSeverity],
      flags,
    });
  }

  return results;
}
