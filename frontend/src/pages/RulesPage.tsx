import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRules, createRule, generateRule, updateRule, deleteRule, toggleRule } from '../api';
import clsx from 'clsx';
import { supabase, supabaseConfigured } from '../lib/supabase';

interface Rule {
  id: number;
  name: string;
  description: string | null;
  ruleType: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

const RULE_TYPES = ['absence_threshold', 'late_coming', 'missed_swipe', 'early_leaving', 'escalation', 'custom'];

const RULE_TYPE_COLORS: Record<string, string> = {
  absence_threshold: 'bg-red-100 text-red-700',
  late_coming: 'bg-blue-100 text-blue-700',
  missed_swipe: 'bg-amber-100 text-amber-700',
  early_leaving: 'bg-orange-100 text-orange-700',
  escalation: 'bg-purple-100 text-purple-700',
  custom: 'bg-slate-100 text-slate-700',
};

const DEFAULT_FORM = {
  name: '',
  description: '',
  ruleType: 'absence_threshold',
  conditionsStr: '{"threshold": 3}',
  actionsStr: '{"sendEmail": true, "templateType": "initial"}',
  priority: 0,
};

export default function RulesPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [jsonError, setJsonError] = useState('');
  const [policyText, setPolicyText] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);

  const { data: rules = [], isLoading } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: () => getRules().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<typeof DEFAULT_FORM, 'conditionsStr' | 'actionsStr'> & { conditions: object; actions: object }) =>
      createRule(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); qc.invalidateQueries({ queryKey: ['deductions'] }); closeModal(); },
  });

  const generateMutation = useMutation({
    mutationFn: async (policy: string) => {
      if (supabaseConfigured && supabase) {
        const { data, error } = await supabase.functions.invoke('generate-rule', { body: { policy } });
        if (error) throw error;
        return data as { name: string; description: string; ruleType: string; conditions: object; actions: object; priority: number };
      }
      return generateRule(policy).then(r => r.data);
    },
    onSuccess: (rule) => {
      setForm({ name: rule.name, description: rule.description, ruleType: rule.ruleType, conditionsStr: JSON.stringify(rule.conditions, null, 2), actionsStr: JSON.stringify(rule.actions, null, 2), priority: rule.priority });
      setJsonError('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => updateRule(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); qc.invalidateQueries({ queryKey: ['deductions'] }); closeModal(); },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => toggleRule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); qc.invalidateQueries({ queryKey: ['deductions'] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); qc.invalidateQueries({ queryKey: ['deductions'] }); setDeleteConfirm(null); },
  });

  function openCreate() {
    setEditingRule(null);
    setForm(DEFAULT_FORM);
    setJsonError('');
    setPolicyText('');
    setShowAdvanced(false);
    setShowModal(true);
  }

  function openEdit(rule: Rule) {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      description: rule.description || '',
      ruleType: rule.ruleType,
      conditionsStr: JSON.stringify(rule.conditions, null, 2),
      actionsStr: JSON.stringify(rule.actions, null, 2),
      priority: rule.priority,
    });
    setJsonError('');
    setPolicyText('');
    setShowAdvanced(false);
    setShowModal(true);
  }

  function applyPreset(type: 'late' | 'absence' | 'half' | 'missed') {
    const presets = {
      late: {
        name: 'Late after 9:30 AM', ruleType: 'late_coming',
        description: 'Count a late day when check-in is after 9:30 AM. Every 3 late days creates 1 LOP day.',
        conditionsStr: JSON.stringify({ lateAfter: '09:30', lateOccurrencesForDeduction: 3 }),
        actionsStr: JSON.stringify({ applyLop: true, lopDays: 'floor(lateDays / 3)', sendEmail: true }),
      },
      absence: {
        name: 'Full-day absence', ruleType: 'absence_threshold',
        description: 'A full-day absence creates 1 LOP day.',
        conditionsStr: JSON.stringify({ status: 'absent' }),
        actionsStr: JSON.stringify({ applyLop: true, lopDays: 1, sendEmail: true }),
      },
      half: {
        name: 'Half day below 4 hours', ruleType: 'custom',
        description: 'Working less than 4 hours creates half a LOP day.',
        conditionsStr: JSON.stringify({ workHoursLessThan: 4 }),
        actionsStr: JSON.stringify({ applyLop: true, lopDays: 0.5, sendEmail: true }),
      },
      missed: {
        name: 'Missed punch', ruleType: 'missed_swipe',
        description: 'A missing check-in or check-out creates an attendance warning.',
        conditionsStr: JSON.stringify({ status: 'missed swipe' }),
        actionsStr: JSON.stringify({ sendEmail: true, templateType: 'initial' }),
      },
    }[type];
    setForm(f => ({ ...f, ...presets }));
    setJsonError('');
  }

  function ruleBullets(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''} ${JSON.stringify(rule.conditions)} ${JSON.stringify(rule.actions)}`.toLowerCase();
    if (text.includes('late')) return [
      'Late when check-in is after 09:30 AM',
      '3 late days = 1 LOP day',
      '6 late days = 2 LOP days',
      '9 late days = 3 LOP days',
    ];
    if (text.includes('half') || text.includes('4 hour')) return [
      'Working less than 4 hours = half day',
      'Half day = 0.5 LOP day',
    ];
    if (text.includes('absen')) return ['Full-day absence = 1 LOP day'];
    if (text.includes('missed') || text.includes('swipe')) return ['Missing check-in or check-out creates a missed-punch flag'];
    return (rule.description || 'This rule is applied to matching attendance records.')
      .split(/\n|(?<=[.!?])\s+/)
      .map(value => value.trim())
      .filter(Boolean);
  }

  function readableRuleName(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''}`.toLowerCase();
    if (text.includes('late')) return 'Late-coming deduction';
    if (text.includes('half') || text.includes('4 hour')) return 'Half-day rule';
    if (text.includes('absen')) return 'Absence rule';
    if (text.includes('missed') || text.includes('swipe')) return 'Missed-punch rule';
    return rule.name;
  }

  function ruleExamples(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''} ${JSON.stringify(rule.conditions)} ${JSON.stringify(rule.actions)}`.toLowerCase();
    if (text.includes('late')) return ['Check-in at 09:31 AM → late day', '3 late days → 1 LOP day'];
    if (text.includes('half') || text.includes('4 hour')) return ['Work 3 hours 59 minutes → half day', 'Half day → 0.5 LOP day'];
    if (text.includes('absen')) return ['No attendance for a scheduled day → 1 LOP day'];
    if (text.includes('missed') || text.includes('swipe')) return ['Only check-in or only check-out → missed-punch flag'];
    return ['The rule is checked against matching attendance records.'];
  }

  function ruleImpact(rule: Rule) {
    const text = `${rule.name} ${rule.description || ''} ${JSON.stringify(rule.conditions)} ${JSON.stringify(rule.actions)}`.toLowerCase();
    if (text.includes('late')) return 'Salary / LOP impact: adds one LOP day for every three late days.';
    if (text.includes('half') || text.includes('4 hour')) return 'Salary / LOP impact: adds 0.5 LOP day.';
    if (text.includes('absen')) return 'Salary / LOP impact: adds one LOP day for each full-day absence.';
    if (text.includes('missed') || text.includes('swipe')) return 'Salary / LOP impact: creates a missed-punch attendance flag.';
    return 'Salary / LOP impact depends on the rule action settings.';
  }

  function closeModal() {
    setShowModal(false);
    setEditingRule(null);
    setJsonError('');
  }

  function handleSubmit() {
    let conditions: object, actions: object;
    try {
      conditions = JSON.parse(form.conditionsStr);
      actions = JSON.parse(form.actionsStr);
    } catch {
      setJsonError('Invalid JSON in conditions or actions.');
      return;
    }
    const payload = { name: form.name, description: form.description, ruleType: form.ruleType, conditions, actions, priority: form.priority };
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="w-full min-w-0 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Attendance Rules</h1>
          <p className="text-slate-500 text-sm mt-1">Choose the rules HRPulse should use for attendance and salary deductions.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          <span className="material-icons text-lg">add</span>
          New Rule
        </button>
      </div>

      <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        <span className="font-semibold">How it works:</span> Active rules are followed. Inactive rules are ignored. Salary / LOP uses active absence, half-day, leave, and late-coming rules. You can edit or switch any rule below.
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-slate-400">
          <span className="material-icons animate-spin text-4xl block mb-2">refresh</span>Loading rules...
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <span className="material-icons text-6xl block mb-3 opacity-30">rule</span>
          <p className="text-lg font-medium mb-2">No rules configured</p>
          <p className="text-sm">Create your first HR attendance rule to automate email triggers.</p>
          <button onClick={openCreate} className="mt-4 text-brand-600 text-sm font-medium hover:underline">
            Create a rule
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule, index) => {
            const expanded = expandedRuleId === rule.id;
            return (
              <div key={rule.id} className={clsx('min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm', rule.isActive ? 'border-slate-100' : 'border-slate-100 opacity-60')}>
                <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
                  <button type="button" onClick={() => setExpandedRuleId(expanded ? null : rule.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', RULE_TYPE_COLORS[rule.ruleType] || 'bg-slate-100 text-slate-600')}>{rule.ruleType.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-slate-400">priority {rule.priority}</span>
                        <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold', rule.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{rule.isActive ? 'Used for calculation' : 'Not used'}</span>
                      </span>
                      <span className="mt-2 block break-words font-semibold text-slate-800">{readableRuleName(rule)}</span>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-500">
                        {ruleBullets(rule).map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}
                      </ul>
                    </span>
                    <span className="mt-1 shrink-0 text-slate-400"><span className="material-icons">{expanded ? 'expand_less' : 'expand_more'}</span></span>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    <label onClick={event => event.stopPropagation()} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100" title={rule.isActive ? 'Click to stop using this rule' : 'Click to use this rule'}>
                      <input type="checkbox" checked={rule.isActive} onChange={() => toggleMutation.mutate(rule.id)} disabled={toggleMutation.isPending} className="h-4 w-4 accent-indigo-600" />
                      Apply
                    </label>
                    <button type="button" onClick={() => toggleMutation.mutate(rule.id)} className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors', rule.isActive ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                      <span className="material-icons text-base">{rule.isActive ? 'toggle_on' : 'toggle_off'}</span>{rule.isActive ? 'Active' : 'Inactive'}
                    </button>
                    <button type="button" onClick={() => openEdit(rule)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit rule"><span className="material-icons text-lg">edit</span></button>
                    <button type="button" onClick={() => setDeleteConfirm(rule.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete rule"><span className="material-icons text-lg">delete</span></button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4 pl-14">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">What it means</p><p className="mt-1 text-sm text-slate-600">{rule.description || 'This rule is checked against matching attendance records.'}</p></div>
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Examples</p><ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-600">{ruleExamples(rule).map((example, exampleIndex) => <li key={exampleIndex}>{example}</li>)}</ul></div>
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Calculation</p><p className="mt-1 text-sm text-slate-600">{ruleImpact(rule)}</p></div>
                    </div>
                    <details className="mt-4 text-xs"><summary className="cursor-pointer select-none font-medium text-slate-500">Show technical details</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><div className="min-w-0 overflow-hidden rounded-lg bg-white px-3 py-2"><span className="font-medium text-slate-400">Conditions: </span><code className="break-all text-slate-600">{JSON.stringify(rule.conditions)}</code></div><div className="min-w-0 overflow-hidden rounded-lg bg-white px-3 py-2"><span className="font-medium text-slate-400">Actions: </span><code className="break-all text-slate-600">{JSON.stringify(rule.actions)}</code></div></div></details>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-800">{editingRule ? 'Edit Rule' : 'New Rule'}</h3>
              <button onClick={closeModal} className="p-1.5 rounded hover:bg-slate-100">
                <span className="material-icons text-xl text-slate-400">close</span>
              </button>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-900">Choose a common rule</p>
                <p className="mt-1 text-xs text-emerald-700">Click one to fill the form. You can change the details before saving.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => applyPreset('late')} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 ring-1 ring-emerald-200 hover:bg-emerald-100">Late after 9:30</button>
                  <button type="button" onClick={() => applyPreset('absence')} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 ring-1 ring-emerald-200 hover:bg-emerald-100">Full-day absence</button>
                  <button type="button" onClick={() => applyPreset('half')} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 ring-1 ring-emerald-200 hover:bg-emerald-100">Less than 4 hours</button>
                  <button type="button" onClick={() => applyPreset('missed')} className="rounded-lg bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 ring-1 ring-emerald-200 hover:bg-emerald-100">Missed punch</button>
                </div>
              </div>
              {!editingRule && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 space-y-2">
                  <label className="block text-sm font-medium text-indigo-900">Describe the policy in simple words</label>
                  <textarea
                    value={policyText}
                    onChange={e => setPolicyText(e.target.value)}
                    rows={3}
                    placeholder="Example: If an employee is late 4 times in one month, send a warning and apply half a day LOP."
                    className="border border-indigo-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-indigo-700">Gemini suggests the rule. Review it before saving.</p>
                    <button
                      onClick={() => generateMutation.mutate(policyText)}
                      disabled={policyText.trim().length < 10 || generateMutation.isPending}
                      className="shrink-0 bg-indigo-600 text-white rounded-lg px-3 py-2 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {generateMutation.isPending ? 'Generating...' : 'Generate with Gemini'}
                    </button>
                  </div>
                  {generateMutation.isError && <p className="text-xs text-red-600">{(generateMutation.error as any)?.response?.data?.error || 'Gemini could not generate this rule.'}</p>}
                </div>
              )}
              <button type="button" onClick={() => setShowAdvanced(value => !value)} className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                <span className="material-icons text-sm">{showAdvanced ? 'expand_less' : 'expand_more'}</span>
                {showAdvanced ? 'Hide advanced JSON settings' : 'Show advanced JSON settings'}
              </button>
              <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rule Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="e.g. Alert on 3+ absences"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rule Type *</label>
                  <select
                    value={form.ruleType}
                    onChange={e => setForm(f => ({ ...f, ruleType: e.target.value }))}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    {RULE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
                    min={0}
                  />
                </div>
              </div>
              {showAdvanced && <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Conditions (JSON)</label>
                <textarea
                  value={form.conditionsStr}
                  onChange={e => setForm(f => ({ ...f, conditionsStr: e.target.value }))}
                  rows={3}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Actions (JSON)</label>
                <textarea
                  value={form.actionsStr}
                  onChange={e => setForm(f => ({ ...f, actionsStr: e.target.value }))}
                  rows={3}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono resize-none"
                />
              </div>
              {jsonError && <p className="text-red-500 text-xs">{jsonError}</p>}
              </>}
              </>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={closeModal} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.name || isPending}
                className="flex-1 bg-brand-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
              >
                {isPending ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Rule</h3>
            <p className="text-slate-500 text-sm mb-5">This rule will be permanently deleted. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
