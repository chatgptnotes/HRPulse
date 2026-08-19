/**
 * Rules Engine — Supabase data layer.
 *
 * All persistence for the enterprise rules engine lives here: rules CRUD with
 * nested conditions/actions, automatic versioning on every save, maker-checker
 * approvals, execution logs, analytics aggregation, import/export, clone and
 * the AI generator call. The frontend talks to Supabase directly, matching the
 * pattern used by every other HRPulse page.
 */

import { supabase } from '../lib/supabase';
import type { RuleContext, BatchEvalResult } from '../lib/ruleEvaluator';

// ─────────────────────────────────────────────────────────────────────────────
// Row types (snake_case from PostgREST)
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleCategoryRow {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parent_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RuleConditionRow {
  id: number;
  rule_id: number;
  parent_id: number | null;
  logical_operator: 'AND' | 'OR' | null;
  field: string;
  operator: string;
  value: string;
  value_type: string;
  display_order: number;
}

export interface RuleActionRow {
  id: number;
  rule_id: number;
  group_id: number | null;
  action_type: string;
  target_field: string | null;
  value: string | null;
  value_type: string | null;
  formula: string | null;
  amount: number | null;
  percent: number | null;
  notification_template: string | null;
  notification_recipients: string | null;
  min_value: number | null;
  max_value: number | null;
  round_to: number | null;
  display_order: number;
}

export interface RuleRow {
  id: number;
  name: string;
  description: string | null;
  category_id: number;
  rule_type: string;
  is_active: boolean;
  priority: number;
  execution_mode: 'sync' | 'async';
  created_by: string;
  modified_by: string | null;
  created_at: string;
  updated_at: string;
  rule_categories?: RuleCategoryRow;
  rule_conditions?: RuleConditionRow[];
  rule_actions?: RuleActionRow[];
}

export interface RuleVersionRow {
  id: number;
  rule_id: number;
  version_number: number;
  name: string;
  description: string | null;
  conditions: any[];
  actions: any[];
  change_summary: string | null;
  modified_by: string;
  modified_at: string;
  approval_status: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  is_rollback: boolean;
}

export interface RuleApprovalRow {
  id: number;
  rule_id: number;
  requested_by: string;
  requested_at: string;
  request_type: string;
  change_summary: string | null;
  changes: any;
  approval_level: number;
  required_approvals: number;
  current_approvals: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approvers: any;
  approvals: any;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
}

export interface RuleLogRow {
  id: number;
  rule_id: number;
  employee_id: number | null;
  employee_name: string | null;
  entity_type: string | null;
  entity_id: number | null;
  executed_at: string;
  execution_duration: number | null;
  trigger_source: string | null;
  input_data: any;
  output_data: any;
  matched_conditions: any;
  executed_actions: any;
  status: string;
  error_message: string | null;
  executed_by: string | null;
  batch_id: string | null;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured. Check .env (SUPABASE_URL / SUPABASE_ANON_KEY).');
  return supabase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Save input shapes (loose — UI / AI / import paths produce partial rows)
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveConditionInput {
  parent_id?: number | null;
  logical_operator?: 'AND' | 'OR' | null;
  field: string;
  operator: string;
  value: any;
  value_type?: string;
  display_order?: number;
}

export interface SaveActionInput {
  action_type: string;
  target_field?: string | null;
  value?: any;
  value_type?: string | null;
  formula?: string | null;
  amount?: number | null;
  percent?: number | null;
  notification_template?: string | null;
  notification_recipients?: string | null;
  display_order?: number;
}

export interface SaveRuleInput {
  name: string;
  description?: string;
  category_id: number;
  rule_type: string;
  is_active?: boolean;
  priority?: number;
  execution_mode?: 'sync' | 'async';
  created_by?: string;
  modified_by?: string;
  conditions: SaveConditionInput[];
  actions: SaveActionInput[];
  changeSummary?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<RuleCategoryRow[]> {
  const { data, error } = await requireClient()
    .from('rule_categories')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw new Error(`Categories could not be loaded: ${error.message}`);
  return data || [];
}

export async function createCategory(input: { name: string; description?: string; icon?: string; color?: string; parent_id?: number }): Promise<RuleCategoryRow> {
  const { data, error } = await requireClient()
    .from('rule_categories')
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateCategory(id: number, input: Partial<{ name: string; description: string; icon: string; color: string; parent_id: number; is_active: boolean }>): Promise<RuleCategoryRow> {
  const { data, error } = await requireClient()
    .from('rule_categories')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCategory(id: number): Promise<void> {
  const { error } = await requireClient().from('rule_categories').delete().eq('id', id);
  if (error) throw new Error(error.message.includes('violates foreign key')
    ? 'This category has rules attached. Move or delete them first, or mark the category inactive.'
    : error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules CRUD (with nested conditions + actions)
// ─────────────────────────────────────────────────────────────────────────────

const RULE_SELECT = `
  *,
  rule_categories ( id, name, icon, color ),
  rule_conditions ( * ),
  rule_actions ( * )
`;

export async function fetchRules(filters?: {
  categoryId?: number;
  ruleType?: string;
  status?: 'active' | 'inactive';
  search?: string;
  priorityMin?: number;
}): Promise<RuleRow[]> {
  let query = requireClient().from('rules').select(RULE_SELECT);
  if (filters?.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters?.ruleType) query = query.eq('rule_type', filters.ruleType);
  if (filters?.status === 'active') query = query.eq('is_active', true);
  if (filters?.status === 'inactive') query = query.eq('is_active', false);
  if (filters?.priorityMin !== undefined) query = query.gte('priority', filters.priorityMin);
  if (filters?.search) {
    const like = `%${filters.search.toLowerCase()}%`;
    query = query.or(`name.ilike.${like},description.ilike.${like}`);
  }
  const { data, error } = await query.order('priority', { ascending: false }).order('name');
  if (error) throw new Error(`Rules could not be loaded: ${error.message}`);
  return (data || []) as RuleRow[];
}

export async function fetchRule(id: number): Promise<RuleRow> {
  const { data, error } = await requireClient().from('rules').select(RULE_SELECT).eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

/** Serialize a value for the text `value` column (numbers stay readable). */
function serializeValue(value: any): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function serializeActionValue(a: SaveActionInput): Record<string, any> {
  return {
    action_type: a.action_type,
    target_field: a.target_field ?? null,
    value: a.value !== undefined && a.value !== null ? String(a.value) : null,
    value_type: a.value_type ?? null,
    formula: a.formula ?? null,
    amount: a.amount ?? null,
    percent: a.percent ?? null,
    notification_template: a.notification_template ?? null,
    notification_recipients: a.notification_recipients ?? null,
    display_order: a.display_order ?? 0,
  };
}

/**
 * Create a rule with its conditions/actions and an initial version snapshot.
 */
export async function createRule(input: SaveRuleInput): Promise<RuleRow> {
  const client = requireClient();
  const { conditions, actions, changeSummary, created_by, ...ruleData } = input;

  const { data: rule, error } = await client
    .from('rules')
    .insert({
      ...ruleData,
      is_active: input.is_active ?? false,
      priority: input.priority ?? 10,
      execution_mode: input.execution_mode ?? 'sync',
      created_by: created_by || 'user',
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const condRows = conditions.map((c, i) => ({
    rule_id: rule.id,
    parent_id: c.parent_id ?? null,
    logical_operator: c.logical_operator ?? null,
    field: c.field,
    operator: c.operator,
    value: serializeValue(c.value),
    value_type: c.value_type || 'string',
    display_order: i,
  }));
  if (condRows.length) {
    const { error: condError } = await client.from('rule_conditions').insert(condRows);
    if (condError) throw new Error(condError.message);
  }

  const actRows = actions.map((a, i) => ({ rule_id: rule.id, ...serializeActionValue(a), display_order: i }));
  if (actRows.length) {
    const { error: actError } = await client.from('rule_actions').insert(actRows);
    if (actError) throw new Error(actError.message);
  }

  const { data: conds } = await client.from('rule_conditions').select('*').eq('rule_id', rule.id).order('display_order');
  const { data: acts } = await client.from('rule_actions').select('*').eq('rule_id', rule.id).order('display_order');
  await snapshotVersion(rule.id, 1, rule.name, rule.description, conds || [], acts || [], changeSummary || 'Initial version', input.created_by || 'user', false);

  return fetchRule(rule.id);
}

/**
 * Update a rule: replace conditions/actions, bump the version, keep history.
 */
export async function updateRule(id: number, input: SaveRuleInput): Promise<RuleRow> {
  const client = requireClient();
  const { conditions, actions, changeSummary, modified_by, ...ruleData } = input;

  const { error } = await client
    .from('rules')
    .update({ ...ruleData, modified_by: modified_by || 'user', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await client.from('rule_conditions').delete().eq('rule_id', id);
  await client.from('rule_actions').delete().eq('rule_id', id);

  const condRows = conditions.map((c, i) => ({
    rule_id: id,
    parent_id: c.parent_id ?? null,
    logical_operator: c.logical_operator ?? null,
    field: c.field,
    operator: c.operator,
    value: serializeValue(c.value),
    value_type: c.value_type || 'string',
    display_order: i,
  }));
  if (condRows.length) {
    const { error: condError } = await client.from('rule_conditions').insert(condRows);
    if (condError) throw new Error(condError.message);
  }

  const actRows = actions.map((a, i) => ({ rule_id: id, ...serializeActionValue(a), display_order: i }));
  if (actRows.length) {
    const { error: actError } = await client.from('rule_actions').insert(actRows);
    if (actError) throw new Error(actError.message);
  }

  const { data: conds } = await client.from('rule_conditions').select('*').eq('rule_id', id).order('display_order');
  const { data: acts } = await client.from('rule_actions').select('*').eq('rule_id', id).order('display_order');
  const { data: latest } = await client.from('rule_versions').select('version_number').eq('rule_id', id).order('version_number', { ascending: false }).limit(1);
  const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;
  const { data: ruleMeta } = await client.from('rules').select('name, description').eq('id', id).single();
  await snapshotVersion(id, nextVersion, ruleMeta?.name || input.name, ruleMeta?.description ?? input.description, conds || [], acts || [], changeSummary || 'Rule updated', input.modified_by || 'user', false);

  return fetchRule(id);
}

async function snapshotVersion(
  ruleId: number, versionNumber: number, name: string, description: string | null,
  conditions: any[], actions: any[], changeSummary: string, modifiedBy: string, isRollback: boolean,
) {
  const clean = (rows: any[]) => rows.map((row: any) => {
    const { id, rule_id, created_at, ...rest } = row;
    return rest;
  });
  const { error } = await requireClient().from('rule_versions').insert({
    rule_id: ruleId,
    version_number: versionNumber,
    name,
    description,
    conditions: clean(conditions || []),
    actions: clean(actions || []),
    change_summary: changeSummary,
    modified_by: modifiedBy,
    is_rollback: isRollback,
  });
  if (error) throw new Error(`Version snapshot failed: ${error.message}`);
}

export async function toggleRuleActive(id: number, isActive: boolean, actor?: string): Promise<void> {
  const { error } = await requireClient()
    .from('rules')
    .update({ is_active: isActive, modified_by: actor || 'user', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteRule(id: number): Promise<void> {
  const { error } = await requireClient().from('rules').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function cloneRule(id: number, actor?: string): Promise<RuleRow> {
  const source = await fetchRule(id);
  return createRule({
    name: `${source.name} (Copy)`,
    description: source.description ?? undefined,
    category_id: source.category_id,
    rule_type: source.rule_type,
    is_active: false,
    priority: source.priority,
    execution_mode: source.execution_mode,
    created_by: actor || 'user',
    conditions: (source.rule_conditions || []).map((c) => ({
      parent_id: c.parent_id,
      logical_operator: c.logical_operator,
      field: c.field,
      operator: c.operator,
      value: c.value,
      value_type: c.value_type,
      display_order: c.display_order,
    })),
    actions: (source.rule_actions || []).map((a) => ({
      action_type: a.action_type,
      target_field: a.target_field,
      value: a.value,
      value_type: a.value_type,
      formula: a.formula,
      amount: a.amount,
      percent: a.percent,
      notification_template: a.notification_template,
      notification_recipients: a.notification_recipients,
      display_order: a.display_order,
    })),
    changeSummary: `Cloned from rule #${id} (${source.name})`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Versions
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchVersions(ruleId: number): Promise<RuleVersionRow[]> {
  const { data, error } = await requireClient()
    .from('rule_versions')
    .select('*')
    .eq('rule_id', ruleId)
    .order('version_number', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * One-click rollback: rebuild conditions/actions from a stored version
 * snapshot and record the rollback as a NEW version (history is never lost).
 */
export async function rollbackToVersion(ruleId: number, versionNumber: number, actor?: string): Promise<RuleRow> {
  const client = requireClient();
  const { data: target, error } = await client
    .from('rule_versions')
    .select('*')
    .eq('rule_id', ruleId)
    .eq('version_number', versionNumber)
    .single();
  if (error || !target) throw new Error(`Version ${versionNumber} not found`);

  await client.from('rule_conditions').delete().eq('rule_id', ruleId);
  await client.from('rule_actions').delete().eq('rule_id', ruleId);

  const condRows = (target.conditions || []).map((c: any, i: number) => ({
    rule_id: ruleId,
    logical_operator: c.logical_operator ?? null,
    field: c.field,
    operator: c.operator,
    value: String(c.value ?? ''),
    value_type: c.value_type || 'string',
    display_order: c.display_order ?? i,
  }));
  if (condRows.length) {
    const { error: ce } = await client.from('rule_conditions').insert(condRows);
    if (ce) throw new Error(ce.message);
  }

  const actRows = (target.actions || []).map((a: any, i: number) => ({
    rule_id: ruleId,
    action_type: a.action_type,
    target_field: a.target_field ?? null,
    value: a.value !== undefined && a.value !== null ? String(a.value) : null,
    value_type: a.value_type ?? null,
    formula: a.formula ?? null,
    amount: a.amount ?? null,
    percent: a.percent ?? null,
    notification_template: a.notification_template ?? null,
    notification_recipients: a.notification_recipients ?? null,
    display_order: a.display_order ?? i,
  }));
  if (actRows.length) {
    const { error: ae } = await client.from('rule_actions').insert(actRows);
    if (ae) throw new Error(ae.message);
  }

  await client.from('rules').update({ name: target.name, description: target.description, modified_by: actor || 'user', updated_at: new Date().toISOString() }).eq('id', ruleId);

  const { data: latest } = await client.from('rule_versions').select('version_number').eq('rule_id', ruleId).order('version_number', { ascending: false }).limit(1);
  const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;
  const strip = (rows: any[]) => rows.map((row: any) => {
    const { rule_id, ...rest } = row;
    return rest;
  });
  await snapshotVersion(ruleId, nextVersion, target.name, target.description, strip(condRows), strip(actRows), `Rolled back to version ${versionNumber}`, actor || 'user', true);

  return fetchRule(ruleId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Approvals (maker-checker)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchApprovals(filters?: { status?: string; ruleId?: number }): Promise<Array<RuleApprovalRow & { rules?: { name: string } }>> {
  let query = requireClient().from('rule_approvals').select('*, rules ( name )');
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.ruleId) query = query.eq('rule_id', filters.ruleId);
  const { data, error } = await query.order('requested_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function submitForApproval(input: {
  ruleId: number; requestType: 'create' | 'update' | 'activate' | 'deactivate' | 'delete';
  changeSummary: string; changes?: any; requestedBy?: string; requiredApprovals?: number;
}): Promise<RuleApprovalRow> {
  const { data, error } = await requireClient().from('rule_approvals').insert({
    rule_id: input.ruleId,
    requested_by: input.requestedBy || 'user',
    request_type: input.requestType,
    change_summary: input.changeSummary,
    changes: input.changes ?? null,
    required_approvals: input.requiredApprovals ?? 1,
    approvers: [],
    status: 'pending',
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function decideApproval(id: number, decision: 'approved' | 'rejected', actor?: string, reason?: string, comments?: string): Promise<void> {
  const { error } = await requireClient().from('rule_approvals').update({
    status: decision,
    approved_by: actor || 'user',
    approved_at: new Date().toISOString(),
    rejection_reason: decision === 'rejected' ? (reason || 'No reason provided') : null,
    approvals: { decision, comments: comments || '', at: new Date().toISOString() },
  }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution logs
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchLogs(filters?: {
  ruleId?: number; employeeId?: number; status?: string; dateFrom?: string; dateTo?: string;
  page?: number; limit?: number;
}): Promise<{ logs: Array<RuleLogRow & { rules?: { name: string; rule_type: string } }>; total: number }> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  let query = requireClient()
    .from('rule_execution_logs')
    .select('*, rules ( name, rule_type )', { count: 'exact' });
  if (filters?.ruleId) query = query.eq('rule_id', filters.ruleId);
  if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.dateFrom) query = query.gte('executed_at', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('executed_at', filters.dateTo);
  const { data, error, count } = await query
    .order('executed_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) throw new Error(error.message);
  return { logs: (data || []) as any, total: count ?? 0 };
}

export interface ExecutionLogEntry {
  ruleId: number; ruleName: string; employeeId?: number | null; employeeName?: string | null;
  durationMs: number; status: 'success' | 'failed' | 'partial' | 'skipped';
  trigger: 'manual' | 'scheduled' | 'api' | 'batch_job';
  input: RuleContext; output: any; matchedConditions?: any; executedActions?: any;
  error?: string | null; executedBy?: string; batchId?: string;
}

export async function insertExecutionLogs(entries: ExecutionLogEntry[]): Promise<void> {
  if (!entries.length) return;
  const rows = entries.map((e) => ({
    rule_id: e.ruleId,
    employee_id: e.employeeId ?? null,
    employee_name: e.employeeName ?? null,
    entity_type: e.employeeId ? 'employee' : null,
    entity_id: e.employeeId ?? null,
    execution_duration: Math.round(e.durationMs),
    trigger_source: e.trigger,
    input_data: e.input,
    output_data: e.output,
    matched_conditions: e.matchedConditions ?? null,
    executed_actions: e.executedActions ?? null,
    status: e.status,
    error_message: e.error ?? null,
    executed_by: e.executedBy || 'user',
    batch_id: e.batchId ?? null,
  }));
  const { error } = await requireClient().from('rule_execution_logs').insert(rows);
  if (error) throw new Error(error.message);
}

export function batchResultToLogEntries(
  batch: BatchEvalResult,
  meta: { employeeId?: number | null; employeeName?: string | null; context: RuleContext; trigger?: 'manual' | 'batch_job'; executedBy?: string; batchId?: string },
): ExecutionLogEntry[] {
  return batch.results.map((r) => ({
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    employeeId: meta.employeeId ?? null,
    employeeName: meta.employeeName ?? null,
    durationMs: r.executionTimeMs,
    status: (r.error ? 'failed' : r.matched ? 'success' : 'skipped') as 'success' | 'failed' | 'skipped',
    trigger: meta.trigger || 'manual',
    input: meta.context,
    output: { matched: r.matched, outputPatch: r.outputPatch },
    matchedConditions: r.conditionTraces,
    executedActions: r.executedActions,
    error: r.error ?? null,
    executedBy: meta.executedBy,
    batchId: meta.batchId,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIs & analytics
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleKpis {
  totalRules: number;
  activeRules: number;
  inactiveRules: number;
  executedToday: number;
  failedToday: number;
  pendingApprovals: number;
}

export async function fetchKpis(): Promise<RuleKpis> {
  const client = requireClient();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const iso = startOfDay.toISOString();

  const [rules, active, executedToday, failedToday, pending] = await Promise.all([
    client.from('rules').select('id', { count: 'exact', head: true }),
    client.from('rules').select('id', { count: 'exact', head: true }).eq('is_active', true),
    client.from('rule_execution_logs').select('id', { count: 'exact', head: true }).gte('executed_at', iso),
    client.from('rule_execution_logs').select('id', { count: 'exact', head: true }).gte('executed_at', iso).eq('status', 'failed'),
    client.from('rule_approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  const err = rules.error || active.error || executedToday.error || failedToday.error || pending.error;
  if (err) throw new Error(err.message);
  const totalRules = rules.count ?? 0;
  const activeRules = active.count ?? 0;
  return {
    totalRules,
    activeRules,
    inactiveRules: totalRules - activeRules,
    executedToday: executedToday.count ?? 0,
    failedToday: failedToday.count ?? 0,
    pendingApprovals: pending.count ?? 0,
  };
}

export interface RuleAnalytics {
  executionsByDay: Array<{ date: string; total: number; failed: number }>;
  topRules: Array<{ ruleId: number; ruleName: string; count: number; failed: number }>;
  topCategories: Array<{ categoryId: number; categoryName: string; ruleCount: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
  avgExecutionMs: number;
}

export async function fetchAnalytics(days = 30): Promise<RuleAnalytics> {
  const client = requireClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [logsRes, rulesRes, catsRes] = await Promise.all([
    client.from('rule_execution_logs').select('rule_id, status, executed_at, execution_duration').gte('executed_at', since).order('executed_at').limit(10000),
    client.from('rules').select('id, name, category_id, is_active'),
    client.from('rule_categories').select('id, name'),
  ]);
  const logsError = logsRes.error || rulesRes.error || catsRes.error;
  if (logsError) throw new Error(logsError.message);

  const logs = (logsRes.data || []) as any[];
  const rules = (rulesRes.data || []) as any[];
  const catName = new Map((catsRes.data || []).map((c: any) => [c.id, c.name]));
  const ruleName = new Map(rules.map((r: any) => [r.id, r.name]));

  const byDay = new Map<string, { total: number; failed: number }>();
  for (const log of logs) {
    const day = String(log.executed_at).slice(0, 10);
    const entry = byDay.get(day) || { total: 0, failed: 0 };
    entry.total += 1;
    if (log.status === 'failed') entry.failed += 1;
    byDay.set(day, entry);
  }

  const byRule = new Map<number, { count: number; failed: number }>();
  for (const log of logs) {
    const entry = byRule.get(log.rule_id) || { count: 0, failed: 0 };
    entry.count += 1;
    if (log.status === 'failed') entry.failed += 1;
    byRule.set(log.rule_id, entry);
  }
  const topRules = [...byRule.entries()]
    .map(([ruleId, v]) => ({ ruleId, ruleName: ruleName.get(ruleId) || `Rule #${ruleId}`, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const catCount = new Map<number, number>();
  for (const r of rules) catCount.set(r.category_id, (catCount.get(r.category_id) || 0) + 1);
  const topCategories = [...catCount.entries()]
    .map(([categoryId, ruleCount]) => ({ categoryId, categoryName: catName.get(categoryId) || `#${categoryId}`, ruleCount }))
    .sort((a, b) => b.ruleCount - a.ruleCount);

  const statusCount = new Map<string, number>();
  for (const log of logs) statusCount.set(log.status, (statusCount.get(log.status) || 0) + 1);

  const durations = logs.map((l) => Number(l.execution_duration || 0)).filter((n) => n > 0);
  const avgExecutionMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  return {
    executionsByDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    topRules,
    topCategories,
    statusBreakdown: [...statusCount.entries()].map(([status, count]) => ({ status, count })),
    avgExecutionMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Rule Generation (Gemini via Edge Function)
// ─────────────────────────────────────────────────────────────────────────────

export interface AiClarifyQuestion { id: string; question: string; type: string; options?: string[] }
export interface AiGeneratedRule {
  name: string; description?: string; ruleType: string; priority?: number; executionMode?: 'sync' | 'async';
  conditions: Array<{ field: string; operator: string; value: any; valueType: string; logicalOperator?: 'AND' | 'OR' }>;
  actions: Array<Record<string, any>>;
  explanation?: string;
}

export async function generateRuleWithAI(instruction: string, answers?: Record<string, string> | null): Promise<
  { status: 'complete'; rule: AiGeneratedRule } | { status: 'clarify'; questions: AiClarifyQuestion[] }
> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('rules-engine-ai', { body: { instruction, answers: answers ?? undefined } });
  if (error) {
    // Surface the server's own message (FunctionsError keeps the response
    // body in `context`) instead of always showing a generic deploy hint.
    // The hint is only appropriate when the function genuinely does not exist.
    const detail: any = (error as any)?.context;
    const serverMessage =
      detail && typeof detail === 'object' && typeof detail.error === 'string'
        ? detail.error
        : typeof detail === 'string' && detail.trim()
          ? detail.trim().slice(0, 300)
          : '';
    const isMissing = /not found|404|failed to fetch|network/i.test(error.message);
    throw new Error(
      serverMessage
        ? `AI generator error: ${serverMessage}`
        : isMissing
          ? `AI generator unavailable (${error.message}). Deploy the edge function: supabase functions deploy rules-engine-ai`
          : `AI generator unavailable (${error.message})`,
    );
  }
  if (!data || typeof data !== 'object') throw new Error('AI generator returned an unexpected response');
  if (data.status === 'clarify') return { status: 'clarify', questions: data.questions };
  if (data.status === 'complete') return { status: 'complete', rule: data.rule };
  throw new Error(data.error || 'AI generator failed');
}

export async function fetchAiHistory(limit = 20): Promise<any[]> {
  const { data, error } = await requireClient()
    .from('ai_rule_generation_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Import / Export
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportedRule {
  name: string;
  description: string | null;
  category: string;
  ruleType: string;
  priority: number;
  executionMode: string;
  isActive: boolean;
  conditions: any[];
  actions: any[];
}

export async function exportRules(ruleIds?: number[]): Promise<ExportedRule[]> {
  const rules = await fetchRules();
  const selected = ruleIds?.length ? rules.filter((r) => ruleIds.includes(r.id)) : rules;
  return selected.map((r) => ({
    name: r.name,
    description: r.description,
    category: r.rule_categories?.name || '',
    ruleType: r.rule_type,
    priority: r.priority,
    executionMode: r.execution_mode,
    isActive: r.is_active,
    conditions: (r.rule_conditions || []).map((c: any) => {
      const { id, rule_id, ...rest } = c; return rest;
    }),
    actions: (r.rule_actions || []).map((a: any) => {
      const { id, rule_id, ...rest } = a; return rest;
    }),
  }));
}

export async function importRules(
  imported: ExportedRule[],
  options?: { overwrite?: boolean },
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const categories = await fetchCategories();
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const existing = await fetchRules();
  const existingByName = new Map(existing.map((r) => [r.name.toLowerCase(), r]));

  let importedCount = 0;
  const errors: string[] = [];
  const skipped: string[] = [];

  for (const item of imported) {
    try {
      const categoryId = catByName.get(String(item.category || '').toLowerCase());
      if (!categoryId) { errors.push(`${item.name}: unknown category "${item.category}"`); continue; }
      const conditions = (item.conditions || []).map((c: any, i: number) => ({
        logical_operator: c.logicalOperator ?? c.logical_operator ?? null,
        field: c.field,
        operator: c.operator,
        value: String(c.value ?? ''),
        value_type: c.valueType ?? c.value_type ?? 'string',
        display_order: c.display_order ?? i,
      }));
      const actions = (item.actions || []).map((a: any, i: number) => ({
        action_type: a.actionType ?? a.action_type,
        target_field: a.targetField ?? a.target_field ?? null,
        value: a.value !== undefined && a.value !== null ? String(a.value) : null,
        value_type: a.valueType ?? a.value_type ?? null,
        formula: a.formula ?? null,
        amount: a.amount ?? null,
        percent: a.percent ?? null,
        notification_template: a.notificationTemplate ?? a.notification_template ?? null,
        notification_recipients: a.notificationRecipients ?? a.notification_recipients ?? null,
        display_order: a.display_order ?? i,
      }));

      const clash = existingByName.get(item.name.toLowerCase());
      if (clash && !options?.overwrite) { skipped.push(item.name); continue; }

      const payload: SaveRuleInput = {
        name: item.name,
        description: item.description ?? undefined,
        category_id: categoryId,
        rule_type: item.ruleType || 'custom',
        is_active: item.isActive ?? false,
        priority: item.priority ?? 10,
        execution_mode: item.executionMode === 'async' ? 'async' : 'sync',
        conditions,
        actions,
        changeSummary: clash ? `Imported (overwrote "${item.name}")` : 'Imported',
      };
      if (clash) await updateRule(clash.id, payload);
      else await createRule(payload);

      importedCount += 1;
    } catch (e) {
      errors.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { imported: importedCount, skipped: skipped.length, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

export interface RulePermissionRow {
  id: number; rule_id: number; role: string; permissions: string[]; granted_by: string; granted_at: string;
}

export async function fetchRulePermissions(ruleId?: number): Promise<RulePermissionRow[]> {
  let query = requireClient().from('rule_permissions').select('*');
  if (ruleId) query = query.eq('rule_id', ruleId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function upsertRulePermission(input: { rule_id: number; role: string; permissions: string[]; granted_by?: string }): Promise<void> {
  const client = requireClient();
  const existing = await client.from('rule_permissions').select('id').eq('rule_id', input.rule_id).eq('role', input.role).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const { error } = await client.from('rule_permissions').update({ permissions: input.permissions }).eq('id', existing.data.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client.from('rule_permissions').insert({ ...input, granted_by: input.granted_by || 'admin' });
    if (error) throw new Error(error.message);
  }
}