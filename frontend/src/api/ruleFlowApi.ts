/**
 * Rule Flow API — helpers for the Rule Execution Flow board and the All Rules
 * management panel.
 *
 * Kept separate from rulesEngine.ts so the flow features can evolve
 * independently: priority-only persistence (drag-and-drop reordering) and
 * per-rule execution statistics aggregated from rule_execution_logs.
 */

import { supabase } from '../lib/supabase';
import type { RuleRow } from './rulesEngine';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured. Check .env (SUPABASE_URL / SUPABASE_ANON_KEY).');
  return supabase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority persistence (drag-and-drop reorder)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight priority-only update used by the Rule Execution Flow board when
 * admins drag-and-drop reorder rules. Intentionally skips the full
 * conditions/actions rebuild + version snapshot of `updateRule` so reordering
 * stays fast and doesn't pollute version history.
 */
export async function updateRulePriority(id: number, priority: number, actor?: string): Promise<void> {
  const { error } = await requireClient()
    .from('rules')
    .update({ priority, modified_by: actor || 'user', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Persist a full execution order in one call (priority = position). */
export async function saveRulePriorities(orderedRules: Array<{ id: number; priority: number }>, actor?: string): Promise<void> {
  const client = requireClient();
  const updates = orderedRules.map((r) =>
    client
      .from('rules')
      .update({ priority: r.priority, modified_by: actor || 'user', updated_at: new Date().toISOString() })
      .eq('id', r.id),
  );
  const results = await Promise.allSettled(updates.map((u) => u));
  const firstError = results.find((r) => r.status === 'rejected');
  if (firstError && firstError.status === 'rejected') {
    throw new Error(String((firstError.reason as any)?.message ?? 'Failed to save priorities'));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-rule execution statistics (Rule Execution Flow + All Rules panel)
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleStat {
  count: number;
  success: number;
  failed: number;
  lastExecutedAt: string | null;
  lastStatus: string | null;
  avgDurationMs: number;
  executedToday: number;
}

export interface RuleStatsSummary {
  byRule: Record<number, RuleStat>;
  avgExecutionMs: number;
  executedToday: number;
  total30d: number;
}

/**
 * Aggregates the last 30 days of execution logs into per-rule statistics
 * (execution count, success rate, last run, average duration) plus global
 * summary numbers used by the Rule Execution Flow section. One query, all
 * computed client-side so the UI stays in sync with a single cache entry.
 */
export async function fetchRuleStats(): Promise<RuleStatsSummary> {
  const client = requireClient();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const todayIso = startToday.toISOString();

  const { data, error } = await client
    .from('rule_execution_logs')
    .select('rule_id, status, executed_at, execution_duration')
    .gte('executed_at', since)
    .order('executed_at', { ascending: false })
    .limit(20000);
  if (error) throw new Error(error.message);

  const byRule: Record<number, RuleStat> = {};
  const durationsByRule = new Map<number, { sum: number; n: number }>();
  let globalDurSum = 0;
  let globalDurCount = 0;
  let executedToday = 0;

  for (const log of (data || []) as any[]) {
    const stat = byRule[log.rule_id] ?? {
      count: 0, success: 0, failed: 0,
      lastExecutedAt: null as string | null,
      lastStatus: null as string | null,
      avgDurationMs: 0, executedToday: 0,
    };
    stat.count += 1;
    if (log.status === 'success') stat.success += 1;
    if (log.status === 'failed') stat.failed += 1;
    // rows are ordered desc, so the first row seen is the latest execution
    if (!stat.lastExecutedAt) {
      stat.lastExecutedAt = log.executed_at;
      stat.lastStatus = log.status;
    }
    if (log.executed_at >= todayIso) {
      stat.executedToday += 1;
      executedToday += 1;
    }
    byRule[log.rule_id] = stat;

    const dur = Number(log.execution_duration || 0);
    if (dur > 0) {
      globalDurSum += dur;
      globalDurCount += 1;
      const d = durationsByRule.get(log.rule_id) ?? { sum: 0, n: 0 };
      d.sum += dur;
      d.n += 1;
      durationsByRule.set(log.rule_id, d);
    }
  }

  for (const [ruleId, d] of durationsByRule) {
    const stat = byRule[ruleId];
    if (stat) stat.avgDurationMs = Math.round(d.sum / d.n);
  }

  return {
    byRule,
    avgExecutionMs: globalDurCount ? Math.round(globalDurSum / globalDurCount) : 0,
    executedToday,
    total30d: (data || []).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow card helpers
// ─────────────────────────────────────────────────────────────────────────────

export type FlowStatus = 'active' | 'inactive' | 'pending' | 'scheduled';

export interface FlowRule {
  rule: RuleRow;
  position: number;          // 1-based position in the execution order
  status: FlowStatus;        // Active / Inactive / Pending / Scheduled
  stat?: RuleStat;
}

/**
 * Build the execution flow from live rules + stats.
 *
 * The engine evaluates rules by priority DESC (highest priority first), so the
 * visual flow is ordered the same way: position 1 = highest priority.
 * Status mapping: active → Active, inactive → Inactive; rules with a recent
 * failed execution are surfaced as Pending review, async rules render as
 * Scheduled (they run in the background queue).
 */
export function buildExecutionFlow(rules: RuleRow[], stats?: RuleStatsSummary | null): FlowRule[] {
  const ordered = [...rules].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  return ordered.map((rule, idx) => {
    const stat = stats?.byRule[rule.id];
    let status: FlowStatus = rule.is_active ? 'active' : 'inactive';
    if (rule.is_active && stat?.lastStatus === 'failed') status = 'pending';
    else if (rule.is_active && rule.execution_mode === 'async') status = 'scheduled';
    return { rule, position: idx + 1, status, stat };
  });
}