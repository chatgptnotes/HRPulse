import prisma from '../db/prisma';

interface EmployeeSummary {
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  absentDays: number;
  missedSwipeDays: number;
  lateComingDays: number;
  earlyLeavingDays: number;
  flaggedTotal: number;
  lopDays: number;
}

interface RuleConditions {
  absentDays?: { gte?: number; lte?: number };
  missedSwipeDays?: { gte?: number; lte?: number };
  lateComingDays?: { gte?: number; lte?: number };
  earlyLeavingDays?: { gte?: number; lte?: number };
  totalFlagged?: { gte?: number; lte?: number };
  lopDays?: { gte?: number; lte?: number };
  consecutive?: boolean;
}

interface RuleActions {
  templateType: 'initial' | 'reminder' | 'escalation';
  severity: 'notice' | 'warning' | 'critical';
  notifyManager?: boolean;
  notifyHRDirector?: boolean;
  disciplinaryRisk?: boolean;
  awol?: boolean;
  lopMultiplier?: number;
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
  if (conditions.totalFlagged && !matchesCondition(emp.flaggedTotal, conditions.totalFlagged)) return false;
  if (conditions.lopDays && !matchesCondition(emp.lopDays, conditions.lopDays)) return false;
  return true;
}

export interface RuleMatch {
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  triggeredRules: Array<{ id: number; name: string; severity: string; actions: RuleActions }>;
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
      const actions = rule.actions as RuleActions;
      if (evaluateRule(emp, conditions)) {
        triggered.push({ id: rule.id, name: rule.name, severity: actions.severity, actions });
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
