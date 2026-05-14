import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as api from '../api';
import StatusBadge from '../components/email/StatusBadge';

export default function HistoryPage() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [search, setSearch] = useState('');
  const [viewBody, setViewBody] = useState<{ subject: string; body: string } | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ['history', month],
    queryFn: () => api.getEmailHistory(month).then(r => r.data as any[]),
  });

  const filtered = (history as any[]).filter(h =>
    !search || h.employeeName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Email History</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track all dispatched attendance emails</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search employee..."
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-48"
          />
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Employee</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Subject</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Sent At</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h: any) => (
              <tr key={h.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800">{h.employeeName}</p>
                  <p className="text-xs text-slate-400">{h.employeeEmail}</p>
                </td>
                <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{h.subject}</td>
                <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                  {h.sentAt ? new Date(h.sentAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge label={h.status} small />
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => setViewBody({ subject: h.subject, body: h.body })}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            No email history found for {month}
          </div>
        )}
      </div>

      {viewBody && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between">
              <h3 className="font-semibold text-slate-800 text-sm">{viewBody.subject}</h3>
              <button onClick={() => setViewBody(null)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{viewBody.body}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
