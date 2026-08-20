import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from 'recharts';
import { getAnalyticsOverview, getAnalyticsTrends, getMonthlyComparison, getUploads, getEmployees, getSalaryConfigs, getSalaryDeductions } from '../api';
import SalaryStatsGrid from '../components/salary/SalaryStatsGrid';
import PayrollSummaryBar from '../components/salary/PayrollSummaryBar';

const STATUS_COLORS: Record<string, string> = {
  Absent: '#ef4444',
  'Missed Swipe': '#f59e0b',
  'Late Coming': '#3b82f6',
  'Early Leaving': '#f97316',
  Incomplete: '#8b5cf6',
  HALF_DAY: '#fb923c',
  'Paid Leave': '#14b8a6',
  Normal: '#22c55e',
};

const statusColor = (status: string) => {
  const key = String(status ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  const hit = Object.entries(STATUS_COLORS).find(([k]) => k.toLowerCase().replace(/[_-]+/g, ' ').trim() === key);
  return hit?.[1] || '#94a3b8';
};

function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white p-2 shadow-sm sm:gap-4 sm:rounded-xl sm:p-5">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg sm:h-12 sm:w-12 sm:rounded-xl ${color}`}>
        <span className="material-icons text-lg text-white sm:text-2xl">{icon}</span>
      </div>
      <div>
        <div className="text-xl font-bold leading-none text-slate-800 sm:text-2xl">{value}</div>
        <div className="mt-1 text-xs leading-tight text-slate-500 sm:text-sm">{label}</div>
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

  // Salary data queries
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => getEmployees().then(r => r.data as any[]),
  });

  const { data: configs = [] } = useQuery({
    queryKey: ['salary-configs'],
    queryFn: () => getSalaryConfigs().then(r => r.data as any[]),
  });

  const { data: salaryUploads = [] } = useQuery({
    queryKey: ['uploads'],
    queryFn: () => getUploads().then(r => r.data as any[]),
  });

  // Get latest upload for deductions
  const latestUpload = salaryUploads.find((u: any) => Number(u.rowCount ?? 0) > 0) || salaryUploads[0];

  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', latestUpload?.id],
    queryFn: () => getSalaryDeductions(latestUpload!.id).then(r => r.data as any[]),
    enabled: !!latestUpload?.id,
  });

  // Calculate salary summary
  const salarySummary = useMemo(() => {
    if (!employees.length || !deductions.length || !configs.length) return null;

    const deductionMap = new Map(deductions.map((d: any) => [d.employeeId, d]));
    const configMap = new Map(configs.map((c: any) => [c.employeeId, c]));

    const rows = employees.map(emp => {
      const deduction = deductionMap.get(emp.id);
      const config = configMap.get(emp.id);
      const hasAttendance = deduction && Number(deduction.presentDays || 0) > 0;
      const hasSalary = Number(config?.basicSalary || 0) > 0;
      const hasLop = Number(deduction?.lopAmount || 0) > 0;
      const hasExtraPay = Number(deduction?.extraPayment || 0) > 0;
      return { emp, deduction, config, hasAttendance, hasSalary, hasLop, hasExtraPay };
    });

    return {
      total: rows.length,
      attendance: rows.filter(row => row.hasAttendance).length,
      lop: rows.filter(row => row.hasLop).length,
      extraPay: rows.filter(row => row.hasExtraPay).length,
      missingSalary: rows.filter(row => !row.hasSalary).length,
      totalPayroll: rows.reduce((sum, row) => sum + Number(row.config?.basicSalary || 0), 0),
      netPayable: rows.reduce((sum, row) => sum + Number(row.deduction?.netPayable || 0), 0),
      totalExtraPay: rows.reduce((sum, row) => sum + Number(row.deduction?.extraPayment || 0), 0),
      totalLopAmount: rows.reduce((sum, row) => sum + Number(row.deduction?.lopAmount || 0), 0),
    };
  }, [employees, deductions, configs]);

  const pieData = trends?.byStatus
    ? Object.entries(trends.byStatus as Record<string, number>).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="w-full min-w-0 p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">Attendance trends, patterns, and insights across all periods.</p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Total Employees" value={overview?.totalEmployees ?? '—'} icon="people" color="bg-blue-500" />
        <StatCard label="Uploads" value={overview?.totalUploads ?? '—'} icon="upload_file" color="bg-indigo-500" />
        <StatCard label="Emails Generated" value={overview?.totalEmails ?? '—'} icon="drafts" color="bg-amber-500" />
        <StatCard label="Emails Sent" value={overview?.totalSent ?? '—'} icon="mark_email_read" color="bg-green-500" />
      </div>

      {/* Salary & Attendance Stats */}
      {salarySummary && (
        <>
          <SalaryStatsGrid summary={salarySummary} />
          <PayrollSummaryBar
            totalPayroll={salarySummary.totalPayroll}
            netPayable={salarySummary.netPayable}
            totalExtraPay={salarySummary.totalExtraPay}
            totalLopAmount={salarySummary.totalLopAmount}
          />
        </>
      )}

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
      <div className="flex flex-wrap items-center gap-3">
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
                      <Cell key={entry.name} fill={statusColor(entry.name)} />
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
