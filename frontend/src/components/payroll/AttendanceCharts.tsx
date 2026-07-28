import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const DOUGHNUT_COLORS: Record<string, string> = {
  Present: '#10b981',
  Absent: '#ef4444',
  'Half Day': '#f59e0b',
  Late: '#6366f1',
};

export interface DoughnutDatum { name: string; value: number }
export interface BarDatum { department: string; present: number; absent: number }

interface Props {
  doughnut: DoughnutDatum[];
  bars: BarDatum[];
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-64 flex flex-col items-center justify-center text-slate-300">
      <span className="material-icons text-5xl mb-2">bar_chart</span>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

// Attendance analytics: a doughnut of attendance-day mix and a department-wise
// present-vs-absent bar chart. Both powered by recharts.
export default function AttendanceCharts({ doughnut, bars }: Props) {
  const hasData = doughnut.some(d => d.value > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Doughnut */}
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-slate-800">Attendance Overview</h3>
          <span className="material-icons text-slate-300 text-base">donut_large</span>
        </div>
        {hasData ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={doughnut}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={58}
                outerRadius={92}
                paddingAngle={2}
                stroke="none"
              >
                {doughnut.map(d => <Cell key={d.name} fill={DOUGHNUT_COLORS[d.name] || '#94a3b8'} />)}
              </Pie>
              <Tooltip
                formatter={(v: any, n: any) => [`${v} days`, n]}
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : <EmptyChart label="Upload attendance to see the overview" />}
      </div>

      {/* Department bar */}
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-slate-800">Department-wise Attendance</h3>
          <span className="material-icons text-slate-300 text-base">bar_chart</span>
        </div>
        {bars.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bars} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="department" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-12} textAnchor="end" height={48} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip
                formatter={(v: any, n: any) => [`${v} days`, n === 'present' ? 'Present' : 'Absent']}
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                cursor={{ fill: '#f1f5f9' }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="present" name="Present" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="absent" name="Absent" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyChart label="No department data for this period" />}
      </div>
    </div>
  );
}
