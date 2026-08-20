/**
 * Rules Engine Dashboard — enterprise rule management shell.
 *
 * Premium SaaS visual system (Linear / Stripe / Keka inspired):
 *  - Inter Bold 32px page heading, refined subtitle
 *  - KPI cards with soft circular icon backgrounds and bold 28px values
 *  - Modern tabs with blue underline active state and smooth transitions
 *  - Consistent 14–16px radii, subtle shadows, generous whitespace
 *
 * All data flows through the Supabase data layer (api/rulesEngine.ts)
 * via react-query. Structure and functionality unchanged.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchKpis } from '../api/rulesEngine';
import RuleManagementTab from '../components/rules/RuleManagementTab';
import CategoriesTab from '../components/rules/CategoriesTab';
import LogsTab from '../components/rules/LogsTab';
import VersionsTab from '../components/rules/VersionsTab';
import ImportExportTab from '../components/rules/ImportExportTab';
import AnalyticsTab from '../components/rules/AnalyticsTab';
import SettingsTab from '../components/rules/SettingsTab';

type TabId = 'rules' | 'categories' | 'logs' | 'versions' | 'import-export' | 'analytics' | 'settings';

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'rules', label: 'Rule Management', icon: 'settings_suggest' },
  { id: 'categories', label: 'Rule Categories', icon: 'category' },
  { id: 'logs', label: 'Rule Logs', icon: 'receipt_long' },
  { id: 'versions', label: 'Version History', icon: 'history' },
  { id: 'import-export', label: 'Import/Export', icon: 'swap_horiz' },
  { id: 'analytics', label: 'Analytics', icon: 'insights' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/** Soft tinted icon chip — one per KPI, no gradients. */
const KPI_TONES = {
  total:    'bg-[#EFF6FF] text-[#2563EB]',
  active:   'bg-[#DCFCE7] text-[#16A34A]',
  inactive: 'bg-[#F3F4F6] text-[#6B7280]',
  executed: 'bg-[#EFF6FF] text-[#2563EB]',
  failed:   'bg-[#FEE2E2] text-[#EF4444]',
  pending:  'bg-[#FFFBEB] text-[#F59E0B]',
} as const;

function KpiCard({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-[12px] border border-[#E5E7EB] bg-white p-2.5 shadow-[0px_2px_10px_rgba(0,0,0,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0px_8px_20px_rgba(0,0,0,0.08)] sm:gap-4 sm:rounded-[14px] sm:p-5">
      <div className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105 sm:h-12 sm:w-12', tone)}>
        <span className="material-icons text-[18px] sm:text-[24px]">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[22px] font-bold leading-none tracking-tight text-[#111827] sm:text-[28px]">{value.toLocaleString()}</p>
        <p className="mt-1 truncate text-[10px] text-[#6B7280] sm:mt-1.5 sm:text-[13px]">{label}</p>
      </div>
    </div>
  );
}

function KpiSkeletons() {
  return (
    <>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex min-w-0 items-center gap-2 rounded-[12px] border border-[#E5E7EB] bg-white p-2.5 shadow-[0px_2px_10px_rgba(0,0,0,0.05)] sm:gap-4 sm:rounded-[14px] sm:p-5">
          <div className="h-9 w-9 rounded-full bg-[#F3F4F6] animate-pulse sm:h-12 sm:w-12" />
          <div className="flex-1 space-y-2.5">
            <div className="h-6 w-12 rounded bg-[#F3F4F6] animate-pulse sm:h-7 sm:w-16" />
            <div className="h-2.5 w-20 rounded bg-[#F8FAFC] animate-pulse sm:h-3 sm:w-24" />
          </div>
        </div>
      ))}
    </>
  );
}

export default function RulesEngineDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('rules');
  const [openCreateSignal, setOpenCreateSignal] = useState(0);
  const qc = useQueryClient();

  const { data: kpis, isLoading, error: kpiError } = useQuery({
    queryKey: ['rules-engine', 'kpis'],
    queryFn: fetchKpis,
    retry: false,
  });

  const kpiRefetch = () => qc.invalidateQueries({ queryKey: ['rules-engine'] });
  const openRuleBuilder = () => {
    setActiveTab('rules');
    setOpenCreateSignal((value) => value + 1);
    window.setTimeout(() => document.getElementById('rule-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const migrationMissing = kpiError && /relation|does not exist|PGRST|Could not find/i.test(String((kpiError as Error).message));

  return (
    <div className="w-full min-w-0 bg-[#F8FAFC] p-4 sm:p-6 lg:p-10">
      {/* ─── Header ─── */}
      <div className="mb-6 flex flex-row items-center justify-between gap-2 sm:mb-8 sm:gap-4 lg:mb-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-[#2563EB] shadow-[0px_4px_12px_rgba(37,99,235,0.25)] sm:flex">
            <span className="material-icons text-white text-[28px]">settings_suggest</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-[27px] font-bold leading-tight tracking-tight text-[#111827] sm:text-[32px]">Rules Engine</h1>
            <p className="mt-1 hidden text-[14px] text-[#6B7280] sm:block">Dynamic business rule management — create, test, audit and deploy rules without code</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openRuleBuilder}
            title="Create a new business rule"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#2563EB] text-white shadow-[0px_2px_8px_rgba(37,99,235,0.25)] transition hover:bg-[#1D4ED8] active:scale-95 sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-2 sm:text-[13px] sm:font-semibold"
          >
            <span className="material-icons text-[18px]">add</span>
            <span className="hidden sm:inline">Create Rule</span>
          </button>
          <span className="hidden items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-medium text-[#16A34A] shadow-[0px_2px_10px_rgba(0,0,0,0.05)] sm:inline-flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#16A34A] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#16A34A]" />
            </span>
            Engine Online
          </span>
        </div>
      </div>

      {/* ─── Migration missing banner ─── */}
      {migrationMissing && (
        <div className="mb-8 rounded-[14px] border border-[#F59E0B]/30 bg-[#FFFBEB] p-5 text-[13px] leading-relaxed text-[#92400E]">
          <p className="flex items-center gap-2 text-[14px] font-semibold">
            <span className="material-icons text-[20px] text-[#F59E0B]">warning</span>
            Rules Engine tables are not created yet
          </p>
          <p className="mt-2">
            Apply <code className="rounded bg-[#F59E0B]/10 px-1.5 py-0.5 text-[12px]">supabase/migrations/20260818_rules_engine.sql</code> in the
            Supabase Dashboard → <strong>SQL Editor</strong> → paste → <strong>Run</strong>. This creates all 11 rule tables, seeds the
            16 categories and 5 starter rules. Refresh this page afterwards.
          </p>
        </div>
      )}

      {/* ─── KPI Cards ─── */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:mb-8 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 lg:mb-10">
        {isLoading ? (
          <KpiSkeletons />
        ) : (
          <>
            <KpiCard icon="rule" label="Total Rules" value={kpis?.totalRules ?? 0} tone={KPI_TONES.total} />
            <KpiCard icon="check_circle" label="Active Rules" value={kpis?.activeRules ?? 0} tone={KPI_TONES.active} />
            <KpiCard icon="block" label="Inactive Rules" value={kpis?.inactiveRules ?? 0} tone={KPI_TONES.inactive} />
            <KpiCard icon="bolt" label="Executed Today" value={kpis?.executedToday ?? 0} tone={KPI_TONES.executed} />
            <KpiCard icon="error" label="Failed Executions" value={kpis?.failedToday ?? 0} tone={KPI_TONES.failed} />
            <KpiCard icon="pending_actions" label="Pending Approval" value={kpis?.pendingApprovals ?? 0} tone={KPI_TONES.pending} />
          </>
        )}
      </div>

      {/* ─── Tabs + content ─── */}
      <div className="overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white shadow-[0px_2px_10px_rgba(0,0,0,0.05)]">
        <div className="hr-scroll-x flex flex-nowrap border-b border-[#E5E7EB] bg-white [scrollbar-width:thin]">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3 text-left text-[12px] font-medium transition-colors duration-200 sm:gap-2 sm:px-5 sm:py-4 sm:text-[13px]',
                  isActive ? 'text-[#2563EB]' : 'text-[#6B7280] hover:bg-[#F8FAFC] hover:text-[#111827]',
                )}
              >
                <span className="material-icons text-[18px]">{tab.icon}</span>
                {tab.label}
                {/* blue underline indicator with smooth slide */}
                <span
                  className={clsx(
                    'absolute inset-x-0 -bottom-px h-[2px] rounded-full transition-all duration-200',
                    isActive ? 'bg-[#2563EB] opacity-100' : 'bg-transparent opacity-0',
                  )}
                />
              </button>
            );
          })}
        </div>

        <div className="bg-[#F8FAFC]/60 p-4 sm:p-5 lg:p-6">
          {activeTab === 'rules' && <RuleManagementTab onChanged={kpiRefetch} openCreateSignal={openCreateSignal} />}
          {activeTab === 'categories' && <CategoriesTab onChanged={kpiRefetch} />}
          {activeTab === 'logs' && <LogsTab />}
          {activeTab === 'versions' && <VersionsTab />}
          {activeTab === 'import-export' && <ImportExportTab onChanged={kpiRefetch} />}
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'settings' && <SettingsTab onChanged={kpiRefetch} />}
        </div>
      </div>
    </div>
  );
}
