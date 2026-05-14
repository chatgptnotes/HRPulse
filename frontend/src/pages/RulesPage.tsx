import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRules, createRule, updateRule, deleteRule, toggleRule } from '../api';
import clsx from 'clsx';

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

  const { data: rules = [], isLoading } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: () => getRules().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<typeof DEFAULT_FORM, 'conditionsStr' | 'actionsStr'> & { conditions: object; actions: object }) =>
      createRule(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); closeModal(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => updateRule(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); closeModal(); },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => toggleRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setDeleteConfirm(null); },
  });

  function openCreate() {
    setEditingRule(null);
    setForm(DEFAULT_FORM);
    setJsonError('');
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
    setShowModal(true);
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Attendance Rules</h1>
          <p className="text-slate-500 text-sm mt-1">Define HR policy rules that trigger email notifications and actions.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          <span className="material-icons text-lg">add</span>
          New Rule
        </button>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rules.map(rule => (
            <div key={rule.id} className={clsx('bg-white rounded-xl border shadow-sm p-5 flex flex-col gap-3', rule.isActive ? 'border-slate-100' : 'border-slate-100 opacity-60')}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', RULE_TYPE_COLORS[rule.ruleType] || 'bg-slate-100 text-slate-600')}>
                      {rule.ruleType.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-slate-400">priority {rule.priority}</span>
                  </div>
                  <h3 className="font-semibold text-slate-800 mt-2 text-sm">{rule.name}</h3>
                  {rule.description && <p className="text-xs text-slate-500 mt-1">{rule.description}</p>}
                </div>
              </div>

              <div className="text-xs space-y-1">
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-medium">Conditions: </span>
                  <code className="text-slate-600">{JSON.stringify(rule.conditions)}</code>
                </div>
                <div className="bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-medium">Actions: </span>
                  <code className="text-slate-600">{JSON.stringify(rule.actions)}</code>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => toggleMutation.mutate(rule.id)}
                  className={clsx(
                    'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
                    rule.isActive
                      ? 'bg-green-50 text-green-700 hover:bg-green-100'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  )}
                >
                  <span className="material-icons text-base">{rule.isActive ? 'toggle_on' : 'toggle_off'}</span>
                  {rule.isActive ? 'Active' : 'Inactive'}
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(rule)}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                    title="Edit rule"
                  >
                    <span className="material-icons text-lg">edit</span>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(rule.id)}
                    className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"
                    title="Delete rule"
                  >
                    <span className="material-icons text-lg">delete</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
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
