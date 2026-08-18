/**
 * Rule Execution Flow — visual workflow section at the bottom of Rule Management.
 *
 * Business-process-automation view of the rule pipeline:
 *  - Summary strip: active rules, current sequence, avg execution time, runs today
 *  - Horizontal workflow cards connected by directional arrows, ordered by
 *    execution priority (highest priority first — matching the engine)
 *  - Circular priority badge, status badge, last run + execution count per card
 *  - Hover reveals additional details; "executing now" gets an animated pulse
 *  - Native HTML5 drag-and-drop reordering + "Recalculate Priorities"
 *  - Legend explaining status colors and execution order
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import type { RuleRow } from '../../api/rulesEngine';
import { saveRulePriorities, type RuleStatsSummary, type FlowRule, buildExecutionFlow } from '../../api/ruleFlowApi';

// ─────────────────────────────────────────────────────────────────────────────
// Props & metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleExecutionFlowProps {
  rules: RuleRow[];
  stats?: RuleStatsSummary | null;
  actor: string;
  onRuleClick?: (rule: RuleRow) => void;
  onChanged?: () => void;
  onToast?: (msg: string) => void;
}

const STATUS_META: Record<FlowRule['status'], { label: string; chip: string; dot: string; ring: string }> = {
  active:    { label: 'Active',    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',   dot: 'bg-emerald-500', ring: 'border-emerald-300' },
  inactive:  { label: 'Inactive',  chip: 'bg-red-50 text-red-600 border-red-200',               dot: 'bg-red-500',     ring: 'border-red-300' },
  pending:   { label: 'Pending',   chip: 'bg-orange-50 text-orange-600 border-orange-200',      dot: 'bg-orange-500',  ring: 'border-orange-300' },
  scheduled: { label: 'Scheduled', chip: 'bg-blue-50 text-blue-600 border-blue-200',            dot: 'bg-blue-500',    ring: 'border-blue-300' },
};

/** Priority badge gradients — P1 strongest. */
const PRIORITY_GRADIENTS = [
  'from-rose-500 to-red-500',      // 1
  'from-orange-500 to-amber-500',  // 2
  'from-amber-400 to-yellow-500',  // 3
  'from-emerald-500 to-teal-500',  // 4
  'from-teal-500 to-cyan-500',     // 5
  'from-sky-500 to-blue-500',      // 6
  'from-blue-500 to-indigo-500',   // 7+
];
const priorityGradient = (pos: number) => PRIORITY_GRADIENTS[Math.min(pos - 1, PRIORITY_GRADIENTS.length - 1)];

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow card
// ─────────────────────────────────────────────────────────────────────────────

function FlowCard({
  flow, isExecuting, isDragged, isDropTarget, onDragStart, onDragEnter, onDragEnd, onClick,
}: {
  flow: FlowRule;
  isExecuting: boolean;
  isDragged: boolean;
  isDropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const sm = STATUS_META[flow.status];
  const { rule, stat } = flow;
  const successRate = stat && stat.count > 0 ? Math.round((stat.success / stat.count) * 100) : null;

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => e.preventDefault()}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${rule.name} — priority ${rule.priority}. ${rule.description ?? ''}`}
      className={clsx(
        'group relative shrink-0 w-[200px] rounded-2xl border bg-white p-3.5 cursor-pointer select-none',
        'transition-all duration-200 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-indigo-100/60',
        isDragged && 'opacity-40 scale-95',
        isDropTarget && 'ring-2 ring-indigo-400 ring-offset-2',
        isExecuting ? 'border-indigo-400 shadow-lg shadow-indigo-200/60' : 'border-slate-200/90 shadow-sm',
      )}
    >
      {/* executing-now pulse */}
      {isExecuting && (
        <span className="absolute -top-2 -right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold shadow-md z-10">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
          LIVE
        </span>
      )}
      {isExecuting && <span className="absolute inset-0 rounded-2xl animate-pulse bg-indigo-50/40 pointer-events-none" aria-hidden="true" />}

      {/* priority badge */}
      <div className="flex items-start justify-between">
        <span
          className={clsx(
            'w-9 h-9 rounded-full bg-gradient-to-br text-white flex items-center justify-center font-extrabold text-sm shadow-md',
            priorityGradient(flow.position),
          )}
          title={`Priority ${flow.position} — executes ${flow.position === 1 ? 'first' : `${ordinal(flow.position)}`}`}
        >
          {flow.position}
        </span>
        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-semibold', sm.chip)} title={sm.label}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', sm.dot)} />
          {sm.label}
        </span>
      </div>

      {/* name + category */}
      <p className="mt-2.5 text-[13px] font-bold text-slate-800 leading-snug line-clamp-2 min-h-[34px]">{rule.name}</p>
      <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1 truncate">
        <span className="material-icons text-[12px]">category</span>
        {rule.rule_categories?.name ?? rule.rule_type}
      </p>

      {/* stats row */}
      <div className="mt-2.5 pt-2.5 border-t border-slate-100/80 grid grid-cols-2 gap-1.5 text-[10.5px]">
        <span className="text-slate-500 flex items-center gap-1" title={`Last executed ${stat?.lastExecutedAt ? new Date(stat.lastExecutedAt).toLocaleString() : 'never'}`}>
          <span className="material-icons text-[12px] text-slate-300">schedule</span>{timeAgo(stat?.lastExecutedAt)}
        </span>
        <span className="text-slate-500 flex items-center gap-1 justify-end" title={`${stat?.count ?? 0} executions in the last 30 days`}>
          <span className="material-icons text-[12px] text-indigo-300">bolt</span>{stat?.count ?? 0} runs
        </span>
      </div>

      {/* hover detail overlay */}
      <div
        className={clsx(
          'absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-600/95 to-purple-700/95 text-white p-3.5',
          'flex flex-col justify-center gap-1.5 transition-all duration-200',
          hover ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
        )}
      >
        <p className="text-[12px] font-bold leading-snug line-clamp-2">{rule.name}</p>
        <p className="text-[10.5px] text-indigo-100 line-clamp-3 leading-relaxed">{rule.description || 'No description available.'}</p>
        <div className="mt-1 space-y-1 text-[10.5px]">
          <p className="flex justify-between"><span className="text-indigo-200">Priority</span><span className="font-bold">P{rule.priority} (step {flow.position})</span></p>
          <p className="flex justify-between"><span className="text-indigo-200">Success rate</span><span className="font-bold">{successRate !== null ? `${successRate}%` : '—'}</span></p>
          <p className="flex justify-between"><span className="text-indigo-200">Avg time</span><span className="font-bold">{stat?.avgDurationMs ? `${stat.avgDurationMs}ms` : '—'}</span></p>
          <p className="flex justify-between"><span className="text-indigo-200">Mode</span><span className="font-bold capitalize">{rule.execution_mode}</span></p>
          <p className="flex justify-between"><span className="text-indigo-200">Runs today</span><span className="font-bold">{stat?.executedToday ?? 0}</span></p>
        </div>
        <p className="mt-1.5 text-[9.5px] text-indigo-200 flex items-center gap-1 border-t border-white/20 pt-1.5">
          <span className="material-icons text-[11px]">drag_indicator</span>Drag to reorder execution
        </p>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main section
// ─────────────────────────────────────────────────────────────────────────────

export default function RuleExecutionFlow({
  rules, stats, actor, onRuleClick, onChanged, onToast,
}: RuleExecutionFlowProps) {
  // local order — rebuilt from props whenever rules change upstream
  const [order, setOrder] = useState<FlowRule[]>([]);
  const flowFromProps = useMemo(() => buildExecutionFlow(rules, stats), [rules, stats]);
  const rulesVersionRef = useRef(rules);
  useEffect(() => {
    rulesVersionRef.current = rules;
    setOrder(flowFromProps);
  }, [flowFromProps, rules]);

  // drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  // "currently executing" simulation — cycles through active rules
  const activeOrder = order.filter((f) => f.status === 'active' || f.status === 'scheduled' || f.status === 'pending');
  const [execIndex, setExecIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setExecIndex((i) => i + 1), 3000);
    return () => window.clearInterval(id);
  }, []);
  const executingRuleId = activeOrder.length ? activeOrder[execIndex % activeOrder.length].rule.id : null;

  // persist reordered priorities
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Priority DESC execution: first card keeps the highest priority.
      const base = 100;
      const updates = order.map((f, i) => ({ id: f.rule.id, priority: Math.max(1, base - i * 10) }));
      await saveRulePriorities(updates, actor);
    },
    onSuccess: () => {
      setDirty(false);
      onChanged?.();
      onToast?.('Execution order saved — priorities recalculated (100, 90, 80…)');
    },
    onError: (e) => onToast?.(`Failed to save order: ${e instanceof Error ? e.message : String(e)}`),
  });

  // drag handlers
  const handleDragStart = (idx: number) => setDragIndex(idx);
  const handleDragEnter = (idx: number) => {
    if (dragIndex === null || dragIndex === idx) { setOverIndex(idx); return; }
    setOverIndex(idx);
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIndex(idx);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
    setDirty(true);
  };

  // summary numbers
  const activeCount = rules.filter((r) => r.is_active).length;
  const sequenceLabel = order.length
    ? order.slice(0, 6).map((f) => shortName(f.rule.name)).join(' → ') + (order.length > 6 ? ' → …' : '')
    : 'No rules yet';
  const avgMs = stats?.avgExecutionMs ?? 0;
  const runsToday = stats?.executedToday ?? 0;

  const summaryCards = [
    { icon: 'check_circle', label: 'Total Active Rules', value: String(activeCount), tone: 'bg-emerald-50 text-emerald-600' },
    { icon: 'route',        label: 'Execution Sequence', value: sequenceLabel, tone: 'bg-indigo-50 text-indigo-600', wide: true },
    { icon: 'speed',        label: 'Avg Execution Time', value: avgMs > 0 ? `${avgMs} ms` : '—', tone: 'bg-amber-50 text-amber-600' },
    { icon: 'bolt',         label: 'Executions Today', value: runsToday.toLocaleString(), tone: 'bg-purple-50 text-purple-600' },
  ];

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      {/* ─── Header ─── */}
      <div className="px-4 sm:px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50/70 via-white to-indigo-50/40 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-200 shrink-0">
            <span className="material-icons text-white text-xl">account_tree</span>
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 flex-wrap">
              Rule Execution Flow
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 text-[10.5px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Engine Live
              </span>
            </h3>
            <p className="text-[12px] text-slate-400">Rules execute left → right by priority. Hover a card for details, drag to reorder.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && (
            <button onClick={() => { setOrder(flowFromProps); setDirty(false); }} className="px-3 py-2 rounded-xl border border-slate-200 text-[12.5px] font-semibold text-slate-500 hover:bg-slate-50" title="Revert to saved order">
              Reset
            </button>
          )}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
            title="Persist the new execution order — priorities are reassigned automatically (100, 90, 80…)"
            className={clsx(
              'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all',
              dirty && !saveMutation.isPending
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-200 hover:shadow-lg hover:-translate-y-px'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed',
            )}
          >
            <span className="material-icons text-[17px]">{saveMutation.isPending ? 'hourglass_top' : 'autorenew'}</span>
            {saveMutation.isPending ? 'Saving…' : 'Recalculate Priorities'}
          </button>
        </div>
      </div>

      {/* ─── Summary strip ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/40">
        {summaryCards.map((c) => (
          <div key={c.label} className={clsx('rounded-xl bg-white border border-slate-100 p-3 flex items-center gap-3 hover:shadow-sm transition-shadow', c.wide && 'sm:col-span-2 xl:col-span-1')}>
            <span className={clsx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', c.tone)}>
              <span className="material-icons text-[19px]">{c.icon}</span>
            </span>
            <div className="min-w-0">
              <p className={clsx('text-[13px] font-bold text-slate-800 truncate', c.wide && 'text-[11.5px] font-semibold whitespace-nowrap overflow-hidden')}>{c.value}</p>
              <p className="text-[10.5px] text-slate-400">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Flow canvas ─── */}
      <div className="p-4 sm:p-6 overflow-x-auto">
        {order.length === 0 ? (
          <div className="py-14 text-center">
            <span className="material-icons block text-5xl text-slate-200 mb-2">account_tree</span>
            <p className="text-sm font-medium text-slate-400">No rules yet — create a rule to start building the execution flow.</p>
          </div>
        ) : (
          <div className="flex items-stretch gap-0 min-w-max">
            {order.map((f, idx) => (
              <div key={f.rule.id} className="flex items-stretch">
                <FlowCard
                  flow={f}
                  isExecuting={executingRuleId === f.rule.id}
                  isDragged={dragIndex === idx}
                  isDropTarget={overIndex === idx && dragIndex !== null && dragIndex !== idx}
                  onDragStart={() => handleDragStart(idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onRuleClick?.(f.rule)}
                />
                {idx < order.length - 1 && (
                  <div className="flex items-center justify-center w-9 shrink-0" title="Execution order — flows left to right" aria-hidden="true">
                    <div className="relative flex items-center justify-center">
                      <span className="absolute w-full h-[2px] bg-gradient-to-r from-slate-200 via-indigo-300 to-slate-200" />
                      <span className="relative w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-sm shadow-indigo-200">
                        <span className="material-icons text-white text-[14px]">arrow_forward</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Legend ─── */}
      <div className="px-4 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/40 flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Legend</span>
        {(['active', 'inactive', 'pending', 'scheduled'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
            <span className={clsx('w-2.5 h-2.5 rounded-full', STATUS_META[s].dot)} />
            {STATUS_META[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
          <span className="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center">
            <span className="material-icons text-white text-[10px]">arrow_forward</span>
          </span>
          Execution order
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
          <span className="w-4 h-4 rounded-full bg-gradient-to-br from-rose-500 to-red-500 text-white text-[8px] font-extrabold flex items-center justify-center">1</span>
          Priority badge — lower step executes first
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
          <span className="relative flex w-2.5 h-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500" />
          </span>
          Executing now (live)
        </span>
        <span className="ml-auto text-[11px] text-slate-400 hidden lg:block">
          Priorities persist as 100, 90, 80… — highest priority executes first
        </span>
      </div>
    </section>
  );
}

/** Shorten a rule name for the sequence summary ("Holiday Rule — …" → "Holiday Rule"). */
function shortName(name: string): string {
  const head = name.split(/[—-]/)[0].trim();
  return head.length > 18 ? `${head.slice(0, 18)}…` : head;
}