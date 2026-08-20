/**
 * Rule Analytics — execution trends, top rules, failures, category usage and
 * average execution time, rendered with Recharts.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import clsx from 'clsx';
import { fetchAnalytics } from '../../api/rulesEngine';

const STATUS_COLORS: Record<string, string> = {
  success: '#10b981',
  failed: '#ef4444',
  partial: '#f59e0b',
  skipped: '#94a3b8',
};

export default function AnalyticsTab() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['rules-engine', 'analytics', days],
    queryFn: () => fetchAnalytics(days),
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Rule Analytics</h3>
          <p className="text-sm text-slate-500 mt-0.5">Execution trends, effectiveness and system performance over the last {days} days.</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={clsx('px-4 py-2 text-sm font-medium transition-colors', days === d ? 'bg-purple-600 text-white' : 'text-slate-600 hover:bg-slate-50')}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-64 rounded-2xl border border-slate-200 bg-white animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
            {[
              { label: 'Total Executions', value: data.executionsByDay.reduce((a, b) => a + b.total, 0).toLocaleString(), icon: 'bolt', tone: 'text-purple-600 bg-purple-50' },
              { label: 'Failures', value: data.executionsByDay.reduce((a, b) => a + b.failed, 0).toLocaleString(), icon: 'error', tone: 'text-red-600 bg-red-50' },
              { label: 'Avg Execution Time', value: `${data.avgExecutionMs}ms`, icon: 'speed', tone: 'text-blue-600 bg-blue-50' },
              { label: 'Rules Tracked', value: data.topRules.length, icon: 'rule', tone: 'text-emerald-600 bg-emerald-50' },
            ].map((s) => (
              <div key={s.label} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:gap-3 sm:rounded-2xl sm:p-4">
                <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 sm:rounded-xl', s.tone)}>
                  <span className="material-icons text-base sm:text-xl">{s.icon}</span>
                </span>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-tight text-slate-800 sm:text-lg">{s.value}</p>
                  <p className="truncate text-[10px] text-slate-500 sm:text-sm">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Execution trend */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h4 className="text-base font-semibold text-slate-800 mb-3">Execution Trend</h4>
              {data.executionsByDay.length === 0 ? (
                <EmptyChart label="No executions recorded yet — run rules in the Testing Sandbox to generate data." />
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <AreaChart data={data.executionsByDay}>
                    <defs>
                      <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e8f0' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="total" name="Executions" stroke="#8b5cf6" fill="url(#gTotal)" strokeWidth={2} />
                    <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" fill="url(#gFailed)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Status breakdown */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h4 className="text-base font-semibold text-slate-800 mb-3">Outcome Breakdown</h4>
              {data.statusBreakdown.length === 0 ? (
                <EmptyChart label="No execution outcomes yet." />
              ) : (
                <div className="flex flex-col sm:flex-row items-center">
                  <ResponsiveContainer width="100%" height={230} className="sm:w-[55%]">
                    <PieChart>
                      <Pie data={data.statusBreakdown} dataKey="count" nameKey="status" innerRadius={55} outerRadius={85} paddingAngle={3}>
                        {data.statusBreakdown.map((s) => <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? '#94a3b8'} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2.5 mt-3 sm:mt-0">
                    {data.statusBreakdown.map((s) => (
                      <div key={s.status} className="flex items-center gap-2.5 text-sm">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: STATUS_COLORS[s.status] ?? '#94a3b8' }} />
                        <span className="text-slate-600 capitalize w-20">{s.status}</span>
                        <span className="font-semibold text-slate-800">{s.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Top rules */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h4 className="text-base font-semibold text-slate-800 mb-3">Most Executed Rules</h4>
              {data.topRules.length === 0 ? (
                <EmptyChart label="No rule executions yet." />
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data.topRules} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                    <YAxis type="category" dataKey="ruleName" width={150} tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" name="Executions" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                    <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Top categories */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h4 className="text-base font-semibold text-slate-800 mb-3">Rules by Category</h4>
              {data.topCategories.length === 0 ? (
                <EmptyChart label="No categories in use yet." />
              ) : (
                <div className="space-y-2.5 pt-1">
                  {data.topCategories.slice(0, 8).map((c, i) => {
                    const max = data.topCategories[0].ruleCount || 1;
                    return (
                      <div key={c.categoryId}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-slate-600 font-medium">{c.categoryName}</span>
                          <span className="text-slate-400">{c.ruleCount}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={clsx('h-full rounded-full', ['bg-purple-500', 'bg-indigo-500', 'bg-blue-500', 'bg-teal-500', 'bg-emerald-500', 'bg-amber-500', 'bg-pink-500', 'bg-slate-400'][i % 8])}
                            style={{ width: `${Math.max(6, (c.ruleCount / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[230px] flex flex-col items-center justify-center text-center text-sm text-slate-400 px-4">
      <span className="material-icons text-4xl mb-2 opacity-40">insights</span>
      {label}
    </div>
  );
}
