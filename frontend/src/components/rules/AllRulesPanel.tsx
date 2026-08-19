/**
 * All Rules — enterprise rule repository panel (left side of Rule Management).
 *
 * Premium management surface for hundreds of business rules:
 *  - Prominent search + advanced filters (category)
 *  - Rules rendered as cards grouped into collapsible category accordions
 *  - Per-card execution statistics, origin badges and quick actions
 *    (edit, clone, history, test, activate/deactivate, delete)
 *  - Bulk selection with activate / deactivate / export / delete
 *  - Pagination with page numbers and total count
 *
 * The panel is presentational: all mutations live in the parent
 * (RuleManagementTab) and are passed in as callbacks.
 *
 * Visual system: clean white cards, soft tinted badges, blue selection
 * state, consistent 12–14px radii, subtle shadows and hover elevation.
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
// Status / category / origin metadata — soft tinted badges
// ─────────────────────────────────────────────────────────────────────────────

type DerivedStatus = 'active' | 'inactive' | 'pending' | 'scheduled';

const STATUS_META: Record<DerivedStatus, { label: string; chip: string; dot: string; tooltip: string }> = {
  active:    { label: 'Active',    chip: 'bg-[#DCFCE7] text-[#16A34A]',   dot: 'bg-[#16A34A]', tooltip: 'Rule is live and evaluated on every run' },
  inactive:  { label: 'Inactive',  chip: 'bg-[#FEE2E2] text-[#EF4444]',   dot: 'bg-[#EF4444]', tooltip: 'Rule is switched off and skipped by the engine' },
  pending:   { label: 'Pending',   chip: 'bg-[#FFFBEB] text-[#F59E0B]',   dot: 'bg-[#F59E0B]', tooltip: 'Last execution failed — pending review' },
  scheduled: { label: 'Scheduled', chip: 'bg-[#EFF6FF] text-[#2563EB]',   dot: 'bg-[#2563EB]', tooltip: 'Runs asynchronously in the background queue' },
};

function deriveStatus(rule: RuleRow, stat?: RuleStat): DerivedStatus {
  if (!rule.is_active) return 'inactive';
  if (stat?.lastStatus === 'failed') return 'pending';
  if (rule.execution_mode === 'async') return 'scheduled';
  return 'active';
}

const CATEGORY_META: Record<string, { label: string; icon: string; chip: string; bar: string }> = {
  attendance:  { label: 'Attendance Rules',    icon: 'fingerprint',        chip: 'bg-[#EFF6FF] text-[#2563EB]',    bar: 'bg-[#2563EB]' },
  payroll:     { label: 'Payroll Rules',       icon: 'payments',           chip: 'bg-[#DCFCE7] text-[#16A34A]',    bar: 'bg-[#16A34A]' },
  leave:       { label: 'Leave Rules',         icon: 'event_busy',         chip: 'bg-[#FFFBEB] text-[#F59E0B]',    bar: 'bg-[#F59E0B]' },
  hr:          { label: 'Recruitment & HR Rules', icon: 'person_search',   chip: 'bg-[#F5F3FF] text-[#7C3AED]',    bar: 'bg-[#7C3AED]' },
  incentive:   { label: 'Incentive Rules',     icon: 'trending_up',        chip: 'bg-[#FFFBEB] text-[#F59E0B]',    bar: 'bg-[#F59E0B]' },
  notification:{ label: 'Notification Rules',  icon: 'notifications_active', chip: 'bg-[#ECFEFF] text-[#0891B2]', bar: 'bg-[#0891B2]' },
  compliance:  { label: 'Compliance Rules',    icon: 'gavel',              chip: 'bg-[#FEE2E2] text-[#EF4444]',    bar: 'bg-[#EF4444]' },
  hospital:    { label: 'Hospital Rules',      icon: 'local_hospital',     chip: 'bg-[#FFF1F2] text-[#E11D48]',    bar: 'bg-[#E11D48]' },
  custom:      { label: 'Custom Rules',        icon: 'tune',               chip: 'bg-[#F3F4F6] text-[#6B7280]',    bar: 'bg-[#9CA3AF]' },
};

const categoryMeta = (t: string) => CATEGORY_META[t] ?? CATEGORY_META.custom;

const ORIGIN_META = {
  ai:     { label: 'AI',      icon: 'auto_awesome', chip: 'bg-[#EFF6FF] text-[#2563EB]',   tooltip: 'AI-generated rule (detected from metadata)' },
  manual: { label: 'Manual',  icon: 'person_edit',  chip: 'bg-[#F3F4F6] text-[#6B7280]',   tooltip: 'Created manually by a user' },
  system: { label: 'System',  icon: 'settings',     chip: 'bg-[#EFF6FF] text-[#2563EB]',   tooltip: 'Seeded / system-generated rule' },
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

const inputCls =
  'h-10 w-full rounded-[10px] border border-[#E5E7EB] bg-white px-3 text-[13px] text-[#111827] ' +
  'focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15 transition cursor-pointer';

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

  /** Modern soft icon button used for quick actions. */
  const iconBtn = (title: string, icon: string, onClick: () => void, danger = false, tone = 'text-[#6B7280]') => (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={clsx(
        'flex h-8 w-8 items-center justify-center rounded-[8px] transition-all duration-150 active:scale-90',
        danger ? 'text-[#EF4444] hover:bg-[#FEE2E2]' : `${tone} hover:bg-[#EFF6FF] hover:text-[#2563EB]`,
      )}
    >
      <span className="material-icons text-[17px] leading-none">{icon}</span>
    </button>
  );

  return (
    <div
      onClick={onEdit}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={clsx(
        'group relative cursor-pointer rounded-[12px] border p-3 transition-all duration-200',
        selected
          ? 'border-[#2563EB] bg-[#F5F9FF] shadow-[0px_2px_10px_rgba(37,99,235,0.10)]'
          : 'border-[#E5E7EB] bg-white hover:-translate-y-px hover:border-[#93C5FD] hover:shadow-[0px_6px_16px_rgba(0,0,0,0.07)]',
      )}
      title={rule.description || rule.name}
    >
      {/* left color accent */}
      <span className={clsx('absolute left-0 top-3 bottom-3 w-[3px] rounded-full', catMeta.bar)} aria-hidden="true" />

      <div className="flex items-start gap-2.5 pl-2">
        {/* checkbox */}
        <label
          className="mt-0.5 flex shrink-0 cursor-pointer items-center"
          onClick={(e) => e.stopPropagation()}
          title="Select rule for bulk actions"
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-[#D1D5DB] accent-[#2563EB]"
          />
        </label>

        <div className="min-w-0 flex-1">
          {/* name + status */}
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#111827]">{rule.name}</p>
            <span className={clsx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', sm.chip)} title={sm.tooltip}>
              <span className={clsx('h-1.5 w-1.5 rounded-full', sm.dot)} />
              {sm.label}
            </span>
          </div>

          {/* category + origin + priority */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={clsx('rounded-md px-2 py-0.5 text-[10.5px] font-medium', catMeta.chip)}>{catLabel}</span>
            <span className={clsx('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold', origin.chip)} title={origin.tooltip}>
              <span className="material-icons text-[11px] leading-none">{origin.icon}</span>{origin.label}
            </span>
            <span
              className="inline-flex items-center gap-0.5 rounded-md bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-bold text-[#2563EB]"
              title={`Execution priority ${rule.priority} (${priorityTier}) — higher priority rules run first`}
            >
              P{rule.priority}
            </span>
          </div>

          {/* meta */}
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-[#9CA3AF]">
            <span className="inline-flex items-center gap-0.5" title={`Created by ${rule.created_by}`}>
              <span className="material-icons text-[12px]">person</span>{rule.modified_by || rule.created_by}
            </span>
            <span>·</span>
            <span title={`Last modified ${new Date(rule.updated_at).toLocaleString()}`}>Modified {timeAgo(rule.updated_at)}</span>
          </p>

          {/* execution stats */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] font-medium">
            <span className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-1.5 py-0.5 text-[#6B7280]" title="Total executions in the last 30 days">
              <span className="material-icons text-[12px] text-[#2563EB]">bolt</span>{stat?.count ?? 0} runs
            </span>
            {successRate !== null && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5',
                  successRate >= 90 ? 'bg-[#DCFCE7] text-[#16A34A]' : successRate >= 60 ? 'bg-[#FFFBEB] text-[#F59E0B]' : 'bg-[#FEE2E2] text-[#EF4444]',
                )}
                title={`Success rate over ${stat?.count ?? 0} executions`}
              >
                <span className="material-icons text-[12px]">trending_up</span>{successRate}%
              </span>
            )}
            {stat?.lastStatus && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5',
                  stat.lastStatus === 'success' ? 'bg-[#DCFCE7] text-[#16A34A]' : stat.lastStatus === 'failed' ? 'bg-[#FEE2E2] text-[#EF4444]' : 'bg-[#F3F4F6] text-[#6B7280]',
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
            {iconBtn('Edit rule in Rule Builder', 'edit', onEdit)}
            {iconBtn('Clone rule (creates inactive copy)', 'content_copy', onClone)}
            {iconBtn('View version history', 'history', onHistory)}
            {iconBtn('Test rule in Sandbox', 'science', onTest)}
            {iconBtn(rule.is_active ? 'Deactivate rule' : 'Activate rule', rule.is_active ? 'toggle_on' : 'toggle_off', onToggle, false, rule.is_active ? 'text-[#16A34A]' : 'text-[#9CA3AF]')}
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
      return true;
    }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  }, [rules, search, categoryFilter]);

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
    categoryFilter !== 'all', search.trim() !== '',
  ].filter(Boolean).length;
  const clearFilters = () => {
    setSearch(''); setCategoryFilter('all'); setPage(1);
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
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white shadow-[0px_2px_10px_rgba(0,0,0,0.05)]">
      {/* ─── Header ─── */}
      <div className="space-y-3 border-b border-[#E5E7EB] bg-[#F8FAFC]/70 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#EFF6FF] text-[#2563EB]">
              <span className="material-icons text-[18px]">library_books</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-tight text-[#111827]">All Rules</h3>
              <p className="text-[11.5px] text-[#6B7280]">
                {filtered.length} of {rules.length} rules{activeFilters > 0 && ` · ${activeFilters} filter${activeFilters > 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={onCreateRule}
            title="Create a new business rule"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-[#2563EB] px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0px_2px_8px_rgba(37,99,235,0.25)] transition-all duration-200 hover:bg-[#1D4ED8] hover:shadow-[0px_4px_12px_rgba(37,99,235,0.3)] active:scale-[0.98]"
          >
            <span className="material-icons text-[16px] leading-none">add</span>
            <span className="hidden sm:inline">Create New Rule</span>
          </button>
        </div>

        {/* search */}
        <div className="relative">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#9CA3AF]">search</span>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search rules by name, category, or description"
            className="w-full rounded-[10px] border border-[#E5E7EB] bg-white py-2.5 pl-10 pr-8 text-[13px] text-[#111827] placeholder:text-[#9CA3AF] transition focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF] transition-colors hover:text-[#6B7280]" title="Clear search">
              <span className="material-icons text-[16px]">close</span>
            </button>
          )}
        </div>

        {/* advanced filters */}
        <div>
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className={inputCls} title="Filter by category">
            <option value="all">All Categories</option>
            {catOptions.map((t) => <option key={t} value={t}>{categoryMeta(t).label}</option>)}
          </select>
        </div>

        {/* select-all + expand/collapse */}
        <div className="flex items-center justify-between text-[11.5px]">
          <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[#6B7280]" title="Select all rules on this page">
            <input type="checkbox" checked={allOnPageChecked} onChange={toggleSelectAllOnPage} className="h-3.5 w-3.5 cursor-pointer rounded border-[#D1D5DB] accent-[#2563EB]" />
            Select page
          </label>
          {activeFilters > 0 && (
            <button onClick={clearFilters} className="font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8]" title="Clear all filters">
              Clear filters ({activeFilters})
            </button>
          )}
          <button onClick={collapsed.size ? expandAll : collapseAll} className="font-medium text-[#6B7280] transition-colors hover:text-[#111827]" title="Expand or collapse all categories">
            {collapsed.size ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      </div>

      {/* ─── Rules list ─── */}
      <div className="min-h-[220px] flex-1 space-y-3 overflow-y-auto p-3 xl:max-h-[62vh]">
        {isLoading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="space-y-2.5 rounded-[12px] border border-[#E5E7EB] p-3">
              <div className="flex gap-2"><div className="h-4 w-4 rounded bg-[#F3F4F6] animate-pulse" /><div className="h-4 w-3/4 animate-pulse rounded bg-[#F3F4F6]" /></div>
              <div className="h-3 w-1/2 animate-pulse rounded bg-[#F8FAFC]" />
            </div>
          ))
        ) : pageRules.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-icons block text-[44px] leading-none text-[#E5E7EB]">manage_search</span>
            <p className="mt-3 text-[13px] font-medium text-[#6B7280]">No rules match these filters.</p>
            <button onClick={clearFilters} className="mt-2 text-[12.5px] font-medium text-[#2563EB] transition-colors hover:text-[#1D4ED8]">Clear all filters</button>
          </div>
        ) : (
          [...groups.map.entries()].map(([type, groupRules]) => {
            const meta = categoryMeta(type);
            const isCollapsed = collapsed.has(type);
            return (
              <section key={type} className="overflow-hidden rounded-[12px] border border-[#E5E7EB]">
                {/* category header */}
                <button
                  onClick={() => toggleGroup(type)}
                  title={`${meta.label} — ${groups.totals.get(type) ?? 0} rules`}
                  className="flex w-full items-center gap-2.5 bg-[#F8FAFC]/80 px-3 py-2.5 text-left transition-colors hover:bg-[#F3F4F6]/60"
                >
                  <span className="material-icons text-[16px] text-[#9CA3AF] transition-transform duration-200" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>expand_more</span>
                  <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', meta.chip)}>
                    <span className="material-icons text-[14px]">{meta.icon}</span>
                  </span>
                  <span className="flex-1 truncate text-[12.5px] font-semibold text-[#374151]">{meta.label}</span>
                  <span className={clsx('rounded-full px-2 py-0.5 text-[10.5px] font-bold', meta.chip)}>{groups.totals.get(type) ?? 0}</span>
                </button>
                {/* cards */}
                <div className={clsx('space-y-2 p-2 transition-all duration-300', isCollapsed ? 'hidden' : 'block')}>
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
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[#DBEAFE] bg-[#EFF6FF]/90 px-3 py-2.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[12px] font-bold text-[#2563EB]">
            <span className="material-icons text-[15px]">checklist</span>{selectedIds.size} selected
          </span>
          <button disabled={bulkPending} onClick={() => onBulkActivate([...selectedIds])} title="Activate all selected rules" className="inline-flex items-center gap-1 rounded-lg border border-[#16A34A]/25 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#16A34A] transition-colors hover:bg-[#DCFCE7] disabled:opacity-50">
            <span className="material-icons text-[14px]">play_circle</span>Activate
          </button>
          <button disabled={bulkPending} onClick={() => onBulkDeactivate([...selectedIds])} title="Deactivate all selected rules" className="inline-flex items-center gap-1 rounded-lg border border-[#F59E0B]/25 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#F59E0B] transition-colors hover:bg-[#FFFBEB] disabled:opacity-50">
            <span className="material-icons text-[14px]">pause_circle</span>Deactivate
          </button>
          <button disabled={exporting || bulkPending} onClick={handleBulkExport} title="Export selected rules as JSON" className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#374151] transition-colors hover:bg-[#F8FAFC] disabled:opacity-50">
            <span className="material-icons text-[14px]">download</span>{exporting ? 'Exporting…' : 'Export'}
          </button>
          <button disabled={bulkPending} onClick={() => onBulkDelete([...selectedIds])} title="Delete all selected rules" className="inline-flex items-center gap-1 rounded-lg border border-[#EF4444]/25 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#EF4444] transition-colors hover:bg-[#FEE2E2] disabled:opacity-50">
            <span className="material-icons text-[14px]">delete</span>Delete
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-white hover:text-[#111827]" title="Clear selection">
            <span className="material-icons text-[17px]">close</span>
          </button>
        </div>
      )}

      {/* ─── Pagination ─── */}
      <div className="flex items-center justify-between gap-2 border-t border-[#E5E7EB] bg-white px-3 py-2.5">
        <span className="hidden text-[11.5px] text-[#6B7280] sm:block">
          {filtered.length === 0 ? 'No rules' : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} of ${filtered.length} rules`}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#111827] disabled:opacity-30" title="Previous page">
            <span className="material-icons text-[18px]">chevron_left</span>
          </button>
          {pageWindow(safePage, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1 text-[12px] text-[#9CA3AF]">…</span>
            ) : (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={clsx(
                  'h-7 min-w-[28px] rounded-lg px-1.5 text-[12px] font-semibold transition-all duration-150',
                  p === safePage ? 'bg-[#2563EB] text-white shadow-[0px_2px_6px_rgba(37,99,235,0.3)]' : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]',
                )}
              >
                {p}
              </button>
            ),
          )}
          <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#111827] disabled:opacity-30" title="Next page">
            <span className="material-icons text-[18px]">chevron_right</span>
          </button>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="ml-1 cursor-pointer rounded-lg border border-[#E5E7EB] bg-white px-1.5 py-1 text-[11px] text-[#6B7280] focus:border-[#2563EB] focus:outline-none"
            title="Rules per page"
          >
            {[8, 12, 24, 48].map((n) => <option key={n} value={n}>{n}/pg</option>)}
          </select>
        </div>
      </div>

      {/* ─── Version history modal ─── */}
      {historyRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/40 p-4 backdrop-blur-sm" onClick={() => setHistoryRule(null)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-[16px] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] p-5">
              <div>
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-[#111827]">
                  <span className="material-icons text-[20px] text-[#2563EB]">history</span>Version History
                </h3>
                <p className="mt-0.5 max-w-sm truncate text-[12.5px] text-[#6B7280]">{historyRule.name}</p>
              </div>
              <button onClick={() => setHistoryRule(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#111827]" title="Close">
                <span className="material-icons">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {versionsLoading ? (
                <div className="space-y-2.5">{[...Array(4)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-[12px] bg-[#F8FAFC]" />)}</div>
              ) : (versions ?? []).length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[#6B7280]">No versions recorded yet.</p>
              ) : (
                <ol className="relative ml-3 space-y-4 border-l-2 border-[#E5E7EB]">
                  {(versions as RuleVersionRow[]).map((v) => (
                    <li key={v.id} className="relative ml-4">
                      <span className="absolute -left-[25px] top-1 h-4 w-4 rounded-full border-2 border-[#2563EB] bg-white" />
                      <div className="rounded-[12px] border border-[#E5E7EB] p-3 transition-all hover:shadow-[0px_2px_10px_rgba(0,0,0,0.05)]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded-md bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#2563EB]">v{v.version_number}{v.is_rollback && ' · rollback'}</span>
                          <span className="text-[11px] text-[#9CA3AF]">{new Date(v.modified_at).toLocaleString()}</span>
                        </div>
                        <p className="mt-1.5 text-[13px] text-[#374151]">{v.change_summary || 'No change summary'}</p>
                        <p className="mt-0.5 text-[11px] text-[#9CA3AF]">by {v.modified_by}</p>
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