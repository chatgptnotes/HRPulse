/**
 * All Rules — enterprise rule repository panel (left side of Rule Management).
 *
 * Premium management surface for hundreds of business rules:
 *  - Prominent search + advanced filters (category / date modified)
 *  - Rules rendered as cards grouped into collapsible category accordions
 *  - Per-card execution statistics, origin badges and quick actions
 *    (edit, clone, history, test, activate/deactivate, delete)
 *  - Bulk selection with activate / deactivate / export / delete
 *  - Pagination with page numbers and total count
 *
 * The panel is presentational: all mutations live in the parent
 * (RuleManagementTab) and are passed in as callbacks.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  fetchVersions, exportRules,
  type RuleRow, type RuleVersionRow,
} from '../../api/rulesEngine';
import type { RuleStatsSummary, RuleStat } from '../../api/ruleFlowApi';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface AllRulesPanelProps {
  rules: RuleRow[];
  isLoading?: boolean;
  stats?: RuleStatsSummary | null;
  selectedRuleId?: number | null;
  onCreateRule: () => void;
  onEditRule: (rule: RuleRow) => void;
  onCloneRule: (rule: RuleRow) => void;
  onTestRule: (rule: RuleRow) => void;
  onToggleRule: (rule: RuleRow) => void;
  onDeleteRule: (rule: RuleRow) => void;
  onBulkActivate: (ids: number[]) => void;
  onBulkDeactivate: (ids: number[]) => void;
  onBulkDelete: (ids: number[]) => void;
  bulkPending?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status / category / origin metadata
// ─────────────────────────────────────────────────────────────────────────────

type DerivedStatus = 'active' | 'inactive' | 'pending' | 'scheduled';

const STATUS_META: Record<DerivedStatus, { label: string; chip: string; dot: string; tooltip: string }> = {
  active:     { label: 'Active',     chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',   dot: 'bg-emerald-500', tooltip: 'Rule is live and evaluated on every run' },
  inactive:   { label: 'Inactive',   chip: 'bg-red-50 text-red-600 border-red-200',               dot: 'bg-red-500',     tooltip: 'Rule is switched off and skipped by the engine' },
  pending:    { label: 'Pending',    chip: 'bg-orange-50 text-orange-600 border-orange-200',      dot: 'bg-orange-500',  tooltip: 'Last execution failed — pending review' },
  scheduled:  { label: 'Scheduled',  chip: 'bg-blue-50 text-blue-600 border-blue-200',            dot: 'bg-blue-500',    tooltip: 'Runs asynchronously in the background queue' },
};

function deriveStatus(rule: RuleRow, stat?: RuleStat): DerivedStatus {
  if (!rule.is_active) return 'inactive';
  if (stat?.lastStatus === 'failed') return 'pending';
  if (rule.execution_mode === 'async') return 'scheduled';
  return 'active';
}

const CATEGORY_META: Record<string, { label: string; icon: string; chip: string; bar: string }> = {
  attendance:  { label: 'Attendance Rules',    icon: 'fingerprint',        chip: 'bg-blue-100 text-blue-700',      bar: 'bg-blue-500' },
  payroll:     { label: 'Payroll Rules',       icon: 'payments',           chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
  leave:       { label: 'Leave Rules',         icon: 'event_busy',         chip: 'bg-orange-100 text-orange-700',   bar: 'bg-orange-500' },
  hr:          { label: 'Recruitment & HR Rules', icon: 'person_search',   chip: 'bg-purple-100 text-purple-700',   bar: 'bg-purple-500' },
  incentive:   { label: 'Incentive Rules',     icon: 'trending_up',        chip: 'bg-amber-100 text-amber-700',    bar: 'bg-amber-500' },
  notification:{ label: 'Notification Rules',  icon: 'notifications_active', chip: 'bg-cyan-100 text-cyan-700',    bar: 'bg-cyan-500' },
  compliance:  { label: 'Compliance Rules',    icon: 'gavel',              chip: 'bg-red-100 text-red-700',        bar: 'bg-red-500' },
  hospital:    { label: 'Hospital Rules',      icon: 'local_hospital',     chip: 'bg-rose-100 text-rose-700',      bar: 'bg-rose-500' },
  custom:      { label: 'Custom Rules',        icon: 'tune',               chip: 'bg-slate-100 text-slate-600',    bar: 'bg-slate-400' },
};

const categoryMeta = (t: string) => CATEGORY_META[t] ?? CATEGORY_META.custom;

const ORIGIN_META = {
  ai:     { label: 'AI',      icon: 'auto_awesome',  chip: 'bg-violet-50 text-violet-600 border-violet-200', tooltip: 'AI-generated rule (detected from metadata)' },
  manual: { label: 'Manual',  icon: 'person_edit',   chip: 'bg-slate-50 text-slate-500 border-slate-200',    tooltip: 'Created manually by a user' },
  system: { label: 'System',  icon: 'settings',      chip: 'bg-blue-50 text-blue-500 border-blue-200',       tooltip: 'Seeded / system-generated rule' },
} as const;
type Origin = keyof typeof ORIGIN_META;

function detectOrigin(rule: RuleRow): Origin {
  const by = `${rule.created_by || ''}`.toLowerCase();
  if (/(^|[^a-z])(ai|gemini)([^a-z]|$)/.test(by) || /generated by ai/i.test(rule.description || '')) return 'ai';
  if (['system', 'admin', 'seed', 'scheduler', 'migration'].includes(by)) return 'system';
  return 'manual';
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = 'border border-slate-200 rounded-lg px-2.5 py-2 text-[13px] w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 bg-white text-slate-700';

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function pageWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - (sorted[i - 1] as number) > 1) out.push('…');
    out.push(p);
  });
  return out;
}

async function downloadExport(ids: number[]) {
  const data = await exportRules(ids);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hrpulse-rules-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule card
// ─────────────────────────────────────────────────────────────────────────────

function RuleCard({
  rule, stat, selected, checked, onEdit, onClone, onHistory, onTest, onToggle, onDelete, onCheck,
}: {
  rule: RuleRow;
  stat?: RuleStat;
  selected: boolean;
  checked: boolean;
  onEdit: () => void;
  onClone: () => void;
  onHistory: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onCheck: (checked: boolean) => void;
}) {
  const [hover, setHover] = useState(false);
  const status = deriveStatus(rule, stat);
  const sm = STATUS_META[status];
  const catMeta = categoryMeta(rule.rule_type);
  const catLabel = rule.rule_categories?.name ?? catMeta.label.replace(' Rules', '');
  const origin = ORIGIN_META[detectOrigin(rule)];
  const successRate = stat && stat.count > 0 ? Math.round((stat.success / stat.count) * 100) : null;
  const priorityTier = rule.priority >= 50 ? 'High' : rule.priority >= 20 ? 'Medium' : 'Low';

  const iconBtn = (title: string, icon: string, onClick: () => void, danger = false, tone = 'text-slate-500') => (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={clsx('p-1.5 rounded-lg transition-colors', danger ? 'text-red-400 hover:bg-red-50 hover:text-red-600' : `${tone} hover:bg-indigo-50 hover:text-indigo-600`)}
    >
      <span className="material-icons text-[18px] leading-none">{icon}</span>
    </button>
  );

  return (
    <div
      onClick={onEdit}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={clsx(
        'group relative rounded-xl border p-3 cursor-pointer transition-all duration-200',
        selected
          ? 'border-blue-400 bg-blue-50/70 shadow-sm shadow-blue-100 ring-1 ring-blue-300/60'
          : 'border-slate-200/80 bg-white hover:border-indigo-300 hover:shadow-md hover:-translate-y-px',
      )}
      title={rule.description || rule.name}
    >
      {/* left color accent */}
      <span className={clsx('absolute left-0 top-3 bottom-3 w-[3px] rounded-full', catMeta.bar)} aria-hidden="true" />

      <div className="flex items-start gap-2.5 pl-2">
        {/* checkbox */}
        <label
          className="flex items-center mt-0.5 cursor-pointer shrink-0"
          onClick={(e) => e.stopPropagation()}
          title="Select rule for bulk actions"
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 accent-indigo-600 focus:ring-indigo-500/40 cursor-pointer"
          />
        </label>

        <div className="min-w-0 flex-1">
          {/* name + status */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{rule.name}</p>
            <span className={clsx('inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold', sm.chip)} title={sm.tooltip}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', sm.dot)} />
              {sm.label}
            </span>
          </div>

          {/* category + origin + priority */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={clsx('px-2 py-0.5 rounded-md text-[11px] font-medium', catMeta.chip)}>{catLabel}</span>
            <span className={clsx('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold', origin.chip)} title={origin.tooltip}>
              <span className="material-icons text-[11px] leading-none">{origin.icon}</span>{origin.label}
            </span>
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-bold"
              title={`Execution priority ${rule.priority} (${priorityTier}) — higher priority rules run first`}
            >
              P{rule.priority}
            </span>
          </div>

          {/* meta */}
          <p className="mt-1.5 text-[11px] text-slate-400 flex items-center gap-1 flex-wrap">
            <span className="inline-flex items-center gap-0.5" title={`Created by ${rule.created_by}`}>
              <span className="material-icons text-[12px]">person</span>{rule.modified_by || rule.created_by}
            </span>
            <span>·</span>
            <span title={`Last modified ${new Date(rule.updated_at).toLocaleString()}`}>Modified {timeAgo(rule.updated_at)}</span>
          </p>

          {/* execution stats */}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10.5px] font-medium">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 border border-slate-100 text-slate-600" title="Total executions in the last 30 days">
              <span className="material-icons text-[12px] text-indigo-400">bolt</span>{stat?.count ?? 0} runs
            </span>
            {successRate !== null && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border',
                  successRate >= 90 ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : successRate >= 60 ? 'bg-amber-50 border-amber-100 text-amber-600' : 'bg-red-50 border-red-100 text-red-600',
                )}
                title={`Success rate over ${stat?.count ?? 0} executions`}
              >
                <span className="material-icons text-[12px]">trending_up</span>{successRate}%
              </span>
            )}
            {stat?.lastStatus && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border',
                  stat.lastStatus === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : stat.lastStatus === 'failed' ? 'bg-red-50 border-red-100 text-red-600' : 'bg-slate-50 border-slate-100 text-slate-500',
                )}
                title={`Last execution ${stat.lastExecutedAt ? new Date(stat.lastExecutedAt).toLocaleString() : ''} — ${stat.lastStatus}`}
              >
                <span className="material-icons text-[12px]">schedule</span>{timeAgo(stat.lastExecutedAt)}
              </span>
            )}
          </div>

          {/* quick actions */}
          <div
            className={clsx(
              'mt-2 -mx-1 flex items-center gap-0.5 overflow-hidden transition-all duration-200',
              hover ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {iconBtn('Edit rule in Visual Builder', 'edit', onEdit)}
            {iconBtn('Clone rule (creates inactive copy)', 'content_copy', onClone)}
            {iconBtn('View version history', 'history', onHistory)}
            {iconBtn('Test rule in Sandbox', 'science', onTest)}
            {iconBtn(rule.is_active ? 'Deactivate rule' : 'Activate rule', rule.is_active ? 'toggle_on' : 'toggle_off', onToggle, false, rule.is_active ? 'text-emerald-500' : 'text-slate-400')}
            {iconBtn('Delete rule', 'delete_outline', onDelete, true)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

export default function AllRulesPanel({
  rules, isLoading, stats, selectedRuleId,
  onCreateRule, onEditRule, onCloneRule, onTestRule, onToggleRule, onDeleteRule,
  onBulkActivate, onBulkDeactivate, onBulkDelete, bulkPending,
}: AllRulesPanelProps) {
  // filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d' | 'older'>('all');

  // ui state
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [historyRule, setHistoryRule] = useState<RuleRow | null>(null);
  const [exporting, setExporting] = useState(false);

  // filtering
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (q) {
        const hay = `${r.name} ${r.rule_categories?.name ?? ''} ${r.description ?? ''} ${r.rule_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (categoryFilter !== 'all' && r.rule_type !== categoryFilter) return false;
      const ageDays = (Date.now() - new Date(r.updated_at).getTime()) / 86_400_000;
      if (dateFilter === 'today' && ageDays >= 1) return false;
      if (dateFilter === '7d' && ageDays >= 7) return false;
      if (dateFilter === '30d' && ageDays < 7) return false;
      if (dateFilter === 'older' && ageDays < 30) return false;
      return true;
    }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  }, [rules, search, categoryFilter, dateFilter]);

  // pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRules = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // grouping (cards on the current page + totals across the filtered list)
  const groups = useMemo(() => {
    const map = new Map<string, RuleRow[]>();
    for (const r of pageRules) {
      map.set(r.rule_type, [...(map.get(r.rule_type) ?? []), r]);
    }
    const totals = new Map<string, number>();
    for (const r of filtered) totals.set(r.rule_type, (totals.get(r.rule_type) ?? 0) + 1);
    return { map, totals };
  }, [pageRules, filtered]);

  const allOnPageChecked = pageRules.length > 0 && pageRules.every((r) => selectedIds.has(r.id));
  const toggleSelectAllOnPage = () => {
    const next = new Set(selectedIds);
    if (allOnPageChecked) pageRules.forEach((r) => next.delete(r.id));
    else pageRules.forEach((r) => next.add(r.id));
    setSelectedIds(next);
  };
  const toggleOne = (id: number, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id); else next.delete(id);
    setSelectedIds(next);
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set([...groups.map.keys()]));
  const toggleGroup = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const activeFilters = [
    categoryFilter !== 'all', dateFilter !== 'all', search.trim() !== '',
  ].filter(Boolean).length;
  const clearFilters = () => {
    setSearch(''); setCategoryFilter('all'); setDateFilter('all'); setPage(1);
  };

  const handleBulkExport = async () => {
    setExporting(true);
    try { await downloadExport([...selectedIds]); } finally { setExporting(false); }
  };

  // version history modal
  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ['rules-engine', 'versions', historyRule?.id],
    queryFn: () => fetchVersions(historyRule!.id),
    enabled: !!historyRule,
  });

  const catOptions = useMemo(() => [...new Set(rules.map((r) => r.rule_type))], [rules]);

  return (
    <aside className="rounded-2xl border border-slate-200/80 bg-white shadow-sm flex flex-col overflow-hidden min-h-0">
      {/* ─── Header ─── */}
      <div className="p-4 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm shrink-0">
              <span className="material-icons text-white text-lg">library_books</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-slate-800 leading-tight">All Rules</h3>
              <p className="text-[11px] text-slate-400">
                {filtered.length} of {rules.length} rules{activeFilters > 0 && ` · ${activeFilters} filter${activeFilters > 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={onCreateRule}
            title="Create a new business rule"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[13px] font-semibold shadow-sm shadow-indigo-200 hover:shadow-md hover:shadow-indigo-300 hover:-translate-y-px transition-all shrink-0"
          >
            <span className="material-icons text-[18px] leading-none">add_circle</span>
            <span className="hidden sm:inline">Create New Rule</span>
          </button>
        </div>

        {/* search */}
        <div className="relative">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[19px]">search</span>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search Rules by Name, Category, or Description"
            className="w-full border border-slate-200 rounded-xl pl-10 pr-8 py-2.5 text-[13px] bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-shadow"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500" title="Clear search">
              <span className="material-icons text-[17px]">close</span>
            </button>
          )}
        </div>

        {/* advanced filters */}
        <div className="grid grid-cols-2 gap-2">
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className={inputCls} title="Filter by category">
            <option value="all">All Categories</option>
            {catOptions.map((t) => <option key={t} value={t}>{categoryMeta(t).label}</option>)}
          </select>
          <select value={dateFilter} onChange={(e) => { setDateFilter(e.target.value as any); setPage(1); }} className={inputCls} title="Filter by last modified date">
            <option value="all">Modified — Any time</option>
            <option value="today">Modified today</option>
            <option value="7d">Modified in last 7 days</option>
            <option value="30d">Modified in last 30 days</option>
            <option value="older">Modified more than 30 days ago</option>
          </select>
        </div>

        {/* select-all + expand/collapse */}
        <div className="flex items-center justify-between text-[11px]">
          <label className="inline-flex items-center gap-1.5 text-slate-500 cursor-pointer select-none" title="Select all rules on this page">
            <input type="checkbox" checked={allOnPageChecked} onChange={toggleSelectAllOnPage} className="w-3.5 h-3.5 rounded border-slate-300 accent-indigo-600 cursor-pointer" />
            Select page
          </label>
          {activeFilters > 0 && (
            <button onClick={clearFilters} className="text-indigo-500 hover:text-indigo-700 font-medium" title="Clear all filters">
              Clear filters ({activeFilters})
            </button>
          )}
          <button onClick={collapsed.size ? expandAll : collapseAll} className="text-slate-400 hover:text-slate-600 font-medium" title="Expand or collapse all categories">
            {collapsed.size ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      </div>

      {/* ─── Rules list ─── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[220px] max-h-none xl:max-h-[62vh]">
        {isLoading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-100 p-3 space-y-2.5 animate-pulse">
              <div className="flex gap-2"><div className="w-4 h-4 rounded bg-slate-100" /><div className="h-4 w-3/4 bg-slate-100 rounded" /></div>
              <div className="h-3 w-1/2 bg-slate-50 rounded" />
            </div>
          ))
        ) : pageRules.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-icons block text-5xl text-slate-200 mb-2">manage_search</span>
            <p className="text-sm font-medium text-slate-400">No rules match these filters.</p>
            <button onClick={clearFilters} className="mt-2 text-[12px] text-indigo-500 hover:text-indigo-700 font-medium">Clear all filters</button>
          </div>
        ) : (
          [...groups.map.entries()].map(([type, groupRules]) => {
            const meta = categoryMeta(type);
            const isCollapsed = collapsed.has(type);
            return (
              <section key={type} className="rounded-xl border border-slate-100 overflow-hidden">
                {/* category header */}
                <button
                  onClick={() => toggleGroup(type)}
                  title={`${meta.label} — ${groups.totals.get(type) ?? 0} rules`}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-slate-50/70 hover:bg-slate-100/70 transition-colors text-left"
                >
                  <span className="material-icons text-[16px] text-slate-400 transition-transform duration-200" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>expand_more</span>
                  <span className={clsx('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', meta.chip)}>
                    <span className="material-icons text-[14px]">{meta.icon}</span>
                  </span>
                  <span className="text-[12.5px] font-bold text-slate-700 flex-1 truncate">{meta.label}</span>
                  <span className={clsx('px-2 py-0.5 rounded-full text-[10.5px] font-bold', meta.chip)}>{groups.totals.get(type) ?? 0}</span>
                </button>
                {/* cards */}
                <div className={clsx('p-2 space-y-2 transition-all duration-300', isCollapsed ? 'hidden' : 'block')}>
                  {groupRules.map((r) => (
                    <RuleCard
                      key={r.id}
                      rule={r}
                      stat={stats?.byRule[r.id]}
                      selected={selectedRuleId === r.id}
                      checked={selectedIds.has(r.id)}
                      onEdit={() => onEditRule(r)}
                      onClone={() => onCloneRule(r)}
                      onHistory={() => setHistoryRule(r)}
                      onTest={() => onTestRule(r)}
                      onToggle={() => onToggleRule(r)}
                      onDelete={() => onDeleteRule(r)}
                      onCheck={(c) => toggleOne(r.id, c)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>

      {/* ─── Bulk action bar ─── */}
      {selectedIds.size > 0 && (
        <div className="border-t border-indigo-100 bg-indigo-50/80 backdrop-blur px-3 py-2.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-bold text-indigo-700 mr-1 inline-flex items-center gap-1">
            <span className="material-icons text-[15px]">checklist</span>{selectedIds.size} selected
          </span>
          <button disabled={bulkPending} onClick={() => onBulkActivate([...selectedIds])} title="Activate all selected rules" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-600 text-[11.5px] font-semibold hover:bg-emerald-50 disabled:opacity-50">
            <span className="material-icons text-[14px]">play_circle</span>Activate
          </button>
          <button disabled={bulkPending} onClick={() => onBulkDeactivate([...selectedIds])} title="Deactivate all selected rules" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-amber-200 text-amber-600 text-[11.5px] font-semibold hover:bg-amber-50 disabled:opacity-50">
            <span className="material-icons text-[14px]">pause_circle</span>Deactivate
          </button>
          <button disabled={exporting || bulkPending} onClick={handleBulkExport} title="Export selected rules as JSON" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11.5px] font-semibold hover:bg-slate-50 disabled:opacity-50">
            <span className="material-icons text-[14px]">download</span>{exporting ? 'Exporting…' : 'Export'}
          </button>
          <button disabled={bulkPending} onClick={() => onBulkDelete([...selectedIds])} title="Delete all selected rules" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-red-200 text-red-500 text-[11.5px] font-semibold hover:bg-red-50 disabled:opacity-50">
            <span className="material-icons text-[14px]">delete</span>Delete
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-slate-400 hover:text-slate-600 p-1.5 rounded-lg" title="Clear selection">
            <span className="material-icons text-[17px]">close</span>
          </button>
        </div>
      )}

      {/* ─── Pagination ─── */}
      <div className="border-t border-slate-100 px-3 py-2.5 flex items-center justify-between gap-2 bg-white">
        <span className="text-[11px] text-slate-400 hidden sm:block">
          {filtered.length === 0 ? 'No rules' : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} of ${filtered.length} rules`}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="Previous page">
            <span className="material-icons text-[18px]">chevron_left</span>
          </button>
          {pageWindow(safePage, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1 text-slate-300 text-[12px]">…</span>
            ) : (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={clsx(
                  'min-w-[28px] h-7 px-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                  p === safePage ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200' : 'text-slate-500 hover:bg-slate-100',
                )}
              >
                {p}
              </button>
            ),
          )}
          <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="Next page">
            <span className="material-icons text-[18px]">chevron_right</span>
          </button>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="ml-1 border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] text-slate-500 bg-white"
            title="Rules per page"
          >
            {[8, 12, 24, 48].map((n) => <option key={n} value={n}>{n}/pg</option>)}
          </select>
        </div>
      </div>

      {/* ─── Version history modal ─── */}
      {historyRule && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setHistoryRule(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <span className="material-icons text-purple-500">history</span>Version History
                </h3>
                <p className="text-[12px] text-slate-400 mt-0.5 truncate max-w-sm">{historyRule.name}</p>
              </div>
              <button onClick={() => setHistoryRule(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" title="Close">
                <span className="material-icons">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {versionsLoading ? (
                <div className="space-y-2.5">{[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-slate-50 animate-pulse" />)}</div>
              ) : (versions ?? []).length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No versions recorded yet.</p>
              ) : (
                <ol className="relative border-l-2 border-slate-100 ml-3 space-y-4">
                  {(versions as RuleVersionRow[]).map((v) => (
                    <li key={v.id} className="ml-4 relative">
                      <span className="absolute -left-[25px] top-1 w-4 h-4 rounded-full bg-white border-2 border-purple-400" />
                      <div className="rounded-xl border border-slate-100 p-3 hover:shadow-sm transition-shadow">
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-600 text-[11px] font-bold">v{v.version_number}{v.is_rollback && ' · rollback'}</span>
                          <span className="text-[11px] text-slate-400">{new Date(v.modified_at).toLocaleString()}</span>
                        </div>
                        <p className="text-[13px] text-slate-600 mt-1.5">{v.change_summary || 'No change summary'}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">by {v.modified_by}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}