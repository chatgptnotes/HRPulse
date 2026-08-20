/**
 * Rule Management — three-panel workspace.
 *
 * Left   : rule list with search / category / status / priority filters and
 *          quick actions (toggle, edit, clone, delete).
 * Center : Rule Builder — IF / AND / OR condition rows and THEN action rows
 *          in the clean enterprise SaaS design (white card, 16px radius,
 *          #F9FAFB builder containers, green IF/THEN labels, blue AND pill,
 *          Reset + Save Rule footer).
 * Right  : AI Rule Generator (Gemini), Testing Sandbox, Suggestions and
 *          live Validation results.
 */

import { useEffect, useState } from 'react';
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
import RuleExecutionFlowSection from '../rule-engine/RuleExecutionFlowSection';

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
// Small UI atoms (clean SaaS design system)
// ─────────────────────────────────────────────────────────────────────────────

const inputCls =
  'h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] text-[#111827] ' +
  'placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15 transition';

const labelCls = 'mb-1.5 block text-[13px] font-medium text-[#374151]';

const deleteBtnCls =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#EF4444] ' +
  'transition-colors hover:bg-[#FEF2F2] active:scale-95';

function FieldSelect({ groups, value, onChange, placeholder }: { groups: string[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={clsx(inputCls, 'cursor-pointer')}>
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
      <select value={cond.value} onChange={(e) => onChange({ value: e.target.value })} className={clsx(inputCls, 'cursor-pointer')}>
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
        className={clsx(inputCls, 'font-mono text-[13px]')}
      />
    );
  }
  // Enum options (Day of Week, Status…) render a dropdown unless the operator
  // is a text search.
  if (def?.options && ['eq', 'ne', 'in', 'notIn'].includes(cond.operator)) {
    return (
      <select value={cond.value} onChange={(e) => onChange({ value: e.target.value })} className={clsx(inputCls, 'cursor-pointer')}>
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

/** Blue pill-shaped AND/OR connector between condition rows. */
function AndConnector({ value, onChange }: { value: 'AND' | 'OR'; onChange: (v: 'AND' | 'OR') => void }) {
  return (
    <div className="flex justify-center py-1">
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as 'AND' | 'OR')}
          aria-label="Logical operator between conditions"
          className="cursor-pointer appearance-none rounded-full bg-[#DBEAFE] py-1 pl-4 pr-7 text-[11px] font-semibold tracking-wide text-[#2563EB] focus:outline-none"
        >
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
        <span className="material-icons pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[14px] text-[#2563EB]">expand_more</span>
      </div>
    </div>
  );
}

/** Red delete icon button for condition & action rows. */
function DeleteRowButton({ onClick, disabled, title }: { onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title} className={clsx(deleteBtnCls, disabled && 'cursor-not-allowed opacity-30')}>
      <span className="material-icons text-[20px]">delete_outline</span>
    </button>
  );
}

/** Blue outlined "+ Add …" button used inside the builder containers. */
function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#2563EB] bg-white px-4 py-2 text-[13px] font-semibold text-[#2563EB] transition-colors hover:bg-[#EFF6FF] active:scale-[0.98]"
    >
      <span className="material-icons text-[16px]">add</span>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────────

export default function RuleManagementTab({ onChanged, openCreateSignal }: { onChanged?: () => void; openCreateSignal?: number }) {
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

  useEffect(() => {
    if (openCreateSignal) openNew();
  }, [openCreateSignal]);

  // Reset: restore a blank draft (keeping the category default).
  const resetDraft = () => {
    setSaveError('');
    setDraft({ ...emptyDraft(), categoryId: categories[0]?.id ?? null });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="relative">
      {toast && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-2 rounded-[12px] border border-[#16A34A]/20 bg-white px-4 py-3 text-[13px] font-medium text-[#16A34A] shadow-[0px_4px_16px_rgba(0,0,0,0.12)]">
          <span className="material-icons text-[18px]">check_circle</span>{toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)_380px] gap-4 lg:gap-5">
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

        {/* ══════════ CENTER — Rule Builder (clean SaaS design) ══════════ */}
        <div id="rule-builder" className="rounded-[16px] border border-[#E5E7EB] bg-white shadow-[0px_2px_8px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden">
          {!draft ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-10 text-center">
              <div className="w-16 h-16 rounded-[16px] bg-[#EFF6FF] flex items-center justify-center mb-4">
                <span className="material-icons text-[#2563EB] text-3xl">account_tree</span>
              </div>
              <h3 className="text-[20px] font-semibold text-[#1F2937]">Rule Builder</h3>
              <p className="text-[13px] text-[#6B7280] mt-2 max-w-md leading-relaxed">
                Create business rules with IF / AND / OR / THEN blocks — no coding required.
                Pick a rule on the left to edit, start from a template, or ask the AI generator on the right.
              </p>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl w-full">
                {RULE_TEMPLATES.map((t) => (
                  <button key={t.name} onClick={() => applyTemplate(t)} className="text-left p-3.5 rounded-[12px] border border-[#E5E7EB] bg-white shadow-[0px_2px_8px_rgba(0,0,0,0.05)] hover:border-[#93C5FD] transition-colors">
                    <p className="text-[13px] font-semibold text-[#111827] line-clamp-2">{t.name}</p>
                    <p className="text-[13px] text-[#6B7280] mt-1 line-clamp-2 leading-relaxed">{t.description}</p>
                  </button>
                ))}
              </div>
              <button onClick={openNew} className="mt-6 inline-flex items-center gap-2 rounded-[10px] bg-[#2563EB] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0px_2px_8px_rgba(37,99,235,0.25)] transition-all hover:bg-[#1D4ED8] active:scale-[0.98]">
                <span className="material-icons text-[16px]">add</span>
                Build a rule from scratch
              </button>
            </div>
          ) : (
            <>
              {/* ─── Builder header ─── */}
              <div className="p-6 pb-4 border-b border-[#E5E7EB]">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#EFF6FF] text-[#2563EB]">
                      <span className="material-icons text-[22px]">account_tree</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[20px] font-semibold leading-tight text-[#1F2937]">Rule Builder</h3>
                      <p className="text-[12px] text-[#6B7280] mt-0.5">
                        {draft.id ? `Editing rule #${draft.id}` : 'Creating a new rule'}
                      </p>
                    </div>
                  </div>

                  {/* Active toggle switch */}
                  <div className="flex items-center gap-2.5">
                    <span className="text-[13px] font-medium text-[#374151]">Active</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.isActive}
                      aria-label="Toggle rule active state"
                      onClick={() => patchDraft({ isActive: !draft.isActive })}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
                        draft.isActive ? 'bg-[#2563EB]' : 'bg-[#D1D5DB]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          draft.isActive ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* ─── Builder body ─── */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 xl:max-h-[70vh]">
                {/* Three-column form row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Rule Name</label>
                    <input
                      value={draft.name}
                      onChange={(e) => patchDraft({ name: e.target.value })}
                      placeholder="e.g. Half Day Rule"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Category</label>
                    <select value={draft.categoryId ?? ''} onChange={(e) => patchDraft({ categoryId: Number(e.target.value) })} className={clsx(inputCls, 'cursor-pointer')}>
                      <option value="">Select…</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Priority</label>
                    <input type="number" min={0} max={100} value={draft.priority} onChange={(e) => patchDraft({ priority: Number(e.target.value) || 0 })} className={inputCls} />
                  </div>
                </div>

                {/* Secondary settings row — type / execution / change summary */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Type</label>
                    <select value={draft.ruleType} onChange={(e) => patchDraft({ ruleType: e.target.value })} className={clsx(inputCls, 'cursor-pointer')}>
                      {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Execution</label>
                    <select value={draft.executionMode} onChange={(e) => patchDraft({ executionMode: e.target.value as 'sync' | 'async' })} className={clsx(inputCls, 'cursor-pointer')}>
                      <option value="sync">Synchronous</option>
                      <option value="async">Asynchronous</option>
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className={labelCls}>Description (Optional)</label>
                  <textarea
                    value={draft.description}
                    onChange={(e) => patchDraft({ description: e.target.value })}
                    placeholder="What does this rule do?"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-[#D1D5DB] bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15 transition"
                    style={{ minHeight: 80 }}
                  />
                </div>

                {draft.id && (
                  <div>
                    <label className={labelCls}>Change Summary (Optional)</label>
                    <input
                      value={draft.changeSummary}
                      onChange={(e) => patchDraft({ changeSummary: e.target.value })}
                      placeholder="Summary for this version"
                      className={inputCls}
                    />
                  </div>
                )}

                {/* ─── IF (Conditions) ─── */}
                <div>
                  <h4 className="mb-2.5 text-[13px]">
                    <span className="rounded-md bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-bold tracking-wide text-[#16A34A]">IF</span>{' '}
                    <span className="font-semibold text-[13px] text-[#374151]">(Conditions)</span>
                    <span className="ml-2 text-[12px] font-normal text-[#9CA3AF]">all / any rows must match per connector</span>
                  </h4>
                  <div className="rounded-[12px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                    {draft.conditions.map((c, i) => (
                      <div key={c.key}>
                        {i > 0 && (
                          <AndConnector
                            value={c.logicalOperator ?? 'AND'}
                            onChange={(v) => updateCondition(c.key, { logicalOperator: v })}
                          />
                        )}
                        <div className="flex flex-wrap items-center gap-2.5">
                          <div className="min-w-[180px] flex-1">
                            <FieldSelect groups={FIELD_GROUPS} value={c.field} onChange={(v) => updateCondition(c.key, { field: v })} placeholder="Select field…" />
                          </div>
                          <div className="w-[170px] shrink-0">
                            <select value={c.operator} onChange={(e) => updateCondition(c.key, { operator: e.target.value as any })} className={clsx(inputCls, 'cursor-pointer')}>
                              {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div className="min-w-[140px] flex-1">
                            <ValueInput cond={c} onChange={(patch) => updateCondition(c.key, patch)} />
                          </div>
                          <select value={c.valueType} onChange={(e) => updateCondition(c.key, { valueType: e.target.value as any })} className={clsx(inputCls, 'w-[100px] shrink-0 cursor-pointer text-[12px]')} title="Value type">
                            {VALUE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                          </select>
                          <DeleteRowButton onClick={() => removeCondition(c.key)} disabled={draft.conditions.length === 1} title="Delete condition" />
                        </div>
                      </div>
                    ))}

                    <div className="mt-3.5">
                      <AddRowButton label="Add Condition" onClick={addCondition} />
                    </div>
                  </div>
                </div>

                {/* ─── THEN (Actions) ─── */}
                <div>
                  <h4 className="mb-2.5 text-[13px]">
                    <span className="rounded-md bg-[#DBEAFE] px-2 py-0.5 text-[11px] font-bold tracking-wide text-[#2563EB]">THEN</span>{' '}
                    <span className="font-semibold text-[13px] text-[#374151]">(Actions)</span>
                    <span className="ml-2 text-[12px] font-normal text-[#9CA3AF]">executed in order when all conditions match</span>
                  </h4>
                  <div className="rounded-[12px] border border-[#E5E7EB] bg-[#F9FAFB] p-4 space-y-2.5">
                    {draft.actions.map((a, i) => (
                      <div key={a.key} className="flex flex-wrap items-center gap-2.5 bg-white rounded-lg p-2.5 border border-[#E5E7EB]">
                        <span className="w-7 h-7 rounded-full bg-[#DBEAFE] text-[#2563EB] text-[12px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                        <select value={a.actionType} onChange={(e) => updateAction(a.key, { actionType: e.target.value as any })} className={clsx(inputCls, 'w-[170px] cursor-pointer')}>
                          {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>

                        {a.actionType === 'sendNotification' ? (
                          <>
                            <input value={a.notificationTemplate ?? ''} onChange={(e) => updateAction(a.key, { notificationTemplate: e.target.value })} placeholder="template_name" className={clsx(inputCls, 'flex-1 min-w-[150px] font-mono text-[13px]')} />
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const current = (() => { try { return a.notificationRecipients ? JSON.parse(a.notificationRecipients) : []; } catch { return []; } })();
                                if (!current.includes(e.target.value)) updateAction(a.key, { notificationRecipients: JSON.stringify([...current, e.target.value]) });
                              }}
                              className={clsx(inputCls, 'w-[160px] cursor-pointer')}
                            >
                              <option value="">+ Add recipient…</option>
                              {NOTIFICATION_RECIPIENTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(() => {
                                try { return a.notificationRecipients ? JSON.parse(a.notificationRecipients) : []; } catch { return []; }
                              })().map((rcp: string) => (
                                <span key={rcp} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EFF6FF] text-[#2563EB] text-[12px] font-medium">
                                  {NOTIFICATION_RECIPIENTS.find((r) => r.value === rcp)?.label ?? rcp}
                                  <button onClick={() => updateAction(a.key, { notificationRecipients: JSON.stringify((JSON.parse(a.notificationRecipients || '[]')).filter((x: string) => x !== rcp)) })} className="hover:text-[#1D4ED8] font-bold">×</button>
                                </span>
                              ))}
                            </div>
                          </>
                        ) : a.actionType === 'calculate' ? (
                          <input value={a.formula ?? ''} onChange={(e) => updateAction(a.key, { formula: e.target.value })} placeholder="{attendance.overtimeHours} * ({payroll.basicSalary} / 30)" className={clsx(inputCls, 'flex-1 min-w-[220px] font-mono text-[13px]')} />
                        ) : ['approve', 'reject', 'validate'].includes(a.actionType) ? (
                          <span className="text-[13px] text-[#6B7280] flex-1">Applies to the entity being evaluated</span>
                        ) : (
                          <>
                            <input list="action-targets" value={a.targetField ?? ''} onChange={(e) => updateAction(a.key, { targetField: e.target.value })} placeholder="target field" className={clsx(inputCls, 'flex-1 min-w-[160px] font-mono text-[13px]')} />
                            <datalist id="action-targets">{ACTION_TARGET_FIELDS.map((f) => <option key={f} value={f} />)}</datalist>
                            {a.actionType === 'set' && (
                              <input value={a.value ?? ''} onChange={(e) => updateAction(a.key, { value: e.target.value })} placeholder="value" className={clsx(inputCls, 'w-[130px]')} />
                            )}
                            {(a.actionType === 'subtract' || a.actionType === 'add') && (
                              <>
                                <input type="number" value={a.amount ?? ''} onChange={(e) => updateAction(a.key, { amount: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="amount ₹" className={clsx(inputCls, 'w-[120px]')} />
                                <input type="number" value={a.percent ?? ''} onChange={(e) => updateAction(a.key, { percent: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="% of field" className={clsx(inputCls, 'w-[120px]')} />
                              </>
                            )}
                            {(a.actionType === 'multiply' || a.actionType === 'divide') && (
                              <input value={a.value ?? ''} onChange={(e) => updateAction(a.key, { value: e.target.value })} placeholder={a.actionType === 'multiply' ? 'factor (e.g. 2)' : 'divisor'} className={clsx(inputCls, 'w-[130px]')} />
                            )}
                          </>
                        )}
                        <DeleteRowButton onClick={() => removeAction(a.key)} disabled={draft.actions.length === 1} title="Delete action" />
                      </div>
                    ))}

                    <div className="pt-1">
                      <AddRowButton label="Add Action" onClick={addAction} />
                    </div>
                  </div>
                </div>

                {saveError && <p className="text-[13px] text-[#DC2626] bg-[#FEE2E2] rounded-lg px-3.5 py-2.5">{saveError}</p>}
              </div>

              {/* ─── Footer actions ─── */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] bg-[#F8FAFC] px-6 py-4">
                <button
                  onClick={() => setDraft(null)}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6B7280] hover:text-[#374151] transition-colors"
                  title="Close the builder without saving"
                >
                  <span className="material-icons text-[18px]">close</span>
                  Close
                </button>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={resetDraft}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#D1D5DB] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#374151] transition-colors hover:bg-[#F8FAFC]"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || errorCount > 0}
                    title={errorCount > 0 ? `Fix ${errorCount} validation error${errorCount > 1 ? 's' : ''} to enable saving` : 'Save this rule'}
                    className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] px-6 py-2.5 text-[13px] font-semibold text-white shadow-[0px_4px_12px_rgba(37,99,235,0.35)] transition-all duration-200 hover:shadow-[0px_6px_18px_rgba(37,99,235,0.45)] hover:brightness-110 hover:-translate-y-px active:scale-[0.98] disabled:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    <span className="material-icons text-[16px]">{saveMutation.isPending ? 'hourglass_top' : 'save'}</span>
                    {saveMutation.isPending ? 'Saving…' : 'Save Rule'}
                  </button>
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
            <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4 shadow-[0px_2px_10px_rgba(0,0,0,0.05)] sm:p-5">
              <h3 className="mb-3 flex items-center gap-2.5 text-[16px] font-semibold text-[#111827]">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFFBEB] text-[#F59E0B]">
                  <span className="material-icons text-[17px]">verified</span>
                </span>
                Validation
              </h3>
              {issues.length === 0 ? (
                <p className="flex items-center gap-2 rounded-[10px] bg-[#DCFCE7] px-3.5 py-3 text-[13px] font-medium text-[#16A34A]">
                  <span className="material-icons text-[18px]">check_circle</span>Rule is valid and ready to save.
                </p>
              ) : (
                <ul className="space-y-2">
                  {issues.slice(0, 8).map((iss, idx) => (
                    <li key={idx} className={clsx('flex items-start gap-2 rounded-[10px] px-3 py-2 text-[13px]', iss.severity === 'error' ? 'bg-[#FEE2E2] text-[#DC2626]' : 'bg-[#FFFBEB] text-[#B45309]')}>
                      <span className="material-icons mt-0.5 text-[15px]">{iss.severity === 'error' ? 'error' : 'warning'}</span>
                      {iss.message}
                    </li>
                  ))}
                </ul>
              )}
              {errorCount > 0 && <p className="mt-2.5 text-[13px] text-[#6B7280]">Fix {errorCount} error{errorCount > 1 ? 's' : ''} to enable saving.</p>}
            </div>
          )}
        </div>
      </div>

      {/* ══════════ RULE EXECUTION FLOW (clean design, real rules) ══════════ */}
      <div className="mt-4 lg:mt-5">
        <RuleExecutionFlowSection
          rules={rules.map((r) => ({ id: r.id, name: r.name, priority: r.priority, active: r.is_active }))}
          selectedRuleId={draft?.id ?? null}
          onRuleClick={(flow) => {
            const full = rules.find((r) => r.id === flow.id);
            if (full) openEdit(full);
          }}
        />
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-2xl">
            <h3 className="mb-1.5 text-[18px] font-semibold text-[#111827]">Delete rule</h3>
            <p className="mb-2 text-[13px] leading-relaxed text-[#6B7280]">"{deleteTarget.name}" and its conditions/actions will be removed.</p>
            <p className="mb-5 rounded-[10px] bg-[#FFFBEB] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#B45309]">Version history stays until the rule row is deleted; this action cannot be undone here.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-[10px] border border-[#E5E7EB] bg-white py-2.5 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC]">Cancel</button>
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} className="flex-1 rounded-[10px] bg-[#EF4444] py-2.5 text-[13px] font-semibold text-white shadow-[0px_2px_8px_rgba(239,68,68,0.3)] transition-all hover:bg-[#DC2626] disabled:opacity-60">
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
