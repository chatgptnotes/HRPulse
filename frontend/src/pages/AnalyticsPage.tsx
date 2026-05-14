import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from 'recharts';
import { getAnalyticsOverview, getAnalyticsTrends, getMonthlyComparison, getUploads } from '../api';

const STATUS_COLORS: Record<string, string> = {
  Absent: '#ef4444',
  'Missed Swipe': '#f59e0b',
  'Late Coming': '#3b82f6',
  'Early Leaving': '#f97316',
  Incomplete: '#8b5cf6',
};

function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-5 flex items-center gap-4 shadow-sm">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <span className="material-icons text-white text-2xl">{icon}</span>
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null);

  const { data: overview } = useQuery({ queryKey: ['analytics-overview'], queryFn: () => getAnalyticsOverview().then(r => r.data) });
  const { data: uploads } = useQuery({ queryKey: ['uploads'], queryFn: () => getUploads().then(r => r.data) });
  const { data: monthly } = useQuery({ queryKey: ['monthly-comparison'], queryFn: () => getMonthlyComparison().then(r => r.data) });
  const { data: trends } = useQuery({
    queryKey: ['analytics-trends', selectedUploadId],
    queryFn: () => getAnalyticsTrends(selectedUploadId!).then(r => r.data),
    enabled: !!selectedUploadId,
  });

  const pieData = trends?.byStatus
    ? Object.entries(trends.byStatus as Record<string, number>).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">Attendance trends, patterns, and insights across all periods.</p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Employees" value={overview?.totalEmployees ?? '—'} icon="people" color="bg-blue-500" />
        <StatCard label="Uploads" value={overview?.totalUploads ?? '—'} icon="upload_file" color="bg-indigo-500" />
        <StatCard label="Emails Generated" value={overview?.totalEmails ?? '—'} icon="drafts" color="bg-amber-500" />
        <StatCard label="Emails Sent" value={overview?.totalSent ?? '—'} icon="mark_email_read" color="bg-green-500" />
      </div>

      {/* Monthly comparison */}
      {monthly && monthly.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-700 mb-4">Monthly Comparison</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly} margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="flagged" name="Flagged Records" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sent" name="Emails Sent" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Upload selector for drill-down */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Drill down by upload:</label>
        <select
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
          value={selectedUploadId ?? ''}
          onChange={e => setSelectedUploadId(e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">— Select upload —</option>
          {uploads?.map((u: { id: number; filename: string; periodMonth: string }) => (
            <option key={u.id} value={u.id}>{u.periodMonth} — {u.filename}</option>
          ))}
        </select>
      </div>

      {trends && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status distribution */}
          {pieData.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-700 mb-4">Status Distribution</h2>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={false}>
                    {pieData.map(entry => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Daily trend */}
          {trends.byDate && trends.byDate.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-700 mb-4">Daily Flagged Records</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trends.byDate} margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top offenders */}
          {trends.topOffenders && trends.topOffenders.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm lg:col-span-2">
              <h2 className="text-base font-semibold text-slate-700 mb-4">Top Offenders</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trends.topOffenders} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="count" name="Flagged Records" fill="#4f46e5" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {!selectedUploadId && (
        <div className="text-center py-12 text-slate-400">
          <span className="material-icons text-5xl block mb-3 opacity-40">bar_chart</span>
          Select an upload above to see detailed trends and charts.
        </div>
      )}
    </div>
  );
}
