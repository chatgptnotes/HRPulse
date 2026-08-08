import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as api from '../api';
import EmailDraftModal from '../components/email/EmailDraftModal';
import LopBreakdown from '../components/salary/LopBreakdown';
import { formatINR } from '../lib/dayWiseSalary';
import TablePagination, { PAGE_SIZE } from '../components/TablePagination';

export default function SalaryPage() {
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(currentMonth);
  const monthWasSelected = useRef(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('attendance');
  const [companyFilter, setCompanyFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  // The whole payroll row, not just the employee: the details modal needs the
  // deduction and the salary to show what each day was worth.
  const [attendanceRow, setAttendanceRow] = useState<any | null>(null);
  // Which attendance statuses the details modal should list. null = all records.
  const [attendanceFilter, setAttendanceFilter] = useState<{ statuses: string[]; label: string; includeSundays?: boolean; note?: string } | null>(null);
  // Which employee's LOP is being explained, if any.
  const [lopExplain, setLopExplain] = useState<any | null>(null);

  const openAttendance = (row: any, filter: { statuses: string[]; label: string; includeSundays?: boolean; note?: string } | null = null) => {
    if (!latestUpload?.id) return;
    setAttendanceFilter(filter);
    setAttendanceRow(row);
  };

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

  const companyOf = (emp: any) => {
    const value = [emp.organisation, emp.organisation_name, emp.organization, emp.company, emp.entity, emp.department].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    // Rafttar first: the IT team is recorded as "Rafttar/Hope", and matching
    // Hope first would file them under the hospital.
    if (value.includes('rafttar')) return 'Rafttar';
    if (value.includes('ayushman')) return 'Ayushman';
    if (value.includes('hope')) return 'Hope';
    if (/(^|[^a-z])it([^a-z]|$)|information technology/.test(value)) return 'IT';
    return 'Other';
  };

  const rows = useMemo(() => {
    const deductionMap = new Map((deductions as any[]).map(d => [d.employeeId, d]));
    const configMap = new Map((configs as any[]).map(c => [c.employeeId, c]));
    return (employees as any[]).map(emp => {
      const deduction = deductionMap.get(emp.id);
      const config = configMap.get(emp.id);
      // An employee with only absent rows still gets a deductions entry, so
      // "has attendance" means at least one day actually worked.
      const hasAttendance = !!deduction && Number(deduction.presentDays || 0) > 0;
      const hasSalary = Number(config?.basicSalary || 0) > 0;
      const hasLop = Number(deduction?.lopAmount || 0) > 0;
      return { emp, deduction, config, hasAttendance, hasSalary, hasLop };
    });
  }, [employees, deductions, configs]);

  // No attendance for this month means every row would fail the default
  // "With attendance" filter and the whole payroll list would look empty.
  // Fall back to showing everyone so salaries stay visible.
  const noAttendanceData = rows.length > 0 && rows.every(row => !row.hasAttendance);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const normalizedQuery = query.replace(/[^a-z0-9]+/g, '');
    return rows.filter(row => {
      const searchable = [row.emp.name, row.emp.email, row.emp.employeeNumber, row.emp.employee_number, row.emp.employeeId, row.emp.id]
        .filter(value => value !== null && value !== undefined)
        .map(value => String(value).toLowerCase())
        .join(' ');
      const normalizedSearchable = searchable.replace(/[^a-z0-9]+/g, '');
      if (query && !searchable.includes(query) && !normalizedSearchable.includes(normalizedQuery)) return false;
      if (companyFilter !== 'All' && companyOf(row.emp) !== companyFilter) return false;
      if (filter === 'attendance') return noAttendanceData ? true : row.hasAttendance;
      if (filter === 'missing-attendance') return !row.hasAttendance;
      if (filter === 'lop') return row.hasLop;
      if (filter === 'missing-salary') return !row.hasSalary;
      if (filter === 'payable') return row.hasSalary;
      return true;
    }).sort((a, b) => Number(b.hasSalary) - Number(a.hasSalary));
  }, [rows, search, filter, companyFilter, noAttendanceData]);

  // Changing what is being looked for starts the reading again from the top;
  // staying on page 7 of a freshly narrowed list shows an empty table.
  useEffect(() => { setPage(1); }, [search, filter, companyFilter, month]);
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasActiveFilters = Boolean(search.trim()) || filter !== 'attendance' || companyFilter !== 'All';
  const clearFilters = () => { setSearch(''); setFilter('attendance'); setCompanyFilter('All'); };

  const summary = useMemo(() => ({
    total: rows.length,
    attendance: rows.filter(row => row.hasAttendance).length,
    lop: rows.filter(row => row.hasLop).length,
    extraPay: rows.filter(row => Number(row.deduction?.extraPayment || 0) > 0).length,
    missingSalary: rows.filter(row => !row.hasSalary).length,
  }), [rows]);

  const printSalarySheet = (company: string) => {
    const printable = rows.filter(row => row.hasSalary && row.hasAttendance && (company === 'All' || companyOf(row.emp) === company));
    const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const body = printable.map(({ emp, config: cfg, deduction: ded }) => {
      const salary = Number(cfg?.basicSalary || 0);
      const lop = Number(ded?.lopAmount || 0);
      const extra = Number(ded?.extraPayment || 0);
      // The engine owns the formula. Recomputing it here is how the print sheet
      // and the email draft drifted apart from the grid in the first place.
      const net = Number(ded?.netPayable || 0);
      return `<tr><td>${emp.name || ''}</td><td>${companyOf(emp)}</td><td>${money(salary)}</td><td>${ded?.payableDays ?? 0}</td><td>${ded?.lopDays ?? 0}</td><td>${money(lop)}</td><td>${ded?.extraPayableDays ?? 0}</td><td>${money(extra)}</td><td>${money(net)}</td></tr>`;
    }).join('');
    const popup = window.open('', '_blank', 'width=1100,height=750');
    if (!popup) return;
    popup.document.write(`<html><head><title>Salary Sheet - ${company}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#172033}h1{margin:0 0 4px}p{color:#64748b}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#eef2ff}td:nth-child(n+3),th:nth-child(n+3){text-align:right}@media print{button{display:none}}</style></head><body><h1>Salary Sheet</h1><p>${company === 'All' ? 'All Companies' : company} · ${month}</p><button onclick="window.print()">Print</button><table><thead><tr><th>Employee</th><th>Company</th><th>Salary (₹)</th><th>Payable Days</th><th>Loss of Pay (Days)</th><th>Loss of Pay (₹)</th><th>Extra Days</th><th>Extra Pay (₹)</th><th>Net Payable (₹)</th></tr></thead><tbody>${body || '<tr><td colspan="9">No salaried employees found</td></tr>'}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
    setShowPrintOptions(false);
  };

  return (
    <div className="w-full min-w-0 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Salary & Loss of Pay</h1>
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

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employees</p>
          <p className="mt-0.5 text-lg font-bold text-slate-800">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Attendance</p>
          <p className="mt-0.5 text-lg font-bold text-emerald-600">{summary.attendance}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Has loss of pay</p>
          <p className="mt-0.5 text-lg font-bold text-red-600">{summary.lop}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Has extra pay</p>
          <p className="mt-0.5 text-lg font-bold text-emerald-600">{summary.extraPay}</p>
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
            {[['payable', 'Net payable'], ['all', 'All'], ['attendance', 'With attendance'], ['missing-attendance', 'Missing attendance'], ['lop', 'Has loss of pay'], ['missing-salary', 'Missing salary']].map(([value, label]) => (
              <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${filter === value ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-slate-200 pt-2 sm:border-t-0 sm:pt-0">
              {['All', 'Ayushman', 'Hope', 'Rafttar', 'IT', 'Other'].map(company => (
              <button key={company} onClick={() => setCompanyFilter(company)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${companyFilter === company ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100'}`}>
                {company === 'All' ? 'All companies' : company}
              </button>
            ))}
          </div>
        </div>
        {noAttendanceData && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <span className="material-icons text-sm">info</span>
            <span>No attendance records for {month}. Showing salary only — import an attendance file to calculate loss of pay, overtime and net payable.</span>
          </div>
        )}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-600">Showing:</span>
            {search.trim() && <span className="rounded-md bg-indigo-50 px-2 py-1 text-indigo-700">Search “{search.trim()}”</span>}
            {companyFilter !== 'All' && <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">Company: {companyFilter}</span>}
            {filter !== 'attendance' && <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">Status: {filter === 'missing-attendance' ? 'Missing attendance' : filter === 'missing-salary' ? 'Missing salary' : filter === 'lop' ? 'Has loss of pay' : filter === 'payable' ? 'Net payable' : 'All'}</span>}
            <button onClick={clearFilters} className="ml-auto font-semibold text-indigo-600 hover:text-indigo-800">Clear filters</button>
          </div>
        )}
        {/* A fade on the right edge whenever the table is wider than its box, so a
            column pushed off-screen is visible rather than silently cut off. */}
        <div className="relative">
        <div className="w-full overflow-x-auto pb-2">
        <table className="w-full min-w-[1220px] table-auto text-[10px] tabular-nums sm:text-[11px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="z-10 bg-slate-50 px-2 py-2.5 text-left font-semibold text-slate-600 md:sticky md:left-0 md:shadow-[4px_0_8px_-6px_rgba(15,23,42,0.35)]">Employee</th>
              <th className="px-1 py-2.5 text-right font-semibold text-slate-600 sm:px-2">Salary<br />(₹)</th>
              <th className="px-1 py-2.5 text-right font-semibold text-emerald-700 sm:px-1.5">Present<br />Days</th>
              <th className="px-1 py-2.5 text-right font-semibold text-emerald-700 sm:px-1.5">Payable<br />Days</th>
              <th className="px-1 py-2.5 text-right font-semibold text-slate-600 sm:px-1.5">Absent<br />Days</th>
              <th className="px-1 py-2.5 text-right font-semibold text-slate-600 sm:px-1.5">Half<br />Days</th>
              <th className="px-1 py-2.5 text-right font-semibold text-slate-600 sm:px-1.5">Late<br />Count</th>
              <th className="px-1 py-2.5 text-right font-semibold text-slate-600 sm:px-1.5">Paid<br />Leave</th>
              <th className="px-1 py-2.5 text-right font-semibold text-slate-600 sm:px-1.5">Loss of Pay<br />Days</th>
              <th className="px-1 py-2.5 text-right font-semibold text-slate-600 sm:px-2">Loss of Pay<br />Amount</th>
              <th className="px-1 py-2.5 text-right font-semibold text-emerald-700 sm:px-1.5">Extra<br />Days</th>
              <th className="px-1 py-2.5 text-right font-semibold text-emerald-700 sm:px-2">Extra Pay<br />Amount</th>
              <th className="px-1 py-2.5 text-right font-semibold text-emerald-700 sm:px-2">Net<br />Payable</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => {
              const { emp, config: cfg, deduction: ded, hasAttendance, hasSalary } = row;
              const currentSalary = Number(cfg?.basicSalary || 0);
              const liveLopAmount = ded ? Number(ded.lopAmount || 0) : null;
              const liveExtraPayment = ded ? Number(ded.extraPayment || 0) : 0;
              // Read, never recomputed — the engine counts the payable days and
              // owns the formula, and every screen has to tell the same story.
              const netPayable = ded && currentSalary > 0 ? Number(ded.netPayable || 0) : null;
              // A month whose import is short of dates cannot be paid in full,
              // because a day nobody recorded is a day nobody is paid for.
              const daysMissing = ded ? Math.max(0, Number(ded.daysInMonth || 0) - Number(ded.daysCovered || 0)) : 0;
              return (
                <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="z-[1] max-w-0 overflow-hidden bg-white px-2 py-2.5 md:sticky md:left-0 md:shadow-[4px_0_8px_-6px_rgba(15,23,42,0.35)]">
                    <button type="button" onClick={() => openAttendance(row)} className="w-full text-left" title="Open attendance details">
                      <p className="break-words font-medium leading-tight text-slate-800 hover:text-brand-600" title={emp.name}>{emp.name}</p>
                      {emp.email && <p className="break-all text-[10px] leading-tight text-slate-400" title={emp.email}>{emp.email}</p>}
                      <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${!hasAttendance ? 'bg-slate-100 text-slate-500' : ded?.lopAmount ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        {!hasAttendance ? 'No attendance' : ded?.lopAmount ? 'Loss of pay calculated' : 'Attendance loaded'}
                      </span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-1 py-2.5 text-right sm:px-2">
                    <p className="font-medium text-slate-700">{currentSalary > 0 ? formatINR(currentSalary) : '—'}</p>
                    {!hasSalary && <p className="mt-1 text-[10px] font-medium text-amber-600">Missing salary</p>}
                  </td>
                  <td className="px-1 py-2.5 text-right font-medium text-emerald-700 sm:px-1.5"><button type="button" onClick={() => openAttendance(row, { statuses: ['Normal', 'Missed Swipe', 'Late Coming', 'Early Leaving', 'HALF_DAY'], label: 'Present Dates', includeSundays: ded?.rafttarStaff === true, note: 'A long shift counts as more than one day and a short one as half, so the days credited need not equal the number of dates listed.' })} className="rounded px-1.5 py-0.5 hover:bg-emerald-50 hover:underline" title="View the dates this employee was present">{ded ? Number(ded.presentDays || 0).toFixed(Number(ded.presentDays || 0) % 1 ? 1 : 0) : '—'}</button></td>
                  <td className="px-1 py-2.5 text-right font-medium text-emerald-700 sm:px-1.5" title={ded ? `${Number(ded.attendedDays || 0)} attended + ${Number(ded.paidOffDays || 0)} paid off, of ${ded.daysInMonth} days` : undefined}>
                    {ded ? Number(ded.payableDays || 0).toFixed(Number(ded.payableDays || 0) % 1 ? 1 : 0) : '—'}
                    {daysMissing > 0 && (
                      <p className="mt-1 text-[9px] font-semibold text-amber-600" title={`${daysMissing} date${daysMissing === 1 ? '' : 's'} of this month were never imported, so they cannot be paid for. Re-import the month before paying.`}>
                        {daysMissing} date{daysMissing === 1 ? '' : 's'} missing
                      </p>
                    )}
                  </td>
                  <td className="px-1 py-2.5 text-right text-slate-600 sm:px-1.5">
                    {ded && Number(ded.absentDays || 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => openAttendance(row, { statuses: ['Absent'], label: 'Absent Dates' })}
                        className="rounded px-1.5 py-0.5 font-medium text-red-600 hover:bg-red-50 hover:underline"
                        title="View the dates this employee was absent"
                      >
                        {ded.absentDays}
                      </button>
                    ) : (ded?.absentDays ?? '—')}
                  </td>
                  <td className="px-1 py-2.5 text-right text-slate-600 sm:px-1.5">{ded?.halfDays ?? '—'}</td>
                  <td className="px-1 py-2.5 text-right text-slate-600 sm:px-1.5">{ded?.lateOccurrences ?? '—'}</td>
                  <td className="px-1 py-2.5 text-right text-slate-600 sm:px-1.5">{ded ? `${ded.paidLeaveUsed}/${ded.leaveLimit}` : '—'}</td>
                  <td className="px-1 py-2.5 text-right text-slate-600 sm:px-1.5">{ded?.lopDays ? ded.lopDays.toFixed(1) : '—'}</td>
                  <td className="whitespace-nowrap px-1 py-2.5 text-right font-medium text-red-600 sm:px-2">
                    {ded && Number(ded.lopAmount || 0) > 0 ? (
                      <button type="button" onClick={() => setLopExplain({ ded, emp, row, salary: currentSalary })}
                        className="rounded px-1.5 py-0.5 underline decoration-dotted underline-offset-2 hover:bg-red-50"
                        title="Show why this amount was cut">{formatINR(liveLopAmount || 0)}</button>
                    ) : liveLopAmount !== null ? formatINR(liveLopAmount) : Number(currentSalary) > 0 ? '₹0' : '—'}
                  </td>
                  <td className="px-1 py-2.5 text-right font-medium text-emerald-700 sm:px-1.5"
                    title={ded ? `${Number(ded.workedWeeklyOffs || 0)} weekly off(s) worked + ${Number(ded.unusedLeaveDays || 0)} leave day(s) not availed` : undefined}>
                    {ded && Number(ded.extraPayableDays || 0) > 0 ? Number(ded.extraPayableDays).toFixed(Number(ded.extraPayableDays) % 1 ? 1 : 0) : ded ? 0 : '—'}
                  </td>
                  <td className="whitespace-nowrap px-1 py-2.5 text-right font-medium text-emerald-700 sm:px-2">
                    {ded && liveExtraPayment > 0 ? (
                      <button type="button" onClick={() => setLopExplain({ ded, emp, row, salary: currentSalary })}
                        className="rounded px-1.5 py-0.5 underline decoration-dotted underline-offset-2 hover:bg-emerald-50"
                        title="Show why this amount was added">{formatINR(liveExtraPayment)}</button>
                    ) : ded ? '₹0' : '—'}
                  </td>
                  <td className="whitespace-nowrap px-1 py-2.5 text-right font-semibold text-emerald-700 sm:px-2">
                    {netPayable !== null ? formatINR(netPayable) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent md:hidden" />
        </div>
        {filteredRows.length > 0 && (
          <TablePagination total={filteredRows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} noun="employees" />
        )}
        {filteredRows.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p>{rows.length === 0 ? 'No employees found. Upload an attendance file first.' : hasActiveFilters ? 'No employees match all selected filters. Try clearing one filter.' : 'No employees match this search or filter.'}</p>
            {hasActiveFilters && rows.length > 0 && <button onClick={clearFilters} className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">Clear filters</button>}
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
              {['All', 'Ayushman', 'Hope', 'Rafttar', 'IT', 'Other'].map(company => (
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

      {lopExplain && (
        <LopBreakdown
          ded={lopExplain.ded}
          emp={lopExplain.emp}
          salary={lopExplain.salary}
          month={month}
          uploadId={latestUpload?.id ?? null}
          onClose={() => setLopExplain(null)}
          onSeeDates={() => { const row = lopExplain.row; setLopExplain(null); openAttendance(row, { statuses: ['Absent'], label: 'Absent Dates' }); }}
        />
      )}

      {attendanceRow && latestUpload?.id && (
        <EmailDraftModal
          uploadId={latestUpload.id}
          employeeId={attendanceRow.emp.id}
          employeeName={attendanceRow.emp.name || ''}
          employeeEmail={attendanceRow.emp.email || ''}
          initialTab="records"
          recordsOnly
          filterStatuses={attendanceFilter?.statuses}
          filterLabel={attendanceFilter?.label}
          includeSundays={attendanceFilter?.includeSundays}
          filterNote={attendanceFilter?.note}
          deduction={attendanceRow.deduction}
          employee={attendanceRow.emp}
          monthlySalary={Number(attendanceRow.config?.basicSalary || 0)}
          onClose={() => { setAttendanceRow(null); setAttendanceFilter(null); }}
          onSent={() => { setAttendanceRow(null); setAttendanceFilter(null); }}
        />
      )}
    </div>
  );
}
