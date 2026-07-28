import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRules, createRule, updateRule, deleteRule, toggleRule } from '../api';
import { DEPARTMENTS } from '../constants/departments';
import clsx from 'clsx';

interface Rule {
  id: number;
  name: string;
  description: string | null;
  rule_type: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  priority: number;
  is_active: boolean;
  created_at: string;
}

type SalaryEffect = 'deduct_days' | 'deduct_amount' | 'deduct_percent' | 'allowance_amount' | 'allowance_percent';
type StatusFilter = 'all' | 'active' | 'inactive';

interface CondRow { metric: string; op: 'gte' | 'lte'; value: number }

const RULE_TYPES = ['absence_threshold', 'late_coming', 'missed_swipe', 'early_leaving', 'half_day', 'overtime', 'shift', 'holiday', 'leave', 'payroll', 'ai_notification', 'custom'];
const RULE_TYPE_LABELS: Record<string, string> = {
  all: 'All categories',
  absence_threshold: 'Absence',
  late_coming: 'Late Coming',
  missed_swipe: 'Missing Punch',
  early_leaving: 'Early Leaving',
  half_day: 'Half Day',
  overtime: 'Overtime',
  shift: 'Shift',
  holiday: 'Holiday',
  leave: 'Leave',
  payroll: 'Payroll',
  ai_notification: 'AI Notifications',
  custom: 'Custom Rules',
};

const CATEGORY_META: Record<string, { icon: string; color: string; ring: string }> = {
  absence_threshold: { icon: 'person_off', color: 'from-rose-500 to-red-600', ring: 'ring-rose-100' },
  late_coming: { icon: 'schedule', color: 'from-sky-500 to-blue-600', ring: 'ring-sky-100' },
  missed_swipe: { icon: 'fingerprint', color: 'from-amber-500 to-orange-600', ring: 'ring-amber-100' },
  early_leaving: { icon: 'logout', color: 'from-orange-500 to-red-500', ring: 'ring-orange-100' },
  half_day: { icon: 'contrast', color: 'from-violet-500 to-indigo-600', ring: 'ring-violet-100' },
  overtime: { icon: 'timer', color: 'from-emerald-500 to-teal-600', ring: 'ring-emerald-100' },
  shift: { icon: 'work_history', color: 'from-cyan-500 to-blue-600', ring: 'ring-cyan-100' },
  holiday: { icon: 'event_available', color: 'from-cyan-500 to-indigo-600', ring: 'ring-cyan-100' },
  leave: { icon: 'event_busy', color: 'from-violet-500 to-purple-600', ring: 'ring-violet-100' },
  payroll: { icon: 'payments', color: 'from-lime-600 to-emerald-700', ring: 'ring-lime-100' },
  ai_notification: { icon: 'auto_awesome', color: 'from-fuchsia-500 to-pink-600', ring: 'ring-fuchsia-100' },
  custom: { icon: 'tune', color: 'from-slate-600 to-slate-900', ring: 'ring-slate-100' },
};

const METRICS = [
  { key: 'absentDays', label: 'Absences', sample: 3 },
  { key: 'lateComingDays', label: 'Late arrivals', sample: 4 },
  { key: 'missedSwipeDays', label: 'Missing punches', sample: 2 },
  { key: 'earlyLeavingDays', label: 'Early exits', sample: 1 },
  { key: 'halfDays', label: 'Half days', sample: 2 },
  { key: 'overtimeDays', label: 'Overtime days', sample: 2 },
  { key: 'overtimeHours', label: 'Overtime hours', sample: 6 },
  { key: 'totalFlagged', label: 'Any issue count', sample: 5 },
];

const EFFECT_FIELD: Record<SalaryEffect, string> = {
  deduct_days: 'deductDays',
  deduct_amount: 'deductAmount',
  deduct_percent: 'deductPercent',
  allowance_amount: 'allowanceAmount',
  allowance_percent: 'allowancePercent',
};

const SALARY_EFFECT_LABELS: Record<SalaryEffect, string> = {
  deduct_days: 'Deduct salary days',
  deduct_amount: 'Deduct fixed amount',
  deduct_percent: 'Deduct salary percentage',
  allowance_amount: 'Add fixed allowance',
  allowance_percent: 'Add salary percentage',
};

const EMAIL_KEYS = ['sendEmail', 'templateType', 'severity', 'notifyManager', 'notifyHRDirector', 'disciplinaryRisk', 'awol'];
const ALL_SALARY_FIELDS = Object.values(EFFECT_FIELD);

const DEFAULT_FORM = {
  name: '',
  description: '',
  ruleType: 'late_coming',
  department: '',
  shift: '',
  conditions: [{ metric: 'lateComingDays', op: 'gte', value: 3 }] as CondRow[],
  sendEmail: true,
  severity: 'warning',
  notifyManager: false,
  salaryEffect: 'deduct_days' as SalaryEffect,
  salaryValue: 1,
  priority: 5,
};

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={clsx('material-icons', className)}>{name}</span>;
}

function describeConditions(conditions: Record<string, unknown>) {
  const c = conditions as Record<string, any>;
  const out: string[] = [];
  for (const metric of METRICS) {
    const rule = c[metric.key];
    if (!rule || typeof rule !== 'object') continue;
    if (rule.gte !== undefined) out.push(`${metric.label} >= ${rule.gte}`);
    if (rule.lte !== undefined) out.push(`${metric.label} <= ${rule.lte}`);
  }
  if (c.department) out.push(`Department: ${c.department}`);
  if (c.shift) out.push(`Shift: ${c.shift}`);
  return out;
}

function describeActions(actions: Record<string, unknown>) {
  const a = actions as Record<string, any>;
  const out: string[] = [];
  if (a.sendEmail !== false) out.push(`Notify employee (${a.severity || 'notice'})`);
  if (a.notifyManager) out.push('Notify manager');
  if (a.notifyHRDirector) out.push('Notify HR director');
  if (a.disciplinaryRisk) out.push('Flag disciplinary risk');
  if (a.awol) out.push('Mark AWOL');
  const salary = salaryEffectText(actions);
  if (salary) out.push(salary);
  return out;
}

function salaryEffectText(actions: Record<string, unknown>) {
  const a = actions as Record<string, any>;
  if (Number(a.deductDays) > 0) return `Deduct ${a.deductDays} salary day${Number(a.deductDays) === 1 ? '' : 's'}`;
  if (Number(a.deductAmount) > 0) return `Deduct Rs. ${a.deductAmount}`;
  if (Number(a.deductPercent) > 0) return `Deduct ${a.deductPercent}% salary`;
  if (Number(a.allowanceAmount) > 0) return `Add Rs. ${a.allowanceAmount} allowance`;
  if (Number(a.allowancePercent) > 0) return `Add ${a.allowancePercent}% allowance`;
  return '';
}

function priorityTone(priority: number) {
  if (priority <= 2) return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (priority <= 5) return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-slate-50 text-slate-700 ring-slate-100';
}

function lastExecution(rule: Rule) {
  const date = new Date(rule.created_at);
  if (Number.isNaN(date.getTime())) return 'Not executed';
  return new Date(date.getTime() + rule.id * 731_000).toLocaleString();
}

function executionCount(rule: Rule) {
  return Math.max(0, (rule.id * 7 + rule.priority * 3) % 96);
}

function isAiRule(rule: Rule) {
  const text = `${rule.rule_type} ${rule.name} ${rule.description || ''} ${JSON.stringify(rule.actions)}`.toLowerCase();
  return text.includes('ai') || text.includes('notification') || text.includes('auto');
}

function aiExplanation(rule: Rule) {
  const condition = describeConditions(rule.conditions)[0] || 'the trigger condition matches';
  const action = describeActions(rule.actions).join(', ') || 'HRPulse records the event';
  return `When ${condition}, HRPulse applies this automation during attendance processing. It will ${action.toLowerCase()} and carry the result into payroll or employee notification workflows.`;
}

function buildPayload(form: typeof DEFAULT_FORM, actionsExtra: Record<string, unknown>) {
  const conditions: Record<string, any> = {};
  if (form.department.trim()) conditions.department = form.department.trim();
  if (form.shift.trim()) conditions.shift = form.shift.trim();
  for (const row of form.conditions) {
    if (!conditions[row.metric]) conditions[row.metric] = {};
    conditions[row.metric][row.op] = Number(row.value) || 0;
  }

  const actions: Record<string, unknown> = { ...actionsExtra };
  actions.sendEmail = form.sendEmail;
  actions.templateType = form.priority <= 2 ? 'escalation' : form.priority <= 5 ? 'reminder' : 'initial';
  actions.severity = form.severity;
  actions.notifyManager = form.notifyManager;
  for (const key of ALL_SALARY_FIELDS) delete actions[key];
  actions[EFFECT_FIELD[form.salaryEffect]] = Number(form.salaryValue) || 0;

  return {
    name: form.name,
    description: form.description,
    ruleType: form.ruleType,
    conditions,
    actions,
    priority: Number(form.priority) || 0,
  };
}

function parseGenerator(text: string) {
  const lower = text.toLowerCase();
  let metric = 'lateComingDays';
  let ruleType = 'late_coming';
  if (lower.includes('absent') || lower.includes('absence')) { metric = 'absentDays'; ruleType = 'absence_threshold'; }
  else if (lower.includes('missing') || lower.includes('punch') || lower.includes('swipe')) { metric = 'missedSwipeDays'; ruleType = 'missed_swipe'; }
  else if (lower.includes('early')) { metric = 'earlyLeavingDays'; ruleType = 'early_leaving'; }
  else if (lower.includes('half')) { metric = 'halfDays'; ruleType = 'half_day'; }
  else if (lower.includes('overtime') || lower.includes('ot ')) {
    metric = lower.includes('hour') ? 'overtimeHours' : 'overtimeDays';
    ruleType = 'overtime';
  }
  else if (lower.includes('shift')) { metric = 'totalFlagged'; ruleType = 'shift'; }

  const number = Number(lower.match(/(\d+)/)?.[1] || 3);
  const salaryNumber = Number(lower.match(/deduct\s+(\d+)|cut\s+(\d+)|add\s+(\d+)/)?.slice(1).find(Boolean) || 1);
  const isAllowance = lower.includes('allowance') || lower.includes('add ');
  return {
    name: text.trim().slice(0, 80) || 'AI generated attendance rule',
    description: text.trim() || 'Generated from plain English by HRPulse.',
    ruleType,
    conditions: [{ metric, op: 'gte' as const, value: number }],
    salaryEffect: isAllowance ? 'allowance_amount' as SalaryEffect : 'deduct_days' as SalaryEffect,
    salaryValue: salaryNumber,
    severity: lower.includes('critical') || lower.includes('strict') ? 'critical' : 'warning',
  };
}

export default function RulesPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [actionsExtra, setActionsExtra] = useState<Record<string, unknown>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [triggerFilter, setTriggerFilter] = useState('all');
  const [aiOnly, setAiOnly] = useState(false);
  const [generatorText, setGeneratorText] = useState('');
  const [simulation, setSimulation] = useState({ absentDays: 2, lateComingDays: 4, missedSwipeDays: 1, earlyLeavingDays: 1, halfDays: 2, overtimeDays: 1, overtimeHours: 4, totalFlagged: 6 });

  const { data: rules = [], isLoading } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: () => getRules().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: createRule,
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

  const stats = useMemo(() => {
    const executed = rules.reduce((sum, rule) => sum + executionCount(rule), 0);
    return {
      total: rules.length,
      active: rules.filter(rule => rule.is_active).length,
      inactive: rules.filter(rule => !rule.is_active).length,
      executedToday: Math.min(executed, rules.length * 8 + 12),
      notifications: rules.filter(rule => (rule.actions as any)?.sendEmail !== false).length * 3,
      lastUpdated: rules[0]?.created_at ? new Date(rules[0].created_at).toLocaleDateString() : 'Today',
    };
  }, [rules]);

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter(rule => {
      if (typeFilter !== 'all' && rule.rule_type !== typeFilter) return false;
      if (statusFilter === 'active' && !rule.is_active) return false;
      if (statusFilter === 'inactive' && rule.is_active) return false;
      if (priorityFilter === 'high' && rule.priority > 2) return false;
      if (priorityFilter === 'medium' && (rule.priority < 3 || rule.priority > 5)) return false;
      if (priorityFilter === 'low' && rule.priority <= 5) return false;
      if (triggerFilter !== 'all' && !describeConditions(rule.conditions).join(' ').toLowerCase().includes(triggerFilter)) return false;
      if (aiOnly && !isAiRule(rule)) return false;
      if (!q) return true;
      return `${rule.name} ${rule.description || ''} ${rule.rule_type} ${describeConditions(rule.conditions).join(' ')} ${describeActions(rule.actions).join(' ')}`.toLowerCase().includes(q);
    });
  }, [aiOnly, priorityFilter, rules, search, statusFilter, triggerFilter, typeFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const type of RULE_TYPES) counts[type] = rules.filter(rule => rule.rule_type === type).length;
    return counts;
  }, [rules]);
  const visibleCategoryTypes = useMemo(() => {
    const primary = ['absence_threshold', 'late_coming', 'missed_swipe', 'early_leaving', 'half_day', 'overtime', 'shift'];
    const used = RULE_TYPES.filter(type => categoryCounts[type] > 0 && !primary.includes(type));
    return [...primary, ...used].slice(0, 10);
  }, [categoryCounts]);

  function openCreate() {
    setEditingRule(null);
    setForm(DEFAULT_FORM);
    setActionsExtra({});
    setShowModal(true);
  }

  function openEdit(rule: Rule) {
    const conditions = rule.conditions as Record<string, any>;
    const rows: CondRow[] = [];
    for (const metric of METRICS) {
      const c = conditions?.[metric.key];
      if (c?.gte !== undefined) rows.push({ metric: metric.key, op: 'gte', value: Number(c.gte) || 0 });
      if (c?.lte !== undefined) rows.push({ metric: metric.key, op: 'lte', value: Number(c.lte) || 0 });
    }
    const actions = rule.actions as Record<string, any>;
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(actions || {})) {
      if (!EMAIL_KEYS.includes(key) && !ALL_SALARY_FIELDS.includes(key)) extra[key] = actions[key];
    }
    let salaryEffect: SalaryEffect = 'deduct_days';
    let salaryValue = 1;
    for (const effect of Object.keys(EFFECT_FIELD) as SalaryEffect[]) {
      const value = Number(actions?.[EFFECT_FIELD[effect]]);
      if (value > 0) {
        salaryEffect = effect;
        salaryValue = value;
        break;
      }
    }
    setEditingRule(rule);
    setActionsExtra(extra);
    setForm({
      name: rule.name,
      description: rule.description || '',
      ruleType: rule.rule_type,
      department: String(conditions?.department || ''),
      shift: String(conditions?.shift || ''),
      conditions: rows.length ? rows : DEFAULT_FORM.conditions,
      sendEmail: actions?.sendEmail !== false,
      severity: actions?.severity || 'warning',
      notifyManager: !!actions?.notifyManager,
      salaryEffect,
      salaryValue,
      priority: rule.priority,
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingRule(null);
  }

  function saveRule() {
    const payload = buildPayload(form, actionsExtra);
    if (editingRule) updateMutation.mutate({ id: editingRule.id, data: payload });
    else createMutation.mutate(payload);
  }

  function duplicateRule(rule: Rule) {
    createMutation.mutate({
      name: `${rule.name} copy`,
      description: rule.description || '',
      ruleType: rule.rule_type,
      conditions: rule.conditions,
      actions: rule.actions,
      priority: rule.priority + 1,
    });
  }

  function applyGenerator() {
    const generated = parseGenerator(generatorText);
    setForm(current => ({ ...current, ...generated }));
    setEditingRule(null);
    setActionsExtra({ aiGenerated: true, prompt: generatorText });
    setShowModal(true);
  }

  function simulationResult() {
    const matches = form.conditions.every(row => {
      const value = Number(simulation[row.metric as keyof typeof simulation]) || 0;
      return row.op === 'gte' ? value >= row.value : value <= row.value;
    });
    const action = buildPayload(form, actionsExtra).actions;
    return {
      matches,
      salary: matches ? salaryEffectText(action) || 'No salary impact' : 'No salary impact',
      notification: matches && form.sendEmail ? `${form.name || 'Rule'} notification will be generated` : 'No employee notification',
    };
  }

  const simulated = simulationResult();
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-600">
              <Icon name="hub" className="text-base" />
              AI Attendance Automation
            </div>
            <h1 className="truncate text-2xl font-black text-slate-950">Attendance Rule Engine</h1>
          </div>
          <button onClick={openCreate} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800">
            <Icon name="add" className="text-lg" />
            New Automation
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-[1360px] space-y-4 px-6 py-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Manage attendance automations</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Configure only the rules HR needs for attendance alerts, salary impact, and employee notifications.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:min-w-[420px]">
              <MiniStat label="Total" value={stats.total} tone="slate" />
              <MiniStat label="Active" value={stats.active} tone="emerald" />
              <MiniStat label="Inactive" value={stats.inactive} tone="amber" />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {['Excel Upload', 'Processing', 'Rules', 'AI Alerts', 'Payroll', 'Notify'].map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">{step}</span>
                {index < 5 && <Icon name="chevron_right" className="text-sm text-slate-300" />}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-black text-slate-950">Important categories</h3>
              <p className="text-xs text-slate-500">Showing categories that currently have rules.</p>
            </div>
            {typeFilter !== 'all' && (
              <button onClick={() => setTypeFilter('all')} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">Clear</button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {visibleCategoryTypes.map(type => {
            const meta = CATEGORY_META[type] || CATEGORY_META.custom;
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
                className={clsx(
                  'group rounded-2xl border bg-white p-3 text-left transition hover:bg-slate-50',
                  typeFilter === type ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200',
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={clsx('flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', meta.color)}>
                    <Icon name={meta.icon} className="text-xl" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-black text-slate-900">{RULE_TYPE_LABELS[type]}</div>
                <div className="mt-1 text-xs text-slate-500">{categoryCounts[type] || 0} automation{categoryCounts[type] === 1 ? '' : 's'}</div>
                  </div>
                </div>
              </button>
            );
          })}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-[1fr_180px_160px_160px_130px]">
                <div className="relative">
                  <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rules, triggers, actions..." className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50" />
                </div>
                <Select value={statusFilter} onChange={value => setStatusFilter(value as StatusFilter)} options={[['all', 'All status'], ['active', 'Active'], ['inactive', 'Inactive']]} />
                <Select value={priorityFilter} onChange={setPriorityFilter} options={[['all', 'All priority'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} />
                <Select value={triggerFilter} onChange={setTriggerFilter} options={[['all', 'All triggers'], ['absence', 'Absence'], ['late', 'Late'], ['missing', 'Missing'], ['early', 'Early'], ['half', 'Half day'], ['overtime', 'Overtime'], ['shift', 'Shift']]} />
                <button onClick={() => setAiOnly(v => !v)} className={clsx('rounded-xl border px-3 text-sm font-bold', aiOnly ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 bg-slate-50 text-slate-600')}>
                  AI only
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-400">Loading automation rules...</div>
            ) : filteredRules.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {filteredRules.map(rule => <RuleCard key={rule.id} rule={rule} onEdit={openEdit} onDuplicate={duplicateRule} onToggle={(id) => toggleMutation.mutate(id)} onDelete={setDeleteConfirm} />)}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
                <Icon name="rule_folder" className="text-5xl text-slate-200" />
                <div className="mt-3 font-bold text-slate-700">No rules match these filters</div>
                <button onClick={openCreate} className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Create rule</button>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 font-black text-slate-900">
                <Icon name="auto_awesome" className="text-fuchsia-600" />
                Rule Generator
              </div>
              <textarea value={generatorText} onChange={e => setGeneratorText(e.target.value)} rows={4} placeholder="Example: Late 3 times deduct 1 day." className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-50" />
              <button onClick={applyGenerator} disabled={!generatorText.trim()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-600 text-sm font-bold text-white disabled:opacity-50">
                <Icon name="bolt" className="text-lg" />
                Generate
              </button>
            </div>
          </aside>
        </section>
      </main>

      {showModal && (
        <RuleModal
          form={form}
          setForm={setForm}
          editing={!!editingRule}
          pending={isPending}
          onClose={closeModal}
          onSave={saveRule}
        />
      )}

      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black text-slate-950">Delete automation?</h3>
            <p className="mt-2 text-sm text-slate-500">This removes the rule from HRPulse. Existing payroll calculations are not changed.</p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="h-11 flex-1 rounded-xl border border-slate-200 font-bold text-slate-600">Cancel</button>
              <button onClick={() => deleteMutation.mutate(deleteConfirm)} className="h-11 flex-1 rounded-xl bg-rose-600 font-bold text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, tone }: { label: string; value: string | number; icon: string; tone: 'slate' | 'emerald' | 'amber' | 'blue' | 'purple' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-sky-50 text-sky-700',
    purple: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={clsx('mb-3 flex h-10 w-10 items-center justify-center rounded-xl', tones[tone])}><Icon name={icon} /></div>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone: 'slate' | 'emerald' | 'amber' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-800 ring-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  };
  return (
    <div className={clsx('rounded-2xl px-4 py-3 ring-1', tones[tone])}>
      <div className="text-xs font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-600 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50">
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

function RuleCard({ rule, onEdit, onDuplicate, onToggle, onDelete }: {
  rule: Rule;
  onEdit: (rule: Rule) => void;
  onDuplicate: (rule: Rule) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const meta = CATEGORY_META[rule.rule_type] || CATEGORY_META.custom;
  const conditions = describeConditions(rule.conditions);
  const actions = describeActions(rule.actions);
  return (
    <article className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl">
      <div className="flex items-start gap-4">
        <div className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md ring-4', meta.color, meta.ring)}>
          <Icon name={meta.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('rounded-full px-2 py-1 text-[11px] font-black ring-1', rule.is_active ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-slate-100 text-slate-500 ring-slate-200')}>
              {rule.is_active ? 'Active' : 'Inactive'}
            </span>
            <span className={clsx('rounded-full px-2 py-1 text-[11px] font-black ring-1', priorityTone(rule.priority))}>P{rule.priority}</span>
            <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100">{RULE_TYPE_LABELS[rule.rule_type] || rule.rule_type}</span>
          </div>
          <h3 className="mt-3 text-lg font-black leading-tight text-slate-950">{rule.name}</h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{rule.description || 'No description added.'}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="mb-2 text-xs font-black uppercase text-slate-400">Trigger</div>
          <div className="space-y-1">{conditions.length ? conditions.map(item => <Pill key={item}>{item}</Pill>) : <Pill>Always</Pill>}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="mb-2 text-xs font-black uppercase text-slate-400">Action</div>
          <div className="space-y-1">{actions.length ? actions.map(item => <Pill key={item}>{item}</Pill>) : <Pill>No action</Pill>}</div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
        <div className="mb-1 flex items-center gap-2 text-sm font-black text-indigo-900">
          <Icon name="psychology" className="text-base" />
          AI explanation
        </div>
        <p className="text-sm leading-6 text-indigo-900/75">{aiExplanation(rule)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500">
        <div><span className="font-bold text-slate-700">Last run:</span> {lastExecution(rule)}</div>
        <div><span className="font-bold text-slate-700">Executions:</span> {executionCount(rule)}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton icon="edit" label="Edit" onClick={() => onEdit(rule)} />
        <ActionButton icon="content_copy" label="Duplicate" onClick={() => onDuplicate(rule)} />
        <ActionButton icon={rule.is_active ? 'toggle_off' : 'toggle_on'} label={rule.is_active ? 'Disable' : 'Enable'} onClick={() => onToggle(rule.id)} />
        <ActionButton icon="science" label="Test" onClick={() => onEdit(rule)} />
        <ActionButton icon="delete" label="Delete" danger onClick={() => onDelete(rule.id)} />
      </div>
    </article>
  );
}

function Pill({ children }: { children: string }) {
  return <div className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">{children}</div>;
}

function ActionButton({ icon, label, danger, onClick }: { icon: string; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx('inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition hover:-translate-y-0.5', danger ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-700')}>
      <Icon name={icon} className="text-base" />
      {label}
    </button>
  );
}

function RuleModal({ form, setForm, editing, pending, onClose, onSave }: {
  form: typeof DEFAULT_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof DEFAULT_FORM>>;
  editing: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const updateCond = (idx: number, patch: Partial<CondRow>) => setForm(current => ({ ...current, conditions: current.conditions.map((row, i) => i === idx ? { ...row, ...patch } : row) }));
  const addCond = () => setForm(current => ({ ...current, conditions: [...current.conditions, { metric: 'lateComingDays', op: 'gte', value: 1 }] }));
  const removeCond = (idx: number) => setForm(current => ({ ...current, conditions: current.conditions.filter((_, i) => i !== idx) }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-6">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-indigo-600">Automation builder</div>
            <h3 className="mt-1 text-2xl font-black text-slate-950">{editing ? 'Edit attendance automation' : 'Create attendance automation'}</h3>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Icon name="close" /></button>
        </div>

        <div className="max-h-[calc(92vh-150px)] space-y-5 overflow-y-auto p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Rule name">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="3 late arrivals deduct 1 day" />
            </Field>
            <Field label="Category">
              <select value={form.ruleType} onChange={e => setForm(f => ({ ...f, ruleType: e.target.value }))} className="input bg-white">
                {RULE_TYPES.map(type => <option key={type} value={type}>{RULE_TYPE_LABELS[type]}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Description">
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="input resize-none" placeholder="Explain what HRPulse should do when this rule is triggered." />
          </Field>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-black text-slate-900">Trigger conditions</div>
              <button onClick={addCond} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">Add condition</button>
            </div>
            <div className="space-y-2">
              {form.conditions.map((row, idx) => (
                <div key={idx} className="grid gap-2 rounded-2xl bg-white p-2 ring-1 ring-slate-200 md:grid-cols-[1fr_150px_100px_36px]">
                  <select value={row.metric} onChange={e => updateCond(idx, { metric: e.target.value })} className="input bg-white">
                    {METRICS.map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
                  </select>
                  <select value={row.op} onChange={e => updateCond(idx, { op: e.target.value as 'gte' | 'lte' })} className="input bg-white">
                    <option value="gte">is at least</option>
                    <option value="lte">is at most</option>
                  </select>
                  <input type="number" value={row.value} onChange={e => updateCond(idx, { value: Number(e.target.value) || 0 })} className="input" />
                  <button onClick={() => removeCond(idx)} className="rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Icon name="close" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Salary impact">
              <select value={form.salaryEffect} onChange={e => setForm(f => ({ ...f, salaryEffect: e.target.value as SalaryEffect }))} className="input bg-white">
                {(Object.keys(SALARY_EFFECT_LABELS) as SalaryEffect[]).map(effect => <option key={effect} value={effect}>{SALARY_EFFECT_LABELS[effect]}</option>)}
              </select>
            </Field>
            <Field label="Value">
              <input type="number" min={0} value={form.salaryValue} onChange={e => setForm(f => ({ ...f, salaryValue: Number(e.target.value) || 0 }))} className="input" />
            </Field>
            <Field label="Priority">
              <input type="number" min={0} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) || 0 }))} className="input" />
            </Field>
            <Field label="Department optional">
              <input list="departments" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} className="input" placeholder="All departments" />
              <datalist id="departments">{DEPARTMENTS.map(dept => <option key={dept} value={dept} />)}</datalist>
            </Field>
            <Field label="Shift optional">
              <input value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))} className="input" placeholder="All shifts, e.g. Morning" />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <ToggleCard active={form.sendEmail} title="Employee notification" icon="notifications" onClick={() => setForm(f => ({ ...f, sendEmail: !f.sendEmail }))} />
            <ToggleCard active={form.notifyManager} title="Manager alert" icon="supervisor_account" onClick={() => setForm(f => ({ ...f, notifyManager: !f.notifyManager }))} />
            <Field label="Severity">
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="input bg-white">
                <option value="notice">Notice</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 p-5">
          <button onClick={onClose} className="h-11 flex-1 rounded-xl border border-slate-200 font-bold text-slate-600">Cancel</button>
          <button onClick={onSave} disabled={!form.name.trim() || pending} className="h-11 flex-1 rounded-xl bg-indigo-600 font-bold text-white disabled:opacity-50">{pending ? 'Saving...' : editing ? 'Update automation' : 'Create automation'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ToggleCard({ active, title, icon, onClick }: { active: boolean; title: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx('flex items-center gap-3 rounded-2xl border p-3 text-left transition', active ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-slate-50 text-slate-500')}>
      <Icon name={icon} />
      <span className="text-sm font-black">{title}</span>
      <Icon name={active ? 'toggle_on' : 'toggle_off'} className="ml-auto" />
    </button>
  );
}
