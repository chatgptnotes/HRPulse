/**
 * Rule Management — three-panel workspace.
 *
 * Left   : rule list with search / category / status / priority filters and
 *          quick actions (toggle, edit, clone, delete).
 * Center : Visual Rule Builder — IF / AND / OR condition rows and THEN action
 *          rows, no coding required. Supports unlimited conditions, nested
 *          AND/OR groups, action groups, priority, execution mode.
 * Right  : AI Rule Generator (Gemini), Testing Sandbox, Suggestions and
 *          live Validation results.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  fetchRules, fetchCategories, createRule, updateRule, toggleRuleActive, deleteRule, cloneRule,
  type RuleRow, type SaveRuleInput,
} from '../../api/rulesEngine';
import { fetchRuleStats } from '../../api/ruleFlowApi';
import {
  OPERATORS, VALUE_TYPES, CONDITION_FIELDS, FIELD_GROUPS, fieldDef, valueInputKind,
  ACTION_TYPES, ACTION_TARGET_FIELDS, NOTIFICATION_RECIPIENTS, RULE_TYPES, RULE_TEMPLATES,
  type BuilderCondition, type BuilderAction,
} from '../../lib/ruleFields';
import { validateRuleDraft, type ValidationIssue } from '../../lib/ruleEvaluator';
import { useAuth } from '../../auth/AuthContext';
import AiGeneratorPanel from './AiGeneratorPanel';
import SandboxPanel from './SandboxPanel';
import AllRulesPanel from './AllRulesPanel';
import RuleExecutionFlow from './RuleExecutionFlow';

let uid = 0;
const nextKey = () => `k${++uid}`;

// ─────────────────────────────────────────────────────────────────────────────
// Draft state shapes
// ─────────────────────────────────────────────────────────────────────────────

interface RuleDraft {
  id: number | null;
  name: string;
  description: string;
  categoryId: number | null;
  ruleType: string;
  priority: number;
  executionMode: 'sync' | 'async';
  isActive: boolean;
  conditions: BuilderCondition[];
  actions: BuilderAction[];
  changeSummary: string;
}

const emptyDraft = (): RuleDraft => ({
  id: null,
  name: '',
  description: '',
  categoryId: null,
  ruleType: 'attendance',
  priority: 10,
  executionMode: 'sync',
  isActive: false,
  conditions: [{ key: nextKey(), logicalOperator: null, field: '', operator: 'eq', value: '', valueType: 'string' }],
  actions: [{ key: nextKey(), actionType: 'set', targetField: 'attendance.status', value: '' }],
  changeSummary: '',
});

function ruleToDraft(rule: RuleRow): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? '',
    categoryId: rule.category_id,
    ruleType: rule.rule_type,
    priority: rule.priority,
    executionMode: rule.execution_mode,
    isActive: rule.is_active,
    conditions: (rule.rule_conditions || []).map((c) => ({
      key: nextKey(),
      logicalOperator: c.logical_operator,
      field: c.field,
      operator: c.operator as any,
      value: String(c.value ?? '').replace(/^"(.*)"$/, '$1'),
      valueType: (c.value_type as any) || 'string',
    })),
    actions: (rule.rule_actions || []).map((a) => ({
      key: nextKey(),
      actionType: a.action_type as any,
      targetField: a.target_field ?? undefined,
      value: a.value !== undefined && a.value !== null ? String(a.value).replace(/^"(.*)"$/, '$1') : undefined,
      amount: a.amount !== undefined && a.amount !== null ? Number(a.amount) : undefined,
      percent: a.percent !== undefined && a.percent !== null ? Number(a.percent) : undefined,
      formula: a.formula ?? undefined,
      notificationTemplate: a.notification_template ?? undefined,
      notificationRecipients: a.notification_recipients ?? undefined,
    })),
    changeSummary: '',
  };
}

function draftToSaveInput(d: RuleDraft, actor: string): SaveRuleInput {
  return {
    name: d.name,
    description: d.description || undefined,
    category_id: d.categoryId ?? 0,
    rule_type: d.ruleType,
    is_active: d.isActive,
    priority: d.priority,
    execution_mode: d.executionMode,
    modified_by: actor,
    created_by: actor,
    conditions: d.conditions.map((c) => ({
      logical_operator: c.logicalOperator ?? null,
      field: c.field,
      operator: c.operator,
      value: c.value,
      value_type: c.valueType,
    })),
    actions: d.actions.map((a) => ({
      action_type: a.actionType,
      target_field: a.targetField ?? null,
      value: a.value ?? null,
      amount: a.amount ?? null,
      percent: a.percent ?? null,
      formula: a.formula ?? null,
      notification_template: a.notificationTemplate ?? null,
      notification_recipients: a.notificationRecipients ?? null,
    })),
    changeSummary: d.changeSummary || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small UI atoms
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500/40 bg-white';

function FieldSelect({ groups, value, onChange, placeholder }: { groups: string[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {CONDITION_FIELDS.filter((f) => f.group === g).map((f) => (
            <option key={f.path} value={f.path}>{f.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ValueInput({ cond, onChange }: { cond: BuilderCondition; onChange: (patch: Partial<BuilderCondition>) => void }) {
  const kind = valueInputKind(cond.field, cond.operator, cond.valueType);
  const def = fieldDef(cond.field);

  if (kind === 'boolean') {
    return (
      <select value={cond.value} onChange={(e) => onChange({ value: e.target.value })} className={inputCls}>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }
  if (kind === 'list') {
    return (
      <input
        type="text"
        value={cond.value}
        onChange={(e) => onChange({ value: e.target.value })}
        placeholder="a, b, c  (comma separated)"
        className={clsx(inputCls, 'font-mono text-sm')}
      />
    );
  }
  // Enum options (Day of Week, Status…) render a dropdown unless the operator
  // is a text search.
  if (def?.options && ['eq', 'ne', 'in', 'notIn'].includes(cond.operator)) {
    return (
      <select value={cond.value} onChange={(e) => onChange({ value: e.target.value })} className={inputCls}>
        <option value="">Select…</option>
        {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
      value={cond.value}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder={kind === 'number' ? '0' : 'Value'}
      className={inputCls}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────

export default function RuleManagementTab({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const actor = user?.email || 'user';

  // Draft / selection
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RuleRow | null>(null);
  const [saveError, setSaveError] = useState('');
  const [toast, setToast] = useState('');

  const { data: categories = [] } = useQuery({ queryKey: ['rules-engine', 'categories'], queryFn: fetchCategories });
  // Fetch every rule once — the All Rules panel filters client-side so the
  // Rule Execution Flow below always sees the complete pipeline.
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['rules-engine', 'rules', 'all'],
    queryFn: () => fetchRules(),
  });
  const { data: ruleStats = null } = useQuery({
    queryKey: ['rules-engine', 'rule-stats'],
    queryFn: fetchRuleStats,
  });

  const bulkToggleMutation = useMutation({
    mutationFn: async ({ ids, active }: { ids: number[]; active: boolean }) => {
      await Promise.all(ids.map((id) => toggleRuleActive(id, active, actor)));
    },
    onSuccess: (_d, vars) => {
      refreshAll();
      setToast(vars.ids.length + ' rule' + (vars.ids.length > 1 ? 's' : '') + ' ' + (vars.active ? 'activated' : 'deactivated'));
      setTimeout(() => setToast(''), 3000);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => deleteRule(id)));
    },
    onSuccess: (_d, ids) => {
      refreshAll();
      if (draft?.id !== null && ids.includes(draft?.id ?? -1)) setDraft(null);
      setToast(ids.length + ' rule' + (ids.length > 1 ? 's' : '') + ' deleted');
      setTimeout(() => setToast(''), 3000);
    },
  });

  const refreshAll = () => { qc.invalidateQueries({ queryKey: ['rules-engine'] }); onChanged?.(); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('No rule open');
      const input = draftToSaveInput(draft, actor);
      return draft.id ? updateRule(draft.id, input) : createRule(input);
    },
    onSuccess: (_data, _vars, ctx) => {
      const wasCreate = !draft?.id;
      refreshAll();
      setDraft(null);
      setSaveError('');
      setToast(wasCreate ? 'Rule created — version 1 saved' : 'Rule updated — new version saved');
      setTimeout(() => setToast(''), 3500);
    },
    onError: (e) => setSaveError(e instanceof Error ? e.message : String(e)),
  });

  const toggleMutation = useMutation({
    mutationFn: (r: RuleRow) => toggleRuleActive(r.id, !r.is_active, actor),
    onSuccess: refreshAll,
  });

  const cloneMutation = useMutation({
    mutationFn: (r: RuleRow) => cloneRule(r.id, actor),
    onSuccess: () => { refreshAll(); setToast('Rule cloned (inactive copy)'); setTimeout(() => setToast(''), 3000); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRule(id),
    onSuccess: () => { refreshAll(); setDeleteTarget(null); if (draft?.id === deleteTarget?.id) setDraft(null); },
  });

  const issues: ValidationIssue[] = draft ? validateRuleDraft({ name: draft.name, categoryId: draft.categoryId, conditions: draft.conditions, actions: draft.actions }) : [];
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  // ─── Draft helpers ──────────────────────────────────────────────────────────
  const patchDraft = (patch: Partial<RuleDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const addCondition = () => setDraft((d) => d ? {
    ...d,
    conditions: [...d.conditions, { key: nextKey(), logicalOperator: 'AND', field: '', operator: 'eq', value: '', valueType: 'string' }],
  } : d);

  const updateCondition = (key: string, patch: Partial<BuilderCondition>) => setDraft((d) => d ? {
    ...d,
    conditions: d.conditions.map((c) => {
      if (c.key !== key) return c;
      const next = { ...c, ...patch };
      // When field changes, align the value type with the field definition.
      if (patch.field !== undefined) {
        const def = fieldDef(patch.field);
        if (def) next.valueType = def.type as any;
        next.value = '';
      }
      return next;
    }),
  } : d);

  const removeCondition = (key: string) => setDraft((d) => {
    if (!d) return d;
    const conditions = d.conditions.filter((c) => c.key !== key);
    if (conditions.length) conditions[0].logicalOperator = null;
    return { ...d, conditions };
  });

  const addAction = () => setDraft((d) => d ? { ...d, actions: [...d.actions, { key: nextKey(), actionType: 'set', targetField: 'attendance.status', value: '' }] } : d);
  const updateAction = (key: string, patch: Partial<BuilderAction>) => setDraft((d) => d ? { ...d, actions: d.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)) } : d);
  const removeAction = (key: string) => setDraft((d) => d ? { ...d, actions: d.actions.filter((a) => a.key !== key) } : d);

  const applyTemplate = (t: (typeof RULE_TEMPLATES)[number]) => setDraft({
    ...emptyDraft(),
    name: t.name,
    description: t.description,
    ruleType: t.ruleType,
    priority: t.priority,
    categoryId: categories.find((c) => (t.ruleType === 'attendance' && c.name === 'Attendance') || (t.ruleType === 'payroll' && c.name === 'Payroll') || (t.ruleType === 'notification' && c.name === 'Notifications'))?.id ?? categories[0]?.id ?? null,
    conditions: t.conditions.map((c) => ({ ...c, key: nextKey() })),
    actions: t.actions.map((a) => ({ ...a, key: nextKey() })),
  });

  const openNew = () => setDraft({ ...emptyDraft(), categoryId: categories[0]?.id ?? null });
  const openEdit = (r: RuleRow) => { setDraft(ruleToDraft(r)); setSaveError(''); };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="relative">
      {toast && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm shadow-lg">
          <span className="material-icons text-xl">check_circle</span>{toast}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[400px_minmax(0,1fr)_380px] gap-4 lg:gap-5">
        {/* ══════════ LEFT PANEL — All Rules management ══════════ */}
        <AllRulesPanel
          rules={rules}
          isLoading={isLoading}
          stats={ruleStats}
          selectedRuleId={draft?.id ?? null}
          onCreateRule={openNew}
          onEditRule={openEdit}
          onCloneRule={(r) => cloneMutation.mutate(r)}
          onTestRule={openEdit}
          onToggleRule={(r) => toggleMutation.mutate(r)}
          onDeleteRule={(r) => setDeleteTarget(r)}
          onBulkActivate={(ids) => bulkToggleMutation.mutate({ ids, active: true })}
          onBulkDeactivate={(ids) => bulkToggleMutation.mutate({ ids, active: false })}
          onBulkDelete={(ids) => bulkDeleteMutation.mutate(ids)}
          bulkPending={bulkToggleMutation.isPending || bulkDeleteMutation.isPending}
        />

        {/* ══════════ CENTER — Visual Rule Builder ══════════ */}
        <div className="rounded-2xl border border-slate-200 bg-white flex flex-col overflow-hidden">
          {!draft ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center mb-4">
                <span className="material-icons text-purple-500 text-3xl">account_tree</span>
              </div>
              <h3 className="text-xl font-semibold text-slate-800">Visual Rule Builder</h3>
              <p className="text-sm sm:text-base text-slate-500 mt-2 max-w-md leading-relaxed">
                Create business rules with IF / AND / OR / THEN blocks — no coding required.
                Pick a rule on the left to edit, start from a template, or ask the AI generator on the right.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl w-full">
                {RULE_TEMPLATES.map((t) => (
                  <button key={t.name} onClick={() => applyTemplate(t)} className="text-left p-3.5 rounded-xl border border-slate-200 hover:border-purple-400 hover:bg-purple-50/40 transition-colors">
                    <p className="text-sm font-semibold text-slate-800 line-clamp-2">{t.name}</p>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{t.description}</p>
                  </button>
                ))}
              </div>
              <button onClick={openNew} className="mt-6 flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-sm font-medium hover:shadow-lg transition-shadow">
                <span className="material-icons text-xl">add</span>Build a rule from scratch
              </button>
            </div>
          ) : (
            <>
              {/* Builder header */}
              <div className="p-4 border-b border-slate-100 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={clsx('px-2.5 py-1 rounded-md text-xs font-bold shrink-0', draft.id ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700')}>
                      {draft.id ? `EDITING #${draft.id}` : 'NEW RULE'}
                    </span>
                    <input
                      value={draft.name}
                      onChange={(e) => patchDraft({ name: e.target.value })}
                      placeholder="Rule name, e.g. Half Day — Working Hours Below 4"
                      className="flex-1 min-w-[200px] border-none text-base sm:text-lg font-semibold text-slate-800 focus:outline-none focus:ring-0 bg-transparent placeholder:text-slate-300"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Close</button>
                    <button
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending || errorCount > 0}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-sm font-medium hover:shadow-lg transition-shadow disabled:opacity-50"
                    >
                      {saveMutation.isPending ? 'Saving…' : draft.id ? 'Save new version' : 'Create rule'}
                    </button>
                  </div>
                </div>
                <input
                  value={draft.description}
                  onChange={(e) => patchDraft({ description: e.target.value })}
                  placeholder="Description (what does this rule do?)"
                  className={inputCls}
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</span>
                    <select value={draft.categoryId ?? ''} onChange={(e) => patchDraft({ categoryId: Number(e.target.value) })} className={clsx(inputCls, 'py-2 text-sm mt-1')}>
                      <option value="">Select…</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</span>
                    <select value={draft.ruleType} onChange={(e) => patchDraft({ ruleType: e.target.value })} className={clsx(inputCls, 'py-2 text-sm mt-1')}>
                      {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Priority</span>
                    <input type="number" min={0} max={100} value={draft.priority} onChange={(e) => patchDraft({ priority: Number(e.target.value) || 0 })} className={clsx(inputCls, 'py-2 text-sm mt-1')} />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Execution</span>
                    <select value={draft.executionMode} onChange={(e) => patchDraft({ executionMode: e.target.value as 'sync' | 'async' })} className={clsx(inputCls, 'py-2 text-sm mt-1')}>
                      <option value="sync">Synchronous</option>
                      <option value="async">Asynchronous</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-2 pb-2.5 cursor-pointer">
                    <input type="checkbox" checked={draft.isActive} onChange={(e) => patchDraft({ isActive: e.target.checked })} className="h-4 w-4 accent-purple-600" />
                    <span className="text-sm font-medium text-slate-700">Active</span>
                  </label>
                </div>
                {draft.id && (
                  <input
                    value={draft.changeSummary}
                    onChange={(e) => patchDraft({ changeSummary: e.target.value })}
                    placeholder="Change summary for this version (optional)"
                    className={inputCls}
                  />
                )}
                {saveError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3.5 py-2.5">{saveError}</p>}
              </div>

              {/* Builder body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-5 max-h-none xl:max-h-[62vh]">
                {/* ─── CONDITIONS ─── */}
                <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="flex flex-wrap items-center gap-2 text-sm sm:text-base font-bold text-blue-900">
                      <span className="px-2.5 py-0.5 rounded-md bg-blue-600 text-white text-xs font-bold">IF</span>
                      Conditions
                      <span className="text-xs font-normal text-blue-400">all / any rows must match per connector</span>
                    </h4>
                    <button onClick={addCondition} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 shrink-0">
                      <span className="material-icons text-base">add</span>Condition
                    </button>
                  </div>
                  <div className="space-y-2.5">
                    {draft.conditions.map((c, i) => (
                      <div key={c.key} className="flex flex-wrap items-center gap-2">
                        {i === 0 ? (
                          <span className="w-12 text-xs font-bold text-blue-700 text-center">IF</span>
                        ) : (
                          <select
                            value={c.logicalOperator ?? 'AND'}
                            onChange={(e) => updateCondition(c.key, { logicalOperator: e.target.value as 'AND' | 'OR' })}
                            className={clsx(
                              'w-20 border-none rounded-md px-2 py-1.5 text-xs font-bold cursor-pointer',
                              (c.logicalOperator ?? 'AND') === 'AND' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                            )}
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        )}
                        <div className="flex-1 min-w-[180px]"><FieldSelect groups={FIELD_GROUPS} value={c.field} onChange={(v) => updateCondition(c.key, { field: v })} placeholder="Select field…" /></div>
                        <select value={c.operator} onChange={(e) => updateCondition(c.key, { operator: e.target.value as any })} className={clsx(inputCls, 'w-[150px] py-2 text-sm')}>
                          {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <div className="flex-1 min-w-[140px]"><ValueInput cond={c} onChange={(patch) => updateCondition(c.key, patch)} /></div>
                        <select value={c.valueType} onChange={(e) => updateCondition(c.key, { valueType: e.target.value as any })} className={clsx(inputCls, 'w-[100px] py-2 text-xs')} title="Value type">
                          {VALUE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                        </select>
                        <button onClick={() => removeCondition(c.key)} disabled={draft.conditions.length === 1} className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30" title="Remove condition">
                          <span className="material-icons text-xl">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ─── ACTIONS ─── */}
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="flex flex-wrap items-center gap-2 text-sm sm:text-base font-bold text-emerald-900">
                      <span className="px-2.5 py-0.5 rounded-md bg-emerald-600 text-white text-xs font-bold">THEN</span>
                      Actions
                      <span className="text-xs font-normal text-emerald-500">executed in order when all conditions match</span>
                    </h4>
                    <button onClick={addAction} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shrink-0">
                      <span className="material-icons text-base">add</span>Action
                    </button>
                  </div>
                  <div className="space-y-2.5">
                    {draft.actions.map((a, i) => (
                      <div key={a.key} className="flex flex-wrap items-center gap-2 bg-white rounded-lg p-2.5 border border-emerald-100/60">
                        <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                        <select value={a.actionType} onChange={(e) => updateAction(a.key, { actionType: e.target.value as any })} className={clsx(inputCls, 'w-[170px] py-2 text-sm')}>
                          {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>

                        {a.actionType === 'sendNotification' ? (
                          <>
                            <input value={a.notificationTemplate ?? ''} onChange={(e) => updateAction(a.key, { notificationTemplate: e.target.value })} placeholder="template_name" className={clsx(inputCls, 'flex-1 min-w-[150px] py-2 text-sm font-mono')} />
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const current = (() => { try { return a.notificationRecipients ? JSON.parse(a.notificationRecipients) : []; } catch { return []; } })();
                                if (!current.includes(e.target.value)) updateAction(a.key, { notificationRecipients: JSON.stringify([...current, e.target.value]) });
                              }}
                              className={clsx(inputCls, 'w-[160px] py-2 text-sm')}
                            >
                              <option value="">+ Add recipient…</option>
                              {NOTIFICATION_RECIPIENTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(() => {
                                try { return a.notificationRecipients ? JSON.parse(a.notificationRecipients) : []; } catch { return []; }
                              })().map((rcp: string) => (
                                <span key={rcp} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                                  {NOTIFICATION_RECIPIENTS.find((r) => r.value === rcp)?.label ?? rcp}
                                  <button onClick={() => updateAction(a.key, { notificationRecipients: JSON.stringify((JSON.parse(a.notificationRecipients || '[]')).filter((x: string) => x !== rcp)) })} className="hover:text-emerald-900 font-bold">×</button>
                                </span>
                              ))}
                            </div>
                          </>
                        ) : a.actionType === 'calculate' ? (
                          <input value={a.formula ?? ''} onChange={(e) => updateAction(a.key, { formula: e.target.value })} placeholder="{attendance.overtimeHours} * ({payroll.basicSalary} / 30)" className={clsx(inputCls, 'flex-1 min-w-[220px] py-2 text-sm font-mono')} />
                        ) : ['approve', 'reject', 'validate'].includes(a.actionType) ? (
                          <span className="text-sm text-slate-500 flex-1">Applies to the entity being evaluated</span>
                        ) : (
                          <>
                            <input list="action-targets" value={a.targetField ?? ''} onChange={(e) => updateAction(a.key, { targetField: e.target.value })} placeholder="target field" className={clsx(inputCls, 'flex-1 min-w-[160px] py-2 text-sm font-mono')} />
                            <datalist id="action-targets">{ACTION_TARGET_FIELDS.map((f) => <option key={f} value={f} />)}</datalist>
                            {a.actionType === 'set' && (
                              <input value={a.value ?? ''} onChange={(e) => updateAction(a.key, { value: e.target.value })} placeholder="value" className={clsx(inputCls, 'w-[130px] py-2 text-sm')} />
                            )}
                            {(a.actionType === 'subtract' || a.actionType === 'add') && (
                              <>
                                <input type="number" value={a.amount ?? ''} onChange={(e) => updateAction(a.key, { amount: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="amount ₹" className={clsx(inputCls, 'w-[120px] py-2 text-sm')} />
                                <input type="number" value={a.percent ?? ''} onChange={(e) => updateAction(a.key, { percent: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="% of field" className={clsx(inputCls, 'w-[120px] py-2 text-sm')} />
                              </>
                            )}
                            {(a.actionType === 'multiply' || a.actionType === 'divide') && (
                              <input value={a.value ?? ''} onChange={(e) => updateAction(a.key, { value: e.target.value })} placeholder={a.actionType === 'multiply' ? 'factor (e.g. 2)' : 'divisor'} className={clsx(inputCls, 'w-[130px] py-2 text-sm')} />
                            )}
                          </>
                        )}
                        <button onClick={() => removeAction(a.key)} disabled={draft.actions.length === 1} className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30" title="Remove action">
                          <span className="material-icons text-xl">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ══════════ RIGHT PANEL — AI + Sandbox + Validation ══════════ */}
        <div className="space-y-4 lg:space-y-5">
          <AiGeneratorPanel
            onApply={(rule) => {
              setDraft({
                ...emptyDraft(),
                id: draft?.id ?? null,
                name: rule.name,
                description: rule.description ?? '',
                ruleType: RULE_TYPES.some((t) => t.value === rule.ruleType) ? rule.ruleType : 'custom',
                priority: rule.priority ?? 10,
                executionMode: rule.executionMode ?? 'sync',
                categoryId: draft?.categoryId ?? categories[0]?.id ?? null,
                conditions: (rule.conditions || []).map((c) => ({
                  key: nextKey(),
                  logicalOperator: c.logicalOperator ?? null,
                  field: c.field,
                  operator: c.operator as any,
                  value: String(c.value ?? ''),
                  valueType: (c.valueType as any) || 'string',
                })),
                actions: (rule.actions || []).map((a) => ({
                  key: nextKey(),
                  actionType: (a.actionType ?? a.action_type ?? 'set') as any,
                  targetField: a.targetField ?? a.target_field,
                  value: a.value !== undefined && a.value !== null ? String(a.value) : undefined,
                  amount: a.amount !== undefined && a.amount !== null ? Number(a.amount) : undefined,
                  percent: a.percent !== undefined && a.percent !== null ? Number(a.percent) : undefined,
                  formula: a.formula,
                  notificationTemplate: a.notificationTemplate ?? a.notification_template,
                  notificationRecipients: a.notificationRecipients ?? a.notification_recipients,
                })),
                changeSummary: 'Generated by AI and reviewed',
              });
            }}
          />
          <SandboxPanel draft={draft} />
          {draft && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 mb-3">
                <span className="material-icons text-xl text-amber-500">verified</span>Validation
              </h3>
              {issues.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3.5 py-3">
                  <span className="material-icons text-lg">check_circle</span>Rule is valid and ready to save.
                </p>
              ) : (
                <ul className="space-y-2">
                  {issues.slice(0, 8).map((iss, idx) => (
                    <li key={idx} className={clsx('flex items-start gap-2 text-sm rounded-lg px-3 py-2', iss.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700')}>
                      <span className="material-icons text-base mt-0.5">{iss.severity === 'error' ? 'error' : 'warning'}</span>
                      {iss.message}
                    </li>
                  ))}
                </ul>
              )}
              {errorCount > 0 && <p className="mt-2.5 text-sm text-slate-500">Fix {errorCount} error{errorCount > 1 ? 's' : ''} to enable saving.</p>}
            </div>
          )}
        </div>
      </div>

      {/* ══════════ RULE EXECUTION FLOW ══════════ */}
      <div className="mt-4 lg:mt-5">
        <RuleExecutionFlow
          rules={rules}
          stats={ruleStats}
          actor={actor}
          onRuleClick={openEdit}
          onChanged={refreshAll}
          onToast={(msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); }}
        />
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-slate-800 mb-1.5">Delete rule</h3>
            <p className="text-sm text-slate-500 mb-2 leading-relaxed">"{deleteTarget.name}" and its conditions/actions will be removed.</p>
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3.5 py-2.5 mb-5 leading-relaxed">Version history stays until the rule row is deleted; this action cannot be undone here.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 border border-slate-200 rounded-lg py-2.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-red-700 disabled:opacity-60">
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}