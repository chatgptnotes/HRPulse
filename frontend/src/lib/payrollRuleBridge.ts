/**
 * Payroll Rule Bridge — evaluates ALL active Rules Engine rules (the Supabase
 * `rules` / `rule_conditions` / `rule_actions` tables managed from the
 * Administration → Rules Engine builder, whether made manually or by the AI
 * generator) against salary calculation rows, converting whatever they express
 * into pay effects with a full per-rule breakdown.
 *
 * Reuses the same pure evaluator that powers the Testing Sandbox
 * (lib/ruleEvaluator.ts), so a rule that matches in the sandbox matches in
 * payroll and vice-versa.
 *
 * Generic action → pay mapping (any rule, nothing rule-specific):
 *  - subtract (₹ or % of basic)                        → deduction
 *  - add on bonus/allowance/net/salary targets (₹/%)   → bonus
 *  - add/subtract on deduction targets                 → deduction
 *  - set payroll.lostPayDays / LOP                     → LOP days → ₹ at daily rate
 *  - set salary.overtimeMultiplier = X                 → bonus = OT pay × (X − 1)
 *  - set ...deductions = ₹                             → deduction
 *  - set ...netSalary = ₹                              → bonus/deduction of the delta
 *  - multiply/divide on salary-ish targets             → bonus/deduction of the delta
 *  - calculate (formula) resolved by the evaluator     → mapped by its target
 *  - notifications / approvals / flags / other sets    → 'info' (visible, ₹ 0)
 *
 * Rules whose conditions use strictly per-day fields (dayOfWeek, timeIn…)
 * cannot be resolved against a monthly salary row; they surface as an 'info'
 * effect explaining they apply when each attendance day is processed.
 */

import { supabase } from './supabase';
import { evaluateRule, type EvalRule, type RuleContext } from './ruleEvaluator';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollRuleEffect {
  ruleId: number;
  ruleName: string;
  ruleType: string;
  /** Direction of the impact; 'info' is visible but changes nothing. */
  effect: 'deduction' | 'bonus' | 'info';
  /** Absolute rupee amount of the impact (always ≥ 0; sign comes from `effect`). */
  amount: number;
  /** When the effect came from LOP days, how many days were imposed. */
  lopDays?: number;
  /** Human-readable explanation shown on payslips and breakdowns. */
  description: string;
}

export interface PayrollRuleOutcome {
  effects: PayrollRuleEffect[];
  totalDeduction: number;
  totalBonus: number;
  appliedRuleNames: string[];
}

/** A salary-calculation row from getSalaryDeductions (fields the bridge reads). */
export interface PayrollRowLike {
  employeeName?: string;
  department?: string;
  organisation?: string;
  designation?: string;
  branch?: string;
  employeeStatus?: string;
  basicSalary: number;
  dailySalary?: number;
  presentDays?: number;
  absentDays?: number;
  halfDays?: number;
  missedSwipeDays?: number;
  lateOccurrences?: number;
  overtimeHours?: number;
  lopDays?: number;
  lopAmount?: number;
  netPayable?: number;
  /** Monthly paid-leave allowance (IT vs non-IT). */
  leaveLimit?: number;
  paidLeaveUsed?: number;
  workedWeeklyOffs?: number;
  /** Average hours per day that had a punch span — monthly view of workingHours. */
  avgWorkingHours?: number;
  /** Extra payment (worked weekly offs + unused leave + OT pay). */
  extraPayment?: number;
  overtimePayment?: number;
  /** Attendance month, e.g. 2026-07. */
  period?: string;
  [key: string]: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule loading
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch active Rules Engine rules (with nested conditions/actions) once per calc. */
export async function fetchActivePayrollRules(): Promise<EvalRule[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('rules')
    .select('id, name, rule_type, priority, execution_mode, rule_conditions(*), rule_actions(*)')
    .eq('is_active', true);
  if (error) throw new Error(`Rules Engine could not be loaded for payroll: ${error.message}`);
  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    ruleType: r.rule_type,
    priority: r.priority,
    executionMode: r.execution_mode,
    conditions: (r.rule_conditions || []).map((c: any) => ({
      id: c.id,
      parentId: c.parent_id,
      logicalOperator: c.logical_operator,
      field: c.field,
      operator: c.operator,
      value: c.value,
      valueType: c.value_type,
      displayOrder: c.display_order,
    })),
    actions: (r.rule_actions || []).map((a: any) => ({
      id: a.id,
      actionType: a.action_type,
      targetField: a.target_field,
      value: a.value,
      valueType: a.value_type,
      formula: a.formula,
      amount: a.amount,
      percent: a.percent,
      notificationTemplate: a.notification_template,
      notificationRecipients: a.notification_recipients,
      displayOrder: a.display_order,
    })),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Context mapping (salary row → builder field catalog paths)
// ─────────────────────────────────────────────────────────────────────────────

export function buildPayrollContext(row: PayrollRowLike): RuleContext {
  const basic = Number(row.basicSalary ?? 0);
  const leaveLimit = Number(row.leaveLimit ?? 0);
  const paidLeaveUsed = Number(row.paidLeaveUsed ?? 0);
  return {
    employee: {
      name: row.employeeName ?? '',
      department: row.department ?? '',
      organisation: row.organisation ?? '',
      designation: row.designation ?? '',
      branch: row.branch ?? '',
      status: row.employeeStatus ?? 'Active',
      monthlySalary: basic,
    },
    attendance: {
      lateCount: Number(row.lateOccurrences ?? 0),
      absentDays: Number(row.absentDays ?? 0),
      missedSwipeCount: Number(row.missedSwipeDays ?? 0),
      halfDays: Number(row.halfDays ?? 0),
      presentDays: Number(row.presentDays ?? 0),
      overtimeHours: Number(row.overtimeHours ?? 0),
      // Monthly equivalent of the per-day field: average hours across days
      // that had a punch span.
      workingHours: Number(row.avgWorkingHours ?? 0),
      totalFlagged:
        Number(row.absentDays ?? 0) + Number(row.missedSwipeDays ?? 0) +
        Number(row.halfDays ?? 0) + Number(row.lateOccurrences ?? 0),
    },
    payroll: {
      basicSalary: basic,
      grossSalary: basic + Number(row.extraPayment ?? 0),
      netSalary: Number(row.netPayable ?? basic),
      deductions: Number(row.lopAmount ?? 0),
      allowances: Number(row.extraPayment ?? 0),
      lostPayDays: Number(row.lopDays ?? 0),
      period: row.period ?? '',
    },
    leave: {
      // Remaining monthly allowance is the closest payroll meaning of balance.
      balance: Math.max(0, leaveLimit - paidLeaveUsed),
      takenThisMonth: paidLeaveUsed,
      pendingRequests: 0,
      type: '',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pay-effect extraction
// ─────────────────────────────────────────────────────────────────────────────

const TL = (t?: string | null) => String(t || '').toLowerCase();

/** Fields that only exist per attendance day — unresolvable on a monthly row. */
const PER_DAY_CONDITION_FIELDS =
  /^(?:attendance\.)?(dayofweek|isweekend|isholiday|timein|timeout|lateminutes|earlyminutes|status|shiftname)$/i;

const isLopTarget = (t?: string | null) => /lostpaydays|\blop\b|lop_days/.test(TL(t));
const isDeductionTarget = (t?: string | null) => /deduction/.test(TL(t));
const isBonusTarget = (t?: string | null) => /bonus|allowance|incentive/.test(TL(t));
const isNetTarget = (t?: string | null) => /netsalary|netpayable|netpay|net pay/.test(TL(t));
const isPayTarget = (t?: string | null) =>
  /salary|payroll|\bpay\b|wage|deduction|bonus|allowance|incentive|net/.test(TL(t));
const isOtMultiplierTarget = (t?: string | null) => /overtimemultiplier|ot_multiplier|overtime multiplier/.test(TL(t));

/** Read a dotted path from the evaluator's output patch. */
function getPath(obj: any, path?: string): any {
  if (!path) return undefined;
  let value: any = obj;
  for (const part of path.split('.')) {
    if (value && typeof value === 'object' && part in value) value = value[part];
    else return undefined;
  }
  return value;
}

/** Evaluate all rules against one employee row and collect pay effects. */
export function evaluatePayrollRules(rules: EvalRule[], row: PayrollRowLike): PayrollRuleOutcome {
  const effects: PayrollRuleEffect[] = [];
  const context = buildPayrollContext(row);
  const basic = Number(row.basicSalary ?? 0);
  const daily = Number(row.dailySalary ?? (basic > 0 ? basic / 30 : 0));
  const net = Number(row.netPayable ?? basic);
  const allowances = Number(row.extraPayment ?? 0);
  const overtimePay = Number(row.overtimePayment ?? 0);
  const lopAmount = Number(row.lopAmount ?? 0);

  // Highest priority first — matches the engine's execution order.
  const ordered = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of ordered) {
    // A rule conditioned on a strictly per-day field cannot be judged against
    // a monthly salary row — say so instead of silently never matching.
    const perDayCondition = (rule.conditions || []).find((c) => PER_DAY_CONDITION_FIELDS.test(String(c.field || '').trim()));
    if (perDayCondition) {
      effects.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType ?? 'custom',
        effect: 'info',
        amount: 0,
        description: `${rule.name}: conditioned on the per-day field "${perDayCondition.field}" — it applies as each attendance day is processed (import / sandbox), not to the monthly salary total.`,
      });
      continue;
    }

    let result;
    try {
      result = evaluateRule(rule, context);
    } catch {
      continue; // A broken rule must never break payroll.
    }
    if (!result.matched) continue;

    const ruleDeductions: PayrollRuleEffect[] = [];
    const ruleBonuses: PayrollRuleEffect[] = [];
    const ruleInfos: PayrollRuleEffect[] = [];

    const mk = (effect: 'deduction' | 'bonus' | 'info', amount: number, description: string, lopDays?: number): PayrollRuleEffect => ({
      ruleId: rule.id, ruleName: rule.name, ruleType: rule.ruleType ?? 'custom',
      effect, amount, lopDays, description,
    });

    for (const action of rule.actions || []) {
      const t = action.targetField ?? '';
      const amount = Number(action.amount ?? 0);
      const percent = Number(action.percent ?? 0);
      const pctValue = percent > 0 ? +((basic * percent) / 100).toFixed(2) : 0;

      // 1. LOP days imposed by a rule → converted to ₹ at the daily rate.
      if (isLopTarget(t) && (action.actionType === 'set' || action.actionType === 'add')) {
        const days = Math.max(0, Number(action.value ?? amount ?? 0) || 0);
        if (days > 0) {
          ruleDeductions.push(mk('deduction', +(days * daily).toFixed(2),
            `${rule.name}: added ${days} loss-of-pay day${days === 1 ? '' : 's'} (₹${daily.toFixed(2)}/day)`, days));
        }
        continue;
      }

      switch (action.actionType) {
        // 2. A subtraction always reduces pay, whatever the target names.
        case 'subtract': {
          const value = pctValue > 0 ? pctValue : amount;
          if (value > 0) {
            ruleDeductions.push(mk('deduction', value, percent > 0
              ? `${rule.name}: deducted ${percent}% of basic salary (₹${value})`
              : `${rule.name}: deducted ₹${value}`));
          }
          break;
        }

        // 3. An add: to a deduction target it deepens the deduction; to any
        //    other pay target it is a bonus; leave and unknown targets are
        //    informational.
        case 'add': {
          const value = pctValue > 0 ? pctValue : amount;
          if (value > 0 && isDeductionTarget(t)) {
            ruleDeductions.push(mk('deduction', value, `${rule.name}: increased deductions by ₹${value}`));
          } else if (value > 0 && isPayTarget(t)) {
            ruleBonuses.push(mk('bonus', value, percent > 0
              ? `${rule.name}: added ${percent}% of basic salary (₹${value}) to ${t}`
              : `${rule.name}: added ₹${value} to ${t}`));
          } else if (value > 0) {
            ruleInfos.push(mk('info', 0, `${rule.name}: adds ${value} to ${t || 'field'} — no direct salary impact`));
          }
          break;
        }

        // 4. A set: the interesting targets are deductions (₹), the OT
        //    multiplier and absolute net salary; everything else is display.
        case 'set': {
          const numeric = Number(String(action.value ?? '').replace(/^"|"$/g, ''));
          if (isOtMultiplierTarget(t) && Number.isFinite(numeric)) {
            if (numeric > 1 && overtimePay > 0) {
              const bonus = +(overtimePay * (numeric - 1)).toFixed(2);
              ruleBonuses.push(mk('bonus', bonus, `${rule.name}: overtime multiplier ×${numeric} adds ₹${bonus} on ₹${overtimePay.toFixed(2)} overtime pay`));
            } else {
              ruleInfos.push(mk('info', 0, `${rule.name}: sets overtime multiplier to ×${numeric}${overtimePay > 0 ? '' : ' (no overtime pay this month)'}`));
            }
          } else if (isDeductionTarget(t) && Number.isFinite(numeric) && numeric > 0) {
            ruleDeductions.push(mk('deduction', +numeric.toFixed(2), `${rule.name}: sets deductions to ₹${numeric.toFixed(2)}`));
          } else if (isNetTarget(t) && Number.isFinite(numeric) && numeric > 0) {
            const delta = +(numeric - net).toFixed(2);
            if (delta > 0) ruleBonuses.push(mk('bonus', delta, `${rule.name}: sets net salary to ₹${numeric.toFixed(2)} (+₹${delta})`));
            else if (delta < 0) ruleDeductions.push(mk('deduction', Math.abs(delta), `${rule.name}: sets net salary to ₹${numeric.toFixed(2)} (−₹${Math.abs(delta)})`));
            else ruleInfos.push(mk('info', 0, `${rule.name}: net salary already ₹${numeric.toFixed(2)}`));
          } else {
            ruleInfos.push(mk('info', 0, `${rule.name}: sets ${t || 'field'}${action.value !== undefined && action.value !== null ? ` = ${action.value}` : ''} — no salary impact`));
          }
          break;
        }

        // 5. multiply / divide scale a pay figure; the delta becomes the effect.
        case 'multiply':
        case 'divide': {
          const factor = action.actionType === 'multiply'
            ? (percent > 0 ? percent / 100 : Number(action.value ?? 1) || 1)
            : 1 / (Number(action.value ?? 1) || 1);
          if (!Number.isFinite(factor) || factor === 1 || !isPayTarget(t)) {
            ruleInfos.push(mk('info', 0, `${rule.name}: ${action.actionType} on ${t || 'field'} — no salary impact`));
            break;
          }
          const base = isDeductionTarget(t) ? lopAmount : (isBonusTarget(t) || /allowance/.test(TL(t))) ? allowances : net;
          const delta = +(base * (factor - 1)).toFixed(2);
          if (delta > 0) ruleBonuses.push(mk('bonus', delta, `${rule.name}: ${t} ×${factor.toFixed(2)} adds ₹${delta} on ₹${base.toFixed(2)}`));
          else if (delta < 0) ruleDeductions.push(mk('deduction', Math.abs(delta), `${rule.name}: ${t} ×${factor.toFixed(2)} reduces ₹${base.toFixed(2)} by ₹${Math.abs(delta)}`));
          else ruleInfos.push(mk('info', 0, `${rule.name}: ${t} ×${factor.toFixed(2)} — no change this month`));
          break;
        }

        // 6. calculate: the evaluator already resolved the formula into its
        //    target; map the computed number by what the target is.
        case 'calculate': {
          const computed = Number(getPath(result.outputPatch, t));
          if (!Number.isFinite(computed)) {
            ruleInfos.push(mk('info', 0, `${rule.name}: formula ${action.formula} could not be resolved`));
            break;
          }
          if (isLopTarget(t) && computed > 0) {
            ruleDeductions.push(mk('deduction', +(computed * daily).toFixed(2),
              `${rule.name}: formula gave ${computed} loss-of-pay day${computed === 1 ? '' : 's'} (₹${daily.toFixed(2)}/day)`, computed));
          } else if (isDeductionTarget(t) && computed > 0) {
            ruleDeductions.push(mk('deduction', computed, `${rule.name}: formula ${action.formula} = ₹${computed.toFixed(2)} deduction`));
          } else if ((isBonusTarget(t) || /allowance/.test(TL(t))) && computed > 0) {
            ruleBonuses.push(mk('bonus', computed, `${rule.name}: formula ${action.formula} = ₹${computed.toFixed(2)} bonus`));
          } else if (isNetTarget(t)) {
            const delta = +(computed - net).toFixed(2);
            if (delta > 0) ruleBonuses.push(mk('bonus', delta, `${rule.name}: formula ${action.formula} → net +₹${delta}`));
            else if (delta < 0) ruleDeductions.push(mk('deduction', Math.abs(delta), `${rule.name}: formula ${action.formula} → net −₹${Math.abs(delta)}`));
            else ruleInfos.push(mk('info', 0, `${rule.name}: formula ${action.formula} — no change`));
          } else {
            ruleInfos.push(mk('info', 0, `${rule.name}: formula ${action.formula} = ${computed} (${t || 'field'}) — no salary impact`));
          }
          break;
        }

        // 7. Notifications, approvals and flags: visible but pay-neutral.
        default: {
          const what = action.actionType === 'sendNotification'
            ? `notification "${action.notificationTemplate || 'generic'}" to ${(() => { try { return (JSON.parse(action.notificationRecipients || '[]') as string[]).join(', ') || 'employee'; } catch { return 'employee'; } })()}`
            : `${action.actionType} on ${t || 'record'}`;
          ruleInfos.push(mk('info', 0, `${rule.name}: matched — sends/triggers ${what} (no salary change)`));
        }
      }
    }

    // Within ONE rule only the largest deduction applies (graduated tiers of
    // the same offence must not stack). Different rules stack, so every rule
    // the admin builds reaches the salary independently.
    const bestDeduction = ruleDeductions.reduce<PayrollRuleEffect | null>((best, e) => (!best || e.amount > best.amount ? e : best), null);
    if (bestDeduction) effects.push(bestDeduction);
    effects.push(...ruleBonuses, ...ruleInfos);
  }

  const totalDeduction = +effects.filter((e) => e.effect === 'deduction').reduce((s, e) => s + e.amount, 0).toFixed(2);
  const totalBonus = +effects.filter((e) => e.effect === 'bonus').reduce((s, e) => s + e.amount, 0).toFixed(2);

  return {
    effects,
    totalDeduction,
    totalBonus,
    appliedRuleNames: [...new Set(effects.map((e) => e.ruleName))],
  };
}