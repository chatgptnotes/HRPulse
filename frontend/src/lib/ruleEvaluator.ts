/**
 * Rule Execution Engine — evaluates structured rule definitions against a
 * context object. Pure TypeScript, no dependencies; runs in the browser to
 * power the Testing Sandbox and batch "Run" executions without touching
 * production data (evaluation is read-only against the supplied context).
 *
 * Supports:
 *  - All 13 comparison operators
 *  - AND / OR logical operators between top-level conditions
 *  - Nested condition groups via parentId (group rows are ALL/ANY containers)
 *  - 10 action types with safe formula evaluation ({field.path} substitution,
 *    digits/operators-only math — no eval of arbitrary code)
 */

import { operatorLabel } from './ruleFields';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror DB rows)
// ─────────────────────────────────────────────────────────────────────────────

export interface EvalCondition {
  id?: number;
  parentId?: number | null;
  logicalOperator?: 'AND' | 'OR' | null;
  field: string;
  operator: string;
  /** Stored as string in DB (JSON-encoded for lists). */
  value: string;
  valueType?: string;
  displayOrder?: number;
}

export interface EvalAction {
  id?: number;
  actionType: string;
  targetField?: string | null;
  value?: string | null;
  valueType?: string | null;
  formula?: string | null;
  amount?: number | null;
  percent?: number | null;
  notificationTemplate?: string | null;
  notificationRecipients?: string | null;
  displayOrder?: number;
}

export interface EvalRule {
  id: number;
  name: string;
  ruleType?: string;
  priority?: number;
  executionMode?: string;
  conditions: EvalCondition[];
  actions: EvalAction[];
}

export interface RuleContext {
  [key: string]: any;
}

export interface ConditionTrace {
  field: string;
  label: string;
  operator: string;
  value: string;
  actualValue: any;
  matched: boolean;
  skipped?: boolean;
}

export interface ActionTrace {
  actionType: string;
  targetField?: string | null;
  description: string;
  value?: any;
}

export interface RuleEvalResult {
  ruleId: number;
  ruleName: string;
  matched: boolean;
  executionTimeMs: number;
  conditionTraces: ConditionTrace[];
  matchedConditionLabels: string[];
  executedActions: ActionTrace[];
  outputPatch: Record<string, any>;
  notifications: Array<{ template: string; recipients: string[] }>;
  error?: string;
}

export interface BatchEvalResult {
  totalRules: number;
  matchedRules: number;
  failedRules: number;
  executionTimeMs: number;
  results: RuleEvalResult[];
  combinedPatch: Record<string, any>;
  notifications: Array<{ template: string; recipients: string[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field access / value parsing
// ─────────────────────────────────────────────────────────────────────────────

function getFieldValue(context: RuleContext, path: string): any {
  if (!path) return undefined;
  let value: any = context;
  for (const part of path.split('.')) {
    if (value && typeof value === 'object' && part in value) value = value[part];
    else return undefined;
  }
  return value;
}

function setFieldValue(target: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let obj: any = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
}

/** Parse the stored value string according to valueType. */
function parseValue(raw: string, valueType?: string): any {
  if (raw === undefined || raw === null) return undefined;
  const type = (valueType || 'string').toLowerCase();
  try {
    switch (type) {
      case 'number': return Number(String(raw).replace(/^"|"$/g, ''));
      case 'boolean': return String(raw).replace(/^"|"$/g, 'true').toLowerCase() === 'true';
      case 'list': return JSON.parse(String(raw).replace(/^"(.*)"$/s, '$1'));
      case 'json': return JSON.parse(raw);
      case 'date': return new Date(String(raw).replace(/^"|"$/g, ''));
      default: return String(raw).replace(/^"|"$/g, '');
    }
  } catch {
    return String(raw).replace(/^"|"$/g, '');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator evaluation
// ─────────────────────────────────────────────────────────────────────────────

function compare(fieldValue: any, operator: string, expected: any): boolean {
  // Missing context value: only "ne"-style operators can match meaningfully.
  if (fieldValue === undefined || fieldValue === null) return false;

  switch (operator) {
    case 'eq': return String(fieldValue) === String(expected);
    case 'ne': return String(fieldValue) !== String(expected);
    case 'gt': return Number(fieldValue) > Number(expected);
    case 'lt': return Number(fieldValue) < Number(expected);
    case 'gte': return Number(fieldValue) >= Number(expected);
    case 'lte': return Number(fieldValue) <= Number(expected);
    case 'contains': return String(fieldValue).toLowerCase().includes(String(expected).toLowerCase());
    case 'notContains': return !String(fieldValue).toLowerCase().includes(String(expected).toLowerCase());
    case 'startsWith': return String(fieldValue).toLowerCase().startsWith(String(expected).toLowerCase());
    case 'endsWith': return String(fieldValue).toLowerCase().endsWith(String(expected).toLowerCase());
    case 'in': return Array.isArray(expected) && expected.map(String).includes(String(fieldValue));
    case 'notIn': return Array.isArray(expected) && !expected.map(String).includes(String(fieldValue));
    case 'between': {
      const pair = Array.isArray(expected) ? expected : String(expected).split(',');
      return Number(fieldValue) >= Number(pair[0]) && Number(fieldValue) <= Number(pair[1]);
    }
    default: return false;
  }
}

function describeCondition(c: EvalCondition): string {
  return `${c.field} ${operatorLabel(c.operator)} ${c.value}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group evaluation (top-level AND/OR + nested groups)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a set of conditions. Rows whose parentId points to another condition
 * row are treated as nested under that row (the parent acts as a group header
 * when it has a logicalOperator and its field is empty or "__group__").
 */
function evaluateConditions(
  conditions: EvalCondition[],
  context: RuleContext,
  traces: ConditionTrace[],
): boolean {
  const sorted = [...conditions].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const rootRows = sorted.filter((c) => !c.parentId);
  const childrenOf = (id?: number) => sorted.filter((c) => c.parentId === id);

  const evalRow = (row: EvalCondition): boolean => {
    const children = childrenOf(row.id ?? undefined);
    // Group row: combine children with its logicalOperator.
    if (children.length > 0 && (row.field === '__group__' || !row.field)) {
      const childResults = children.map(evalRow);
      return row.logicalOperator === 'OR'
        ? childResults.some(Boolean)
        : childResults.every(Boolean);
    }
    // Leaf row: ordinary comparison.
    const actual = getFieldValue(context, row.field);
    const expected = parseValue(row.value, row.valueType);
    const matched = compare(actual, row.operator, expected);
    traces.push({
      field: row.field,
      label: describeCondition(row),
      operator: row.operator,
      value: row.value,
      actualValue: actual,
      matched,
    });
    return matched;
  };

  const results = rootRows.map(evalRow);

  // Combine top level: scan with AND/OR precedence left-to-right — OR has
  // lower precedence in classical logic, but for a flat builder row list the
  // intuitive reading is left-to-right with the row's own connector:
  // cond1 AND cond2 OR cond3 => ((cond1 AND cond2) OR cond3)
  let acc: boolean | null = null;
  let pending: 'AND' | 'OR' | null = null;
  for (let i = 0; i < rootRows.length; i++) {
    const rowResult = results[i];
    const connector = i === 0 ? null : (rootRows[i].logicalOperator ?? 'AND');
    pending = connector as 'AND' | 'OR' | null;
    if (acc === null) acc = rowResult;
    else if (pending === 'OR') acc = acc || rowResult;
    else acc = acc && rowResult;
  }
  return acc ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action execution (against a scratch output patch — never the live context)
// ─────────────────────────────────────────────────────────────────────────────

function safeFormula(formula: string, context: RuleContext): number | null {
  try {
    const substituted = formula.replace(/\{([^}]+)\}/g, (_m, path: string) => {
      const v = getFieldValue(context, path.trim());
      return v === undefined || v === null ? '0' : String(v);
    });
    const sanitized = substituted.replace(/[^0-9+\-*/().\s]/g, '');
    if (!sanitized.trim() || /[/]\s*0(?![.\d])/.test(sanitized)) return null;
    // Function constructor on a digits/operators-only string — no identifiers
    // survive sanitization, so nothing beyond arithmetic can execute.
    const value = Function(`"use strict"; return (${sanitized});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function executeAction(action: EvalAction, context: RuleContext, patch: Record<string, any>): { trace: ActionTrace; notification?: { template: string; recipients: string[] } } {
  const t = action.targetField;
  const base = t ? (getFieldValue(patch, t) !== undefined ? getFieldValue(patch, t) : getFieldValue(context, t)) : undefined;

  const num = (v: any, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  switch (action.actionType) {
    case 'set': {
      const v = action.value !== undefined && action.value !== null
        ? parseValue(action.value, action.valueType === 'fixed' || !action.valueType ? 'string' : action.valueType)
        : undefined;
      if (t) setFieldValue(patch, t, v);
      return { trace: { actionType: 'set', targetField: t, description: `Set ${t} = ${v}`, value: v } };
    }
    case 'add': {
      const delta = action.percent ? (num(base) * num(action.percent) / 100) : num(action.amount);
      if (t) setFieldValue(patch, t, num(base) + delta);
      return { trace: { actionType: 'add', targetField: t, description: `Add ${delta} to ${t}`, value: delta } };
    }
    case 'subtract': {
      const delta = action.percent ? (num(base) * num(action.percent) / 100) : num(action.amount);
      if (t) setFieldValue(patch, t, num(base) - delta);
      return { trace: { actionType: 'subtract', targetField: t, description: `Subtract ${delta} from ${t}`, value: -delta } };
    }
    case 'multiply': {
      const factor = action.percent ? num(action.percent) / 100 : num(action.value, 1);
      if (t) setFieldValue(patch, t, num(base) * factor);
      return { trace: { actionType: 'multiply', targetField: t, description: `Multiply ${t} by ${factor}`, value: factor } };
    }
    case 'divide': {
      const divisor = num(action.value, 1);
      if (t && divisor !== 0) setFieldValue(patch, t, num(base) / divisor);
      return { trace: { actionType: 'divide', targetField: t, description: `Divide ${t} by ${divisor}`, value: divisor } };
    }
    case 'calculate': {
      const result = safeFormula(action.formula || '', context);
      if (t && result !== null) setFieldValue(patch, t, result);
      return { trace: { actionType: 'calculate', targetField: t, description: `${t} = ${action.formula}`, value: result } };
    }
    case 'sendNotification': {
      let recipients: string[] = [];
      try { recipients = action.notificationRecipients ? JSON.parse(action.notificationRecipients) : []; } catch { recipients = []; }
      const template = action.notificationTemplate || 'generic';
      return {
        trace: { actionType: 'sendNotification', description: `Send notification "${template}" to ${recipients.join(', ') || 'employee'}` },
        notification: { template, recipients },
      };
    }
    case 'approve':
      return { trace: { actionType: 'approve', targetField: t, description: `Approve ${t || 'entity'}` } };
    case 'reject':
      return { trace: { actionType: 'reject', targetField: t, description: `Reject ${t || 'entity'}` } };
    case 'validate':
      if (t) setFieldValue(patch, t, 'flagged');
      return { trace: { actionType: 'validate', targetField: t, description: `Flag ${t || 'entity'} for review` } };
    default:
      return { trace: { actionType: action.actionType, description: `Unknown action type: ${action.actionType}` } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateRule(rule: EvalRule, context: RuleContext): RuleEvalResult {
  const t0 = performance.now();
  const result: RuleEvalResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    matched: false,
    executionTimeMs: 0,
    conditionTraces: [],
    matchedConditionLabels: [],
    executedActions: [],
    outputPatch: {},
    notifications: [],
  };

  try {
    const conditions = rule.conditions || [];
    if (conditions.length === 0) {
      result.matched = false;
      result.error = 'Rule has no conditions';
    } else {
      result.matched = evaluateConditions(conditions, context, result.conditionTraces);
    }

    if (result.matched) {
      result.matchedConditionLabels = result.conditionTraces.filter((ct) => ct.matched).map((ct) => ct.label);
      for (const action of rule.actions || []) {
        const { trace, notification } = executeAction(action, context, result.outputPatch);
        result.executedActions.push(trace);
        if (notification) result.notifications.push(notification);
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  result.executionTimeMs = Math.max(0, Math.round((performance.now() - t0) * 100) / 100);
  return result;
}

/** Evaluate many rules in priority order (highest priority first). */
export function evaluateRules(rules: EvalRule[], context: RuleContext): BatchEvalResult {
  const t0 = performance.now();
  const ordered = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const results = ordered.map((r) => evaluateRule(r, context));

  const combinedPatch: Record<string, any> = {};
  const notifications: Array<{ template: string; recipients: string[] }> = [];
  let failed = 0;
  for (const r of results) {
    if (r.error) failed += 1;
    Object.assign(combinedPatch, r.outputPatch);
    notifications.push(...r.notifications);
  }
  // Deep-merge nested patches (attendance.status etc.) into a combined object.
  const deep: Record<string, any> = {};
  const mergeInto = (target: any, source: any) => {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
        mergeInto(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  };
  for (const r of results) mergeInto(deep, r.outputPatch);

  return {
    totalRules: rules.length,
    matchedRules: results.filter((r) => r.matched).length,
    failedRules: failed,
    executionTimeMs: Math.round((performance.now() - t0) * 100) / 100,
    results,
    combinedPatch: deep,
    notifications,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation (used by the builder's Validation panel)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationIssue { severity: 'error' | 'warning'; field: string; message: string; }

export function validateRuleDraft(draft: {
  name?: string; categoryId?: number | null; conditions?: any[]; actions?: any[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!draft.name || !draft.name.trim()) issues.push({ severity: 'error', field: 'name', message: 'Rule name is required' });
  if (!draft.categoryId) issues.push({ severity: 'error', field: 'categoryId', message: 'Select a category' });
  if (!draft.conditions || draft.conditions.length === 0) {
    issues.push({ severity: 'error', field: 'conditions', message: 'At least one IF condition is required' });
  } else {
    draft.conditions.forEach((c, i) => {
      if (!c.field) issues.push({ severity: 'error', field: `conditions[${i}]`, message: `Condition ${i + 1}: choose a field` });
      if (c.value === '' || c.value === undefined || c.value === null) {
        issues.push({ severity: 'error', field: `conditions[${i}]`, message: `Condition ${i + 1}: enter a comparison value` });
      }
    });
    const orCount = draft.conditions.filter((c: any) => c.logicalOperator === 'OR').length;
    if (orCount > 0 && draft.conditions.length === 1) {
      issues.push({ severity: 'warning', field: 'conditions', message: 'A single condition with an OR connector has no effect' });
    }
  }
  if (!draft.actions || draft.actions.length === 0) {
    issues.push({ severity: 'error', field: 'actions', message: 'At least one THEN action is required' });
  } else {
    draft.actions.forEach((a, i) => {
      const needsTarget = ['set', 'add', 'subtract', 'multiply', 'divide', 'calculate'].includes(a.actionType);
      if (needsTarget && !a.targetField) {
        issues.push({ severity: 'error', field: `actions[${i}]`, message: `Action ${i + 1}: choose a target field` });
      }
      if ((a.actionType === 'set') && (a.value === undefined || a.value === '')) {
        issues.push({ severity: 'error', field: `actions[${i}]`, message: `Action ${i + 1}: enter the value to set` });
      }
      if (a.actionType === 'subtract' && !a.amount && !a.percent) {
        issues.push({ severity: 'error', field: `actions[${i}]`, message: `Action ${i + 1}: enter the deduction amount` });
      }
      if (a.actionType === 'sendNotification' && !a.notificationTemplate) {
        issues.push({ severity: 'error', field: `actions[${i}]`, message: `Action ${i + 1}: choose a notification template` });
      }
      if (a.actionType === 'calculate' && !a.formula) {
        issues.push({ severity: 'error', field: `actions[` + i + `]`, message: `Action ${i + 1}: enter a formula` });
      }
    });
  }
  return issues;
}