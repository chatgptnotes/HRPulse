import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as api from '../api';
import EmailDraftModal from '../components/email/EmailDraftModal';

const formatINR = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function SalaryPage() {
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(currentMonth);
  const monthWasSelected = useRef(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('attendance');
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [attendanceEmployee, setAttendanceEmployee] = useState<any | null>(null);

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => api.getEmployees().then(r => r.data as any[]) });
  const { data: configs = [] } = useQuery({ queryKey: ['salary-configs', month], queryFn: () => api.getSalaryConfigs(month).then(r => r.data as any[]) });

  const { data: uploads = [] } = useQuery({ queryKey: ['uploads'], queryFn: () => api.getUploads().then(r => r.data as any[]) });
  // Ignore an empty/failed import when choosing the attendance month.
  // Otherwise Salary/LOP can incorrectly show Attendance = 0 even though a
  // previous successful upload contains records.
  const latestUpload = (uploads as any[]).find(upload => Number(upload.rowCount ?? upload.row_count ?? 0) > 0) || (uploads as any[])[0];
  useEffect(() => {
    if (!monthWasSelected.current && latestUpload?.periodMonth && latestUpload.periodMonth !== month) {
      setMonth(latestUpload.periodMonth);
    }
  }, [latestUpload?.periodMonth, month]);
  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', latestUpload?.id],
    queryFn: () => api.getSalaryDeductions(latestUpload!.id).then(r => r.data as any[]),
    enabled: !!latestUpload,
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const rows = useMemo(() => {
    const deductionMap = new Map((deductions as any[]).map(d => [d.employeeId, d]));
    const configMap = new Map((configs as any[]).map(c => [c.employeeId, c]));
    return (employees as any[]).map(emp => {
      const deduction = deductionMap.get(emp.id);
      const config = configMap.get(emp.id);
      const hasAttendance = !!deduction;
      const hasSalary = Number(config?.basicSalary || 0) > 0;
      const hasLop = Number(deduction?.lopAmount || 0) > 0;
      return { emp, deduction, config, hasAttendance, hasSalary, hasLop };
    });
  }, [employees, deductions, configs]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      const searchable = `${String(row.emp.name || '')} ${String(row.emp.email || '')} ${String(row.emp.employeeNumber || row.emp.employee_number || '')}`.toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (filter === 'attendance') return row.hasAttendance;
      if (filter === 'missing-attendance') return !row.hasAttendance;
      if (filter === 'lop') return row.hasLop;
      if (filter === 'missing-salary') return !row.hasSalary;
      if (filter === 'payable') return row.hasSalary;
      return true;
    }).sort((a, b) => Number(b.hasSalary) - Number(a.hasSalary));
  }, [rows, search, filter]);

  const summary = useMemo(() => ({
    total: rows.length,
    attendance: rows.filter(row => row.hasAttendance).length,
    lop: rows.filter(row => row.hasLop).length,
    missingSalary: rows.filter(row => !row.hasSalary).length,
  }), [rows]);

  const companyOf = (emp: any) => {
    const value = `${emp.organisation || emp.organisation_name || ''} ${emp.entity || ''} ${emp.department || ''}`.toLowerCase();
    if (value.includes('ayushman')) return 'Ayushman';
    if (value.includes('hope')) return 'Hope';
    if (/(^|[^a-z])it([^a-z]|$)|information technology/.test(value)) return 'IT';
    return 'Other';
  };

  const printSalarySheet = (company: string) => {
    const printable = rows.filter(row => row.hasSalary && (company === 'All' || companyOf(row.emp) === company));
    const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const body = printable.map(({ emp, config: cfg, deduction: ded }) => {
      const salary = Number(cfg?.basicSalary || 0);
      const lop = Number(ded?.lopAmount || 0);
      const overtime = Number(ded?.overtimeAmount || 0);
      const net = Math.max(0, salary - lop + overtime);
      return `<tr><td>${emp.name || ''}</td><td>${companyOf(emp)}</td><td>${money(salary)}</td><td>${ded?.overtimeEligibleDays ?? 0}</td><td>${money(overtime)}</td><td>${ded?.lopDays ?? 0}</td><td>${money(lop)}</td><td>${money(net)}</td></tr>`;
    }).join('');
    const popup = window.open('', '_blank', 'width=1100,height=750');
    if (!popup) return;
    popup.document.write(`<html><head><title>Salary Sheet - ${company}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#172033}h1{margin:0 0 4px}p{color:#64748b}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#eef2ff}td:nth-child(n+3),th:nth-child(n+3){text-align:right}@media print{button{display:none}}</style></head><body><h1>Salary Sheet</h1><p>${company === 'All' ? 'All Companies' : company} · ${month}</p><button onclick="window.print()">Print</button><table><thead><tr><th>Employee</th><th>Company</th><th>Salary (₹)</th><th>OT Hours</th><th>LOP Days</th><th>LOP Amount (₹)</th><th>Net Payable (₹)</th></tr></thead><tbody>${body || '<tr><td colspan="7">No salaried employees found</td></tr>'}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
    setShowPrintOptions(false);
  };

  return (
    <div className="w-full min-w-0 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Salary & LOP Deductions</h1>
          <p className="text-sm text-slate-500 mt-0.5">Salary is taken automatically from Employee Master and calculated from attendance.</p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <input type="month" value={month} onChange={e => { monthWasSelected.current = true; setMonth(e.target.value); }} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button onClick={() => setShowPrintOptions(true)} className="border border-slate-200 bg-white text-slate-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">
              Print Salary
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employees</p>
          <p className="mt-0.5 text-lg font-bold text-slate-800">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Attendance</p>
          <p className="mt-0.5 text-lg font-bold text-emerald-600">{summary.attendance}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Has LOP</p>
          <p className="mt-0.5 text-lg font-bold text-red-600">{summary.lop}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Missing salary</p>
          <p className="mt-0.5 text-lg font-bold text-amber-600">{summary.missingSalary}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <span className="material-icons pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-slate-400">search</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email or ID..." className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[['payable', 'Net payable'], ['all', 'All'], ['attendance', 'With attendance'], ['missing-attendance', 'Missing attendance'], ['lop', 'Has LOP'], ['missing-salary', 'Missing salary']].map(([value, label]) => (
              <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${filter === value ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="w-full overflow-x-auto pb-2">
        <table className="w-full min-w-[1180px] table-auto text-[11px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky left-0 z-10 bg-slate-50 px-1.5 py-2.5 text-left font-semibold text-slate-600 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.35)]">Employee</th>
              <th className="px-0.5 py-2.5 text-left font-semibold text-slate-600">Salary<br />(₹)</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-emerald-700">Present<br />Days</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-slate-600">Absent<br />Days</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-slate-600">Half<br />Days</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-slate-600">Late<br />Count</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-slate-600">OT<br />Days</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-slate-600">Paid<br />Leave</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-slate-600">LOP<br />Days</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-slate-600">LOP<br />Amount</th>
              <th className="px-0.5 py-2.5 text-center font-semibold text-emerald-700">Net<br />Payable</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ emp, config: cfg, deduction: ded, hasAttendance, hasSalary }) => {
              const currentSalary = Number(cfg?.basicSalary || 0);
              const liveLopAmount = ded ? Number(ded.lopAmount || 0) : null;
              const overtimeAmount = ded ? Number(ded.overtimeAmount || 0) : 0;
              const netPayable = currentSalary > 0 ? Math.max(0, currentSalary - (liveLopAmount || 0) + overtimeAmount) : null;
              return (
                <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="sticky left-0 z-[1] max-w-0 overflow-hidden bg-white px-1.5 py-2.5 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.35)]">
                    <button type="button" onClick={() => latestUpload?.id && setAttendanceEmployee(emp)} className="w-full text-left" title="Open attendance details">
                      <p className="break-words font-medium leading-tight text-slate-800 hover:text-brand-600" title={emp.name}>{emp.name}</p>
                      {emp.email && <p className="break-all text-[10px] leading-tight text-slate-400" title={emp.email}>{emp.email}</p>}
                      <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${!hasAttendance ? 'bg-slate-100 text-slate-500' : ded?.lopAmount ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        {!hasAttendance ? 'No attendance' : ded?.lopAmount ? 'LOP calculated' : 'Attendance loaded'}
                      </span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5">
                    <p className="font-medium text-slate-700">{currentSalary > 0 ? formatINR(currentSalary) : '—'}</p>
                    {cfg?.effectiveMonth && cfg.effectiveMonth !== month && (
                      <p className="mt-1 text-[11px] text-slate-400">Carried from {cfg.effectiveMonth}</p>
                    )}
                    {!hasSalary && <p className="mt-1 text-[10px] font-medium text-amber-600">Missing salary</p>}
                  </td>
                  <td className="px-0.5 py-2.5 text-center font-medium text-emerald-700"><button type="button" onClick={() => latestUpload?.id && setAttendanceEmployee(emp)} className="rounded px-1.5 py-0.5 hover:bg-emerald-50 hover:underline" title="View attendance dates">{ded ? Number(ded.presentDays || 0).toFixed(Number(ded.presentDays || 0) % 1 ? 1 : 0) : '—'}</button></td>
                  <td className="px-0.5 py-2.5 text-center text-slate-600">{ded?.absentDays ?? '—'}</td>
                  <td className="px-0.5 py-2.5 text-center text-slate-600">{ded?.halfDays ?? '—'}</td>
                  <td className="px-0.5 py-2.5 text-center text-slate-600">{ded?.lateOccurrences ?? '—'}</td>
                  <td className="px-0.5 py-2.5 text-center font-medium text-indigo-600">{ded?.overtimeEligibleDays || '—'}</td>
                  <td className="px-0.5 py-2.5 text-center text-slate-600">{ded ? `${ded.paidLeaveUsed}/${ded.leaveLimit}` : '—'}</td>
                  <td className="px-0.5 py-2.5 text-center text-slate-600">{ded?.lopDays ? ded.lopDays.toFixed(1) : '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-center font-medium text-red-600">
                    {liveLopAmount !== null ? formatINR(liveLopAmount) : Number(currentSalary) > 0 ? '₹0' : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-center font-semibold text-emerald-700">
                    {netPayable !== null ? formatINR(netPayable) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {filteredRows.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p>{rows.length === 0 ? 'No employees found. Upload an attendance file first.' : 'No employees match this search or filter.'}</p>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {showPrintOptions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-800">Print salary sheet</h2>
            <p className="mt-1 text-sm text-slate-500">Only employees with salary and Net Payable will be printed.</p>
            <div className="mt-4 space-y-2">
              {['All', 'Ayushman', 'Hope', 'IT', 'Other'].map(company => (
                <button key={company} onClick={() => printSalarySheet(company)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50">
                  {company === 'All' ? 'All companies' : company}
                  <span className="material-icons text-base text-slate-400">print</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowPrintOptions(false)} className="mt-4 w-full rounded-xl border border-slate-200 py-2 text-sm text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {attendanceEmployee && latestUpload?.id && (
        <EmailDraftModal
          uploadId={latestUpload.id}
          employeeId={attendanceEmployee.id}
          employeeName={attendanceEmployee.name || ''}
          employeeEmail={attendanceEmployee.email || ''}
          initialTab="records"
          recordsOnly
          onClose={() => setAttendanceEmployee(null)}
          onSent={() => setAttendanceEmployee(null)}
        />
      )}
    </div>
  );
}
