import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as api from '../api';

export default function SalaryPage() {
  const qc = useQueryClient();
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(currentMonth);
  const [editValues, setEditValues] = useState<Record<number, string>>({});
  const [toast, setToast] = useState('');

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => api.getEmployees().then(r => r.data as any[]) });
  const { data: configs = [] } = useQuery({ queryKey: ['salary-configs', month], queryFn: () => api.getSalaryConfigs(month).then(r => r.data as any[]) });

  const { data: uploads = [] } = useQuery({ queryKey: ['uploads'], queryFn: () => api.getUploads().then(r => r.data as any[]) });
  const latestUpload = (uploads as any[])[0];
  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', latestUpload?.id],
    queryFn: () => api.getSalaryDeductions(latestUpload!.id).then(r => r.data as any[]),
    enabled: !!latestUpload,
  });

  const getConfig = (empId: number) => (configs as any[]).find(c => c.employeeId === empId);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const saveAll = async () => {
    const bulk = Object.entries(editValues)
      .filter(([, v]) => v !== '' && !isNaN(parseFloat(v)))
      .map(([id, v]) => ({ employeeId: parseInt(id), basicSalary: parseFloat(v), effectiveMonth: month }));
    if (bulk.length === 0) return;
    await api.saveSalaryBulk(bulk);
    qc.invalidateQueries({ queryKey: ['salary-configs', month] });
    qc.invalidateQueries({ queryKey: ['deductions'] });
    setEditValues({});
    showToast(`Saved ${bulk.length} salary configs`);
  };

  const displayEmployees = employees.length > 0 ? employees : (deductions as any[]).map((d: any) => ({ id: d.employeeId, name: d.employeeName }));

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Salary & LOP Deductions</h1>
          <p className="text-sm text-slate-500 mt-0.5">Set basic salary per employee to calculate Loss of Pay</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={saveAll} className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">
            Save All
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Employee</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Basic Salary (AED)</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Absent Days</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Missed Swipe Days</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">LOP Days</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">LOP Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {displayEmployees.slice(0, 100).map((emp: any) => {
              const cfg = getConfig(emp.id);
              const ded = (deductions as any[]).find(d => d.employeeId === emp.id);
              const currentSalary = editValues[emp.id] !== undefined ? editValues[emp.id] : (cfg?.basicSalary || '');
              return (
                <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{emp.name}</p>
                    {emp.email && <p className="text-xs text-slate-400">{emp.email}</p>}
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      value={currentSalary}
                      onChange={e => setEditValues(prev => ({ ...prev, [emp.id]: e.target.value }))}
                      placeholder="Enter salary"
                      className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{ded?.absentDays ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{ded?.missedSwipeDays ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{ded?.lopDays ? ded.lopDays.toFixed(1) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-red-600">
                    {ded?.lopAmount ? `${ded.lopAmount.toLocaleString()}` : cfg?.basicSalary ? '0' : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayEmployees.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p>No employees found. Upload an attendance file first.</p>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
