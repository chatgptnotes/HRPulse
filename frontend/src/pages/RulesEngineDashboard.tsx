/**
 * Rules Engine Dashboard — enterprise rule management shell.
 *
 * KPI cards + navigation tabs. Each tab is a dedicated component under
 * components/rules/. All data flows through the Supabase data layer
 * (api/rulesEngine.ts) via react-query.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

function KpiCard({ icon, label, value, color, accent }: { icon: string; label: string; value: number; color: string; accent: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 flex items-center gap-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <div className={`${color} w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm`}>
        <span className="material-icons text-white text-2xl">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-2xl sm:text-3xl font-bold text-slate-800 leading-tight">{value.toLocaleString()}</p>
        <p className="text-sm text-slate-500 truncate">{label}</p>
      </div>
      <div className={`ml-auto w-1.5 h-12 rounded-full ${accent}`} aria-hidden="true" />
    </div>
  );
}

function KpiSkeletons() {
  return (
    <>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200/70 p-5 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-200" />
            <div className="flex-1 space-y-2.5">
              <div className="h-7 w-16 bg-slate-200 rounded" />
              <div className="h-3.5 w-24 bg-slate-100 rounded" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function RulesEngineDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('rules');
  const qc = useQueryClient();

  const { data: kpis, isLoading, error: kpiError } = useQuery({
    queryKey: ['rules-engine', 'kpis'],
    queryFn: fetchKpis,
    retry: false,
  });

  const kpiRefetch = () => qc.invalidateQueries({ queryKey: ['rules-engine'] });

  const migrationMissing = kpiError && /relation|does not exist|PGRST|Could not find/i.test(String((kpiError as Error).message));

  return (
    <div className="w-full min-w-0 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 lg:mb-8">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <span className="material-icons text-white text-2xl">settings_suggest</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Rules Engine</h1>
            <p className="text-slate-500 text-sm sm:text-base mt-0.5">Dynamic business rule management — create, test, audit and deploy rules without code</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-500 shrink-0">
          <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium border border-emerald-200/60">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Engine Online
          </span>
        </div>
      </div>

      {/* Migration missing banner */}
      {migrationMissing && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5 text-sm sm:text-base text-amber-900">
          <p className="font-semibold flex items-center gap-2">
            <span className="material-icons text-xl">warning</span>
            Rules Engine tables are not created yet
          </p>
          <p className="mt-2 leading-relaxed">
            Apply <code className="px-1.5 py-0.5 bg-amber-100 rounded text-sm">supabase/migrations/20260818_rules_engine.sql</code> in the
            Supabase Dashboard → <strong>SQL Editor</strong> → paste → <strong>Run</strong>. This creates all 11 rule tables, seeds the
            16 categories and 5 starter rules. Refresh this page afterwards.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6 lg:mb-8">
        {isLoading ? (
          <KpiSkeletons />
        ) : (
          <>
            <KpiCard icon="rule" label="Total Rules" value={kpis?.totalRules ?? 0} color="bg-gradient-to-br from-blue-500 to-blue-600" accent="bg-blue-400" />
            <KpiCard icon="check_circle" label="Active Rules" value={kpis?.activeRules ?? 0} color="bg-gradient-to-br from-emerald-500 to-emerald-600" accent="bg-emerald-400" />
            <KpiCard icon="block" label="Inactive Rules" value={kpis?.inactiveRules ?? 0} color="bg-gradient-to-br from-slate-400 to-slate-500" accent="bg-slate-300" />
            <KpiCard icon="bolt" label="Executed Today" value={kpis?.executedToday ?? 0} color="bg-gradient-to-br from-purple-500 to-purple-600" accent="bg-purple-400" />
            <KpiCard icon="error" label="Failed Executions" value={kpis?.failedToday ?? 0} color="bg-gradient-to-br from-red-500 to-red-600" accent="bg-red-400" />
            <KpiCard icon="pending_actions" label="Pending Approval" value={kpis?.pendingApprovals ?? 0} color="bg-gradient-to-br from-amber-500 to-amber-600" accent="bg-amber-400" />
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto border-b border-slate-100 [scrollbar-width:thin]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-4 sm:px-5 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-600 text-purple-700 bg-purple-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <span className="material-icons text-xl">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-5 lg:p-6">
          {activeTab === 'rules' && <RuleManagementTab onChanged={kpiRefetch} />}
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