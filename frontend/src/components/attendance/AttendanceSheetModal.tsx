import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../api';
import clsx from 'clsx';

interface DayRow { date: string; timeIn: string; timeOut: string; status: string; workingHours: number; }
interface EmpRow {
  employeeId: number; employeeNumber: string; name: string; department: string; designation: string; days: DayRow[];
}

const STATUS_COLOR: Record<string, string> = {
  Normal: 'bg-emerald-50 text-emerald-700',
  Present: 'bg-emerald-50 text-emerald-700',
  Absent: 'bg-red-50 text-red-700',
  'Missed Swipe': 'bg-orange-50 text-orange-700',
  'Late Coming': 'bg-yellow-50 text-yellow-700',
  'Early Leaving': 'bg-blue-50 text-blue-700',
  Weekend: 'bg-slate-100 text-slate-500',
  Holiday: 'bg-slate-100 text-slate-500',
  'Paid Leave': 'bg-purple-50 text-purple-700',
};

type Mode = 'in' | 'out' | 'all';

export default function AttendanceSheetModal({ uploadId, periodMonth, onClose }: { uploadId: number; periodMonth: string; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<Mode>('in');

  const { data: sheet = [], isLoading } = useQuery<EmpRow[]>({
    queryKey: ['attendance-sheet', uploadId],
    queryFn: () => api.getAttendanceSheet(uploadId).then(r => r.data),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return sheet;
    return sheet.filter(e => e.name.toLowerCase().includes(q) || (e.employeeNumber || '').toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q));
  }, [sheet, search]);

  // Build the rows for the active mode.
  const rows = useMemo(() => {
    const out: Array<{ emp: EmpRow; day: DayRow }> = [];
    for (const e of filtered) {
      for (const d of e.days) {
        if (mode === 'in' && !d.timeIn) continue;
        if (mode === 'out' && !d.timeOut) continue;
        out.push({ emp: e, day: d });
      }
    }
    return out;
  }, [filtered, mode]);

  const totalMembers = sheet.length;
  const punchInCount = sheet.reduce((a, e) => a + e.days.filter(d => d.timeIn).length, 0);
  const punchOutCount = sheet.reduce((a, e) => a + e.days.filter(d => d.timeOut).length, 0);

  const MODE_TABS: Array<{ id: Mode; label: string; icon: string; color: string }> = [
    { id: 'in', label: 'Punch In', icon: 'login', color: 'text-emerald-700' },
    { id: 'out', label: 'Punch Out', icon: 'logout', color: 'text-indigo-700' },
    { id: 'all', label: 'All (In + Out)', icon: 'view_list', color: 'text-slate-700' },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Attendance Sheet — {periodMonth}</h3>
            <p className="text-sm text-slate-500 mt-0.5">{totalMembers} members · {punchInCount} punch-in · {punchOutCount} punch-out records</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {MODE_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setMode(t.id)}
                className={clsx('text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5', mode === t.id ? 'bg-white shadow-sm ' + t.color : 'text-slate-500 hover:text-slate-700')}
              >
                <span className="material-icons text-sm">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, number, department…"
              className="w-full text-sm border border-slate-200 rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-slate-50"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isLoading && <p className="text-sm text-slate-400 text-center py-10">Loading attendance…</p>}
          {!isLoading && rows.length === 0 && <p className="text-sm text-slate-400 text-center py-10">No records for this view.</p>}

          {mode === 'in' && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-emerald-50 z-10">
                <tr className="border-b border-emerald-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-emerald-700 uppercase">Emp #</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-emerald-700 uppercase">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-emerald-700 uppercase">Dept</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-emerald-700 uppercase">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-emerald-700 uppercase">Punch In Time</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-emerald-700 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, day }, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-emerald-50/40">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{emp.employeeNumber || emp.employeeId}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{emp.name}</td>
                    <td className="px-4 py-2 text-slate-600">{emp.department || '—'}</td>
                    <td className="px-4 py-2 text-slate-700">{day.date}</td>
                    <td className="px-4 py-2"><span className="font-mono font-semibold text-emerald-700">{day.timeIn}</span></td>
                    <td className="px-4 py-2"><span className={clsx('inline-block px-2 py-0.5 rounded-md text-[10px] font-medium', STATUS_COLOR[day.status] || 'bg-slate-100 text-slate-600')}>{day.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {mode === 'out' && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-indigo-50 z-10">
                <tr className="border-b border-indigo-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-700 uppercase">Emp #</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-700 uppercase">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-700 uppercase">Dept</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-700 uppercase">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-700 uppercase">Punch Out Time</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-indigo-700 uppercase">Hours</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-700 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, day }, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-indigo-50/40">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{emp.employeeNumber || emp.employeeId}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{emp.name}</td>
                    <td className="px-4 py-2 text-slate-600">{emp.department || '—'}</td>
                    <td className="px-4 py-2 text-slate-700">{day.date}</td>
                    <td className="px-4 py-2"><span className="font-mono font-semibold text-indigo-700">{day.timeOut}</span></td>
                    <td className="px-4 py-2 text-right text-slate-600">{day.workingHours ? day.workingHours.toFixed(1) : '—'}</td>
                    <td className="px-4 py-2"><span className={clsx('inline-block px-2 py-0.5 rounded-md text-[10px] font-medium', STATUS_COLOR[day.status] || 'bg-slate-100 text-slate-600')}>{day.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {mode === 'all' && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Emp #</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Dept</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-emerald-600 uppercase">Punch In</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-600 uppercase">Punch Out</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Hours</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, day }, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{emp.employeeNumber || emp.employeeId}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{emp.name}</td>
                    <td className="px-4 py-2 text-slate-600">{emp.department || '—'}</td>
                    <td className="px-4 py-2 text-slate-700">{day.date}</td>
                    <td className="px-4 py-2 font-mono text-slate-800">{day.timeIn || '—'}</td>
                    <td className="px-4 py-2 font-mono text-slate-800">{day.timeOut || '—'}</td>
                    <td className="px-4 py-2 text-right text-slate-600">{day.workingHours ? day.workingHours.toFixed(1) : '—'}</td>
                    <td className="px-4 py-2"><span className={clsx('inline-block px-2 py-0.5 rounded-md text-[10px] font-medium', STATUS_COLOR[day.status] || 'bg-slate-100 text-slate-600')}>{day.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400">Showing {rows.length} records{search ? ` · ${filtered.length} of ${totalMembers} members` : ''}</span>
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 font-medium">Close</button>
        </div>
      </div>
    </div>
  );
}
