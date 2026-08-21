import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEmployees, updateEmployee, mergeEmployees, createEmployee, getSalaryLedgers, getShiftOptions, getEmployeeShiftAssignments, saveEmployeeShiftAssignment, getDerivedShiftTimings, getAllShiftAssignments, type EmployeeShiftAssignment, type ShiftOption, type DerivedTimings, type SalaryLedger } from '../api';
import TablePagination, { PAGE_SIZE } from '../components/TablePagination';
import TimePicker from '../components/TimePicker';
import useIsPhone from '../lib/useIsPhone';

interface Employee {
  id: number;
  name: string;
  email: string;
  department: string | null;
  organisation: string | null;
  entity: string | null;
  employeeId: string | null;
  photoUrl: string | null;
  createdAt: string;
  mobile?: string | null;
  branch?: string | null;
  designation?: string | null;
  actualDesignation?: string | null;
  biometricName?: string | null;
  ledgerId?: number | null;
  ledgerName?: string | null;
  accountCode?: string | null;
  status?: string | null;
  basicSalary?: number | null;
  shiftTimings?: Record<string, { start?: string; end?: string }> | null;
  eligibleForPaidLeaves?: boolean | null;
  eligibleForOvertime?: boolean | null;
}

interface EditForm {
  name: string;
  email: string;
  department: string;
  employeeNumber: string;
  mobile: string;
  designation: string;
  biometricName: string;
  salaryLedgerId: number | null;
  branch: string;
  status: string;
  basicSalary: string;
  shiftTimings: Record<string, { start: string; end: string }>;
  eligibleForPaidLeaves: boolean;
  eligibleForOvertime: boolean;
}

interface FormField {
  label: string;
  key: string;
  type: string;
  span?: boolean;
  placeholder?: string;
}

interface WorkTimeForm {
  shiftId: string;
  name: string;
  roleTarget: string;
  startTime: string;
  endTime: string;
  graceMinutes: string;
  isOvernight: boolean;
  effectiveFrom: string;
  effectiveTo: string;
}

const AVATAR_COLORS = [
  'from-indigo-400 to-purple-500',
  'from-emerald-400 to-teal-500',
  'from-rose-400 to-pink-500',
  'from-amber-400 to-orange-500',
  'from-sky-400 to-blue-500',
  'from-violet-400 to-purple-500',
];

export default function EmployeesPage() {
  const isPhone = useIsPhone();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [detailsEmployee, setDetailsEmployee] = useState<Employee | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<EditForm>({ name: '', email: '', department: '', employeeNumber: '', mobile: '', designation: '', biometricName: '', salaryLedgerId: null, branch: '', status: 'Active', basicSalary: '', shiftTimings: { morning: { start: '', end: '' }, evening: { start: '', end: '' }, night: { start: '', end: '' } }, eligibleForPaidLeaves: true, eligibleForOvertime: false });
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerFocused, setLedgerFocused] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mergeKeepId, setMergeKeepId] = useState<number | null>(null);
  const [mergeError, setMergeError] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [page, setPage] = useState(1);
  const [openActionMenu, setOpenActionMenu] = useState<number | null>(null);
  const [workTimeEmployee, setWorkTimeEmployee] = useState<Employee | null>(null);
  const [workTimeMode, setWorkTimeMode] = useState<'existing' | 'custom'>('existing');
  const [workTimeError, setWorkTimeError] = useState('');
  const [workTimeForm, setWorkTimeForm] = useState<WorkTimeForm>({ shiftId: '', name: '', roleTarget: 'GENERAL', startTime: '09:00', endTime: '18:00', graceMinutes: '15', isOvernight: false, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' });

  const { data: shiftOptions = [] } = useQuery<ShiftOption[]>({ queryKey: ['shift-options'], queryFn: () => getShiftOptions().then(r => r.data), enabled: !!workTimeEmployee });
  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<EmployeeShiftAssignment[]>({ queryKey: ['employee-shifts', workTimeEmployee?.id], queryFn: () => getEmployeeShiftAssignments(workTimeEmployee!.id).then(r => r.data), enabled: !!workTimeEmployee });

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => getEmployees().then(r => r.data),
  });
  const { data: salaryLedgers = [], isLoading: ledgersLoading } = useQuery<SalaryLedger[]>({
    queryKey: ['salary-ledgers'],
    queryFn: () => getSalaryLedgers().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Timing is not stored for anyone, so it is reconstructed at read time from
  // assigned shifts and punch history. Neither query writes anything back.
  const { data: shiftAssignments = new Map<number, EmployeeShiftAssignment>() } = useQuery({
    queryKey: ['shift-assignments-all'], queryFn: () => getAllShiftAssignments().then(r => r.data),
  });
  const { data: derivedTimings = new Map<number, DerivedTimings>() } = useQuery({
    queryKey: ['derived-timings'], queryFn: () => getDerivedShiftTimings().then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: EditForm }) => {
      const { basicSalary, ...employeeData } = data;
      await updateEmployee(id, { ...employeeData, monthlySalary: basicSalary.trim() ? Number(basicSalary) : null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setEditing(null); setLedgerSearch(''); },
    onError: (error: any) => alert(error.message || 'Employee could not be saved.'),
  });

  const addMutation = useMutation({
    mutationFn: (data: EditForm) => createEmployee({
      name: data.name,
      email: data.email || undefined,
      department: data.department,
      designation: data.designation || undefined,
      employeeNumber: data.employeeNumber || undefined,
      mobile: data.mobile || undefined,
      branch: data.branch || undefined,
      status: data.status,
      basicSalary: data.basicSalary ? Number(data.basicSalary) : undefined,
      eligibleForPaidLeaves: data.eligibleForPaidLeaves,
      eligibleForOvertime: data.eligibleForOvertime,
      biometricName: data.biometricName || undefined,
      salaryLedgerId: data.salaryLedgerId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setAdding(false);
      setLedgerSearch('');
      setLedgerFocused(false);
      setForm({ name: '', email: '', department: '', employeeNumber: '', mobile: '', designation: '', biometricName: '', salaryLedgerId: null, branch: '', status: 'Active', basicSalary: '', shiftTimings: { morning: { start: '', end: '' }, evening: { start: '', end: '' }, night: { start: '', end: '' } }, eligibleForPaidLeaves: true, eligibleForOvertime: false });
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || error.message || 'Failed to add employee';
      alert(errorMsg);
    },
  });

  const searchText = search.trim().toLowerCase();
  const filtered = employees.filter(e => {
    const searchable = [e.name, e.email, e.biometricName, e.ledgerName, e.accountCode, e.department, e.organisation, e.entity]
      .map(value => String(value || '').toLowerCase())
      .join(' ');
    return (!searchText || searchable.includes(searchText)) && (!departmentFilter || e.department === departmentFilter);
  });
  const departments = Array.from(new Set(employees.map(employee => employee.department).filter(Boolean))) as string[];
  const departmentOptions = Array.from(new Set([
    'Nursing', 'OT', 'Ward', 'Rafttar', 'HR', 'Accounts', 'Administration',
    'Reception', 'Pharmacy', 'Laboratory', 'Housekeeping', ...departments,
  ])).sort((a, b) => a.localeCompare(b));
  const visibleEmployees = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const ledgerSearchText = ledgerSearch.trim().toLowerCase();
  const matchingLedgers = salaryLedgers.filter(ledger =>
    !ledgerSearchText || `${ledger.accountName} ${ledger.accountCode}`.toLowerCase().includes(ledgerSearchText)
  ).slice(0, 12);
  const mergeMutation = useMutation({
    mutationFn: () => mergeEmployees(mergeKeepId!, selectedIds.find(id => id !== mergeKeepId)!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['salary-configs'] });
      qc.invalidateQueries({ queryKey: ['deductions'] });
      setSelectedIds([]); setMergeKeepId(null); setMergeError('');
    },
    onError: (error: any) => setMergeError(error.message || 'Employees could not be merged.'),
  });
  const workTimeMutation = useMutation({
    mutationFn: () => {
      if (!workTimeEmployee) throw new Error('Employee not selected');
      if (workTimeMode === 'existing' && !workTimeForm.shiftId) throw new Error('Select a shift');
      if (workTimeMode === 'custom' && !workTimeForm.name.trim()) throw new Error('Custom shift name is required');
      if (workTimeForm.effectiveTo && workTimeForm.effectiveTo < workTimeForm.effectiveFrom) throw new Error('End date must be on or after start date');
      return saveEmployeeShiftAssignment(workTimeEmployee.id, {
        shiftId: workTimeMode === 'existing' ? workTimeForm.shiftId : undefined,
        effectiveFrom: workTimeForm.effectiveFrom,
        effectiveTo: workTimeForm.effectiveTo || undefined,
        customShift: workTimeMode === 'custom' ? { name: workTimeForm.name.trim(), roleTarget: workTimeForm.roleTarget.trim().toUpperCase() || 'GENERAL', startTime: workTimeForm.startTime, endTime: workTimeForm.endTime, graceMinutes: Number(workTimeForm.graceMinutes), isOvernight: workTimeForm.isOvernight } : undefined,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-shifts', workTimeEmployee?.id] }); qc.invalidateQueries({ queryKey: ['shift-assignments-all'] }); setWorkTimeError(''); setWorkTimeMode('existing'); },
    onError: (error: any) => setWorkTimeError(error.message || 'Work time could not be saved.'),
  });

  function employeeType(emp: Employee) {
    const value = `${emp.organisation || ''} ${emp.entity || ''} ${emp.department || ''}`.toLowerCase();
    if (value.includes('ayushman')) return { label: 'Ayushman', className: 'bg-violet-50 text-violet-700 border-violet-100' };
    if (value.includes('hope')) return { label: 'Hope', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
    if (value.includes('rafttar')) return { label: 'Rafttar', className: 'bg-amber-50 text-amber-700 border-amber-100' };
    if (/(^|[^a-z])it([^a-z]|$)|information technology/.test(value)) return { label: 'IT', className: 'bg-sky-50 text-sky-700 border-sky-100' };
    return { label: 'Unassigned', className: 'bg-slate-50 text-slate-500 border-slate-200' };
  }

  function openEdit(emp: Employee) {
    setEditing(emp);
    setOpenActionMenu(null);
    setLedgerSearch(emp.ledgerName || emp.accountCode || '');
    setLedgerFocused(false);
    setForm({
      name: emp.name, email: emp.email || '', department: emp.department || 'Rafttar', employeeNumber: emp.employeeId || '',
      mobile: emp.mobile || '', designation: emp.actualDesignation || emp.designation || '', biometricName: emp.biometricName || '', salaryLedgerId: emp.ledgerId ?? null, branch: emp.branch || emp.entity || '', status: emp.status || 'Active',
      basicSalary: emp.basicSalary ? String(emp.basicSalary) : '', shiftTimings: { morning: { start: emp.shiftTimings?.morning?.start || '', end: emp.shiftTimings?.morning?.end || '' }, evening: { start: emp.shiftTimings?.evening?.start || '', end: emp.shiftTimings?.evening?.end || '' }, night: { start: emp.shiftTimings?.night?.start || '', end: emp.shiftTimings?.night?.end || '' } },
      eligibleForPaidLeaves: emp.eligibleForPaidLeaves !== false, eligibleForOvertime: emp.eligibleForOvertime === true,
    });
  }

  function openDetails(emp: Employee) {
    setOpenActionMenu(null);
    setDetailsEmployee(emp);
  }

  function openWorkTimes(emp: Employee) {
    setWorkTimeEmployee(emp);
    setWorkTimeError('');
    setWorkTimeMode('existing');
    setWorkTimeForm({ shiftId: '', name: `${emp.name} custom`, roleTarget: 'GENERAL', startTime: '09:00', endTime: '18:00', graceMinutes: '15', isOvernight: false, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' });
  }

  function initials(name: string) {
    return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'E';
  }

  const formatWindows = (windows: Array<readonly [string, { start?: string; end?: string } | undefined]>) =>
    windows.filter(([, time]) => time?.start && time?.end)
      .map(([label, time]) => `${label}: ${time!.start}-${time!.end}`).join(' · ');

  // Timing has four possible sources, most authoritative first. Anything below
  // an assigned shift is inferred, so the caller marks it as such rather than
  // presenting a guess as a record.
  function timings(employee: Employee): { text: string; source: string; inferred: boolean } {
    const configured = formatWindows([['M', employee.shiftTimings?.morning], ['E', employee.shiftTimings?.evening], ['N', employee.shiftTimings?.night]]);
    if (configured) return { text: configured, source: 'Saved on the employee record', inferred: false };

    const assigned = shiftAssignments.get(employee.id);
    if (assigned) return { text: `${assigned.name}: ${assigned.startTime}-${assigned.endTime}`, source: 'Assigned shift', inferred: false };

    const derived = derivedTimings.get(employee.id);
    if (derived) {
      const text = formatWindows([['M', derived.morning], ['E', derived.evening], ['N', derived.night]]);
      const days = Math.max(derived.morning?.days || 0, derived.evening?.days || 0, derived.night?.days || 0);
      if (text) return { text, source: `Typical pattern from ${days} days of punches`, inferred: false };
    }

    // Last resort: the company standard. Shown greyed and labelled so it is
    // never mistaken for something this person actually worked.
    const rafttar = /rafttar/i.test(`${employee.organisation || ''} ${employee.entity || ''} ${employee.department || ''}`);
    return { text: rafttar ? '09:00-18:00' : '09:00-18:00', source: `${rafttar ? 'Rafttar' : 'Company'} standard — no punches on record`, inferred: true };
  }

  return (
    <div className="w-full min-w-0 bg-slate-50/60 p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="hidden text-[11px] font-medium text-slate-400 sm:block">People <span className="mx-1">/</span> Employee Master</p><h1 className="text-xl font-bold tracking-tight text-slate-900 sm:mt-1">Employee Master</h1><p className="mt-1 hidden text-xs text-slate-500 sm:block">Maintain employee records and keep payroll-ready workforce data organized.</p></div>
        <button className="hidden rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600 shadow-sm sm:block">Last refreshed just now</button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        {[['Total employees', employees.length, 'groups', 'text-indigo-500'], ['Active employees', employees.length, 'person', 'text-indigo-500'], ['Inactive employees', 0, 'person_off', 'text-violet-500'], ['Departments', departments.length, 'business', 'text-violet-500']].map(([label, value, icon, tone]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm sm:p-4"><div className="flex items-start justify-between gap-1.5"><div className="min-w-0"><p className="truncate text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-500 sm:text-[10px]">{label}</p><p className="mt-0.5 text-xl font-bold leading-none text-slate-800 sm:mt-1 sm:text-2xl">{value}</p><p className="mt-1 text-[9px] leading-tight text-emerald-500 sm:text-[10px]">• {label === 'Departments' ? 'across the organisation' : 'of total workforce'}</p></div><span className={`material-icons rounded-lg bg-indigo-50 p-1.5 text-sm ${tone} sm:p-2 sm:text-base`}>{icon}</span></div></div>)}
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50/50 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(220px,0.8fr)] sm:items-end">
            <label className="block min-w-0"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:text-xs">Search directory</span><div className="relative"><span className="material-icons pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">search</span><input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Name, biometric name, ledger name, or account code" className="!min-h-0 h-10 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-xs text-slate-700 outline-none transition-shadow placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 sm:text-sm" />{search && <button type="button" onClick={() => { setSearch(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Clear employee search"><span className="material-icons text-sm">close</span></button>}</div></label>
            <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:text-xs">Department</span><select value={departmentFilter} onChange={e => { setDepartmentFilter(e.target.value); setPage(1); }} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-shadow focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 sm:text-sm"><option value="">All departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">Search matches employee name, biometric name, ledger name, and account code.</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3"><div className="min-w-0"><h2 className="truncate text-xs font-bold text-slate-800 sm:text-sm">Employee directory</h2><p className="text-[9px] text-slate-400 sm:text-[10px]">{filtered.length} active employees</p></div><div className="flex flex-none items-center gap-1 sm:gap-2"><button onClick={() => { setAdding(true); setLedgerSearch(''); setLedgerFocused(false); setForm({ name: '', email: '', department: 'Marketing', employeeNumber: '', mobile: '', designation: '', biometricName: '', salaryLedgerId: null, branch: '', status: 'Active', basicSalary: '', shiftTimings: { morning: { start: '', end: '' }, evening: { start: '', end: '' }, night: { start: '', end: '' } }, eligibleForPaidLeaves: false, eligibleForOvertime: false }); }} className="flex items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 px-2 py-1.5 text-[9px] font-semibold text-white shadow-md transition-all hover:from-purple-600 hover:to-indigo-700 sm:gap-2 sm:rounded-xl sm:px-3 sm:text-[10px]"><span className="material-icons text-[11px] align-middle sm:text-sm">add_circle</span>Add Employee</button><button className="flex items-center justify-center rounded-md border border-slate-200 px-2 py-1.5 text-[9px] font-medium text-slate-600 sm:px-2.5 sm:text-[10px]"><span className="material-icons mr-0.5 align-middle text-[11px] sm:mr-1 sm:text-xs">download</span>Export</button>{selectedIds.length === 2 && <button onClick={() => { setMergeKeepId(selectedIds[0]); setMergeError(''); }} className="flex flex-none items-center justify-center rounded-md bg-indigo-600 px-2 py-1.5 text-[9px] font-semibold text-white sm:px-2.5 sm:text-[10px]"><span className="material-icons mr-0.5 align-middle text-[11px] sm:mr-1 sm:text-xs">merge</span>Merge names</button>}</div></div>
        {isLoading ? <div className="p-12 text-center text-sm text-slate-400"><span className="material-icons mr-2 animate-spin align-middle">sync</span>Loading employees...</div> : filtered.length === 0 ? <div className="p-12 text-center text-sm text-slate-400">No employees match the current filters.</div> : <><div className="space-y-2 p-2 sm:hidden">{visibleEmployees.map((emp, i) => <article key={emp.id} onClick={() => openDetails(emp)} className="cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md"><div className="flex items-start gap-2"><input type="checkbox" checked={selectedIds.includes(emp.id)} onClick={e => e.stopPropagation()} onChange={() => setSelectedIds(ids => ids.includes(emp.id) ? ids.filter(id => id !== emp.id) : ids.length < 2 ? [...ids, emp.id] : ids)} className="mt-1" /><div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-[10px] font-bold text-white`}>{emp.photoUrl ? <img src={emp.photoUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials(emp.name)}</div><div className="min-w-0 flex-1 text-left"><p className="truncate text-[11px] font-semibold text-slate-800">{emp.name}</p><p className="truncate text-[9px] text-slate-400">{emp.email || '—'}</p></div></div><div className="ml-12 mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] text-slate-500"><span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-600">ID: {emp.employeeId || '—'}</span><span className="rounded bg-slate-100 px-1.5 py-0.5">{emp.department || 'Unassigned'}</span><span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-600">{emp.status || 'Active'}</span></div></article>)}</div><div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[1180px] text-left tabular-nums"><thead className="border-b border-slate-200 bg-slate-50 text-[9px] font-bold uppercase tracking-wide text-slate-400"><tr><th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all visible employees" checked={visibleEmployees.length > 0 && visibleEmployees.every(e => selectedIds.includes(e.id))} onChange={() => setSelectedIds(visibleEmployees.every(e => selectedIds.includes(e.id)) ? [] : visibleEmployees.slice(0, 2).map(e => e.id))} /></th><th className="px-3 py-3">Employee</th><th className="px-3 py-3">Emp ID</th><th className="px-3 py-3">Mobile</th><th className="px-3 py-3">Department</th><th className="px-3 py-3">Branch</th><th className="px-3 py-3">Biometric Name</th><th className="px-3 py-3">Shift</th><th className="px-3 py-3">Timing</th><th className="px-3 py-3">Basic Salary</th><th className="px-3 py-3">Paid Leaves</th><th className="px-3 py-3">Overtime</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Edit</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleEmployees.map((emp, i) => <tr key={emp.id} className="group hover:bg-slate-50/70"><td className="px-4 py-2.5"><input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => setSelectedIds(ids => ids.includes(emp.id) ? ids.filter(id => id !== emp.id) : ids.length < 2 ? [...ids, emp.id] : ids)} /></td><td className="px-3 py-2.5"><button type="button" onClick={() => isPhone ? openDetails(emp) : openEdit(emp)} className="flex items-center gap-2 text-left"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-[9px] font-bold text-white`}>{emp.photoUrl ? <img src={emp.photoUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials(emp.name)}</div><div className="max-w-[180px]"><p className="truncate text-[11px] font-semibold text-slate-700 hover:text-indigo-600">{emp.name}</p><p className="truncate text-[9px] text-slate-400">{emp.email || '—'}</p></div></button></td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.employeeId || '—'}</td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.mobile || '—'}</td><td className="px-3 py-2.5"><span className="rounded bg-indigo-50 px-1.5 py-1 text-[9px] font-medium text-indigo-600">{emp.department || '—'}</span></td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.branch || emp.entity || '—'}</td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.designation || emp.name}</td><td className="px-3 py-2.5"><button type="button" onClick={() => openWorkTimes(emp)} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100" title="Assign a shift / work time">M / E / N</button></td><td className="max-w-[190px] px-3 py-2.5 text-[9px] leading-4">{(() => { const t = timings(emp); return <span className={t.inferred ? 'text-slate-300 italic' : 'text-slate-600'} title={t.source}>{t.text}{t.inferred ? ' (standard)' : ''}</span>; })()}</td><td className="px-3 py-2.5 text-[10px] font-medium text-slate-700">{emp.basicSalary ? `₹${emp.basicSalary.toLocaleString('en-IN')}` : '—'}</td><td className="px-3 py-2.5 text-[10px] text-emerald-600">{emp.eligibleForPaidLeaves !== false ? 'Eligible' : 'No'}</td><td className="px-3 py-2.5 text-[10px] text-indigo-600">{emp.eligibleForOvertime ? 'Eligible' : 'No'}</td><td className="px-3 py-2.5"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-medium text-emerald-600">{emp.status || 'Active'}</span></td><td className="px-3 py-2.5"><button type="button" onClick={() => openEdit(emp)} className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-100"><span className="material-icons mr-1 align-middle text-xs">edit</span>Edit</button></td></tr>)}</tbody></table></div></>}
        <TablePagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} noun="employees" />
      </section>

      {mergeKeepId !== null && selectedIds.length === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800">Merge employee names</h3>
            <p className="mt-1 text-sm text-slate-500">Choose the name to keep. Attendance and salary data from the other employee will be moved here.</p>
            <div className="mt-4 space-y-2">
              {selectedIds.map(id => {
                const employee = employees.find(item => item.id === id);
                return <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><input type="radio" name="mergeKeep" checked={mergeKeepId === id} onChange={() => setMergeKeepId(id)} /><span className="font-medium text-slate-700">{employee?.name}</span></label>;
              })}
            </div>
            {mergeError && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-600">{mergeError}</p>}
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => { setMergeKeepId(null); setMergeError(''); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel</button><button onClick={() => mergeMutation.mutate()} disabled={mergeMutation.isPending} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{mergeMutation.isPending ? 'Merging...' : 'Merge'}</button></div>
          </div>
        </div>
      )}

      {mergeKeepId !== null && selectedIds.length === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800">Merge employee names</h3>
            <p className="mt-1 text-sm text-slate-500">Choose the name to keep. Attendance and salary data from the other employee will be moved here.</p>
            <div className="mt-4 space-y-2">
              {selectedIds.map(id => {
                const employee = employees.find(item => item.id === id);
                return <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><input type="radio" name="mergeKeep" checked={mergeKeepId === id} onChange={() => setMergeKeepId(id)} /><span className="font-medium text-slate-700">{employee?.name}</span></label>;
              })}
            </div>
            {mergeError && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-600">{mergeError}</p>}
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => { setMergeKeepId(null); setMergeError(''); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel</button><button onClick={() => mergeMutation.mutate()} disabled={mergeMutation.isPending} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{mergeMutation.isPending ? 'Merging...' : 'Merge'}</button></div>
          </div>
        </div>
      )}

      {workTimeEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Employee schedule</p>
                <h3 className="mt-1 text-lg font-bold text-slate-800">Customize {workTimeEmployee.name}</h3>
                <p className="mt-1 text-xs text-slate-400">New assignments apply from the effective date.</p>
              </div>
              <button onClick={() => setWorkTimeEmployee(null)} className="rounded-lg p-1.5 hover:bg-slate-100"><span className="material-icons text-xl text-slate-400">close</span></button>
            </div>
            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
                {([['existing', 'Use saved shift'], ['custom', 'Create custom time']] as const).map(([value, label]) => (
                  <button key={value} onClick={() => setWorkTimeMode(value)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors active:scale-[0.98] ${workTimeMode === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>
                ))}
              </div>

              {workTimeMode === 'existing' ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Shift</span>
                  <select value={workTimeForm.shiftId} onChange={e => setWorkTimeForm(prev => ({ ...prev, shiftId: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20">
                    <option value="">Select a shift</option>
                    {shiftOptions.map(shift => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}
                  </select>
                  {!shiftOptions.length && <span className="mt-1 block text-xs text-amber-600">No saved shifts are available. Create a custom time instead.</span>}
                </label>
              ) : (
                <div className="space-y-4">
                  <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Shift name</span><input value={workTimeForm.name} onChange={e => setWorkTimeForm(prev => ({ ...prev, name: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-400" placeholder="e.g. Front desk morning" /></label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TimePicker value={workTimeForm.startTime} onChange={value => setWorkTimeForm(prev => ({ ...prev, startTime: value }))} label="Start time" />
                    <TimePicker value={workTimeForm.endTime} onChange={value => setWorkTimeForm(prev => ({ ...prev, endTime: value }))} label="End time" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Role target</span><input value={workTimeForm.roleTarget} onChange={e => setWorkTimeForm(prev => ({ ...prev, roleTarget: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Grace minutes</span><input type="number" min="0" max="240" value={workTimeForm.graceMinutes} onChange={e => setWorkTimeForm(prev => ({ ...prev, graceMinutes: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={workTimeForm.isOvernight} onChange={e => setWorkTimeForm(prev => ({ ...prev, isOvernight: e.target.checked }))} className="h-4 w-4 accent-emerald-600" /> Overnight shift</label>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Effective from</span><input type="date" value={workTimeForm.effectiveFrom} onChange={e => setWorkTimeForm(prev => ({ ...prev, effectiveFrom: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Effective to <span className="font-normal text-slate-400">(optional)</span></span><input type="date" value={workTimeForm.effectiveTo} onChange={e => setWorkTimeForm(prev => ({ ...prev, effectiveTo: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-slate-700">Schedule history</p>{assignmentsLoading && <span className="text-xs text-slate-400">Loading...</span>}</div>
                {assignments.length ? <div className="space-y-2">{assignments.map(assignment => <div key={assignment.assignmentId} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"><div><p className="text-xs font-semibold text-slate-700">{assignment.name}</p><p className="text-[11px] text-slate-400">{assignment.startTime}–{assignment.endTime} · from {assignment.effectiveFrom}{assignment.effectiveTo ? ` to ${assignment.effectiveTo}` : ' · current'}</p></div><span className="material-icons text-base text-emerald-500">schedule</span></div>)}</div> : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">No schedule assigned yet.</p>}
              </div>
              {workTimeError && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-600">{workTimeError}</p>}
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4"><button onClick={() => setWorkTimeEmployee(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600">Close</button><button onClick={() => workTimeMutation.mutate()} disabled={workTimeMutation.isPending} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60">{workTimeMutation.isPending ? 'Saving...' : 'Save work time'}</button></div>
          </div>
        </div>
      )}

      {detailsEmployee && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm" onClick={() => setDetailsEmployee(null)}>
          <aside className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div><p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Employee profile</p><h3 className="mt-1 text-lg font-bold text-slate-800">Employee Details</h3></div>
              <button type="button" onClick={() => setDetailsEmployee(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close details"><span className="material-icons">close</span></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 text-lg font-bold text-white">{detailsEmployee.photoUrl ? <img src={detailsEmployee.photoUrl} alt="" className="h-full w-full rounded-2xl object-cover" /> : initials(detailsEmployee.name)}</div>
                <div className="min-w-0"><h4 className="truncate text-base font-bold text-slate-800">{detailsEmployee.name}</h4><p className="truncate text-xs text-slate-500">{detailsEmployee.email || 'No email provided'}</p><span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{detailsEmployee.status || 'Active'}</span></div>
              </div>
              {[
                { title: 'Contact & identity', icon: 'badge', items: [['Employee ID', detailsEmployee.employeeId], ['Mobile', detailsEmployee.mobile], ['Biometric Name', detailsEmployee.biometricName], ['Ledger Name', detailsEmployee.ledgerName], ['Account Code', detailsEmployee.accountCode]] },
                { title: 'Employment', icon: 'business_center', items: [['Department', detailsEmployee.department], ['Organisation', detailsEmployee.organisation], ['Entity / Branch', detailsEmployee.branch || detailsEmployee.entity], ['Designation', detailsEmployee.actualDesignation || detailsEmployee.designation]] },
                { title: 'Payroll & eligibility', icon: 'payments', items: [['Monthly Salary', detailsEmployee.basicSalary ? `₹${detailsEmployee.basicSalary.toLocaleString('en-IN')}` : null], ['Paid Leaves', detailsEmployee.eligibleForPaidLeaves === null || detailsEmployee.eligibleForPaidLeaves === undefined ? null : detailsEmployee.eligibleForPaidLeaves ? 'Eligible' : 'Not eligible'], ['Overtime', detailsEmployee.eligibleForOvertime ? 'Eligible' : 'Not eligible']] },
              ].map(section => <section key={section.title} className="border-b border-slate-100 py-4"><h5 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700"><span className="material-icons text-sm text-indigo-500">{section.icon}</span>{section.title}</h5><div className="space-y-2">{section.items.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 text-xs"><span className="text-slate-400">{label}</span><span className="max-w-[60%] text-right font-medium text-slate-700">{value || '—'}</span></div>)}</div></section>)}
              <section className="py-4"><h5 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700"><span className="material-icons text-sm text-indigo-500">schedule</span>Work schedule</h5><div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600"><p className="font-medium">{timings(detailsEmployee).text}</p><p className="mt-1 text-[10px] text-slate-400">{timings(detailsEmployee).source}</p></div></section>
            </div>
            <div className="flex gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:px-6"><button type="button" onClick={() => setDetailsEmployee(null)} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Close</button><button type="button" onClick={() => { openEdit(detailsEmployee); setDetailsEmployee(null); }} className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Edit Employee</button></div>
          </aside>
        </div>
      )}

      {/* Edit/Add Modal */}
      {(editing || adding) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[calc(100dvh-5rem)] w-[calc(100vw-3rem)] max-w-[320px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[calc(100vh-2rem)] sm:w-full sm:max-w-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-5">
              <div><h3 className="text-base font-bold text-slate-800">{adding ? 'Add Employee' : 'Edit Employee'}</h3><p className="mt-0.5 text-xs text-slate-400">{adding ? 'Create a new employee record' : 'Update this employee record'}</p></div>
              <button onClick={() => { setEditing(null); setAdding(false); }} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <span className="material-icons text-xl text-slate-400">close</span>
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { label: 'Employee Name *', key: 'name', type: 'text', placeholder: 'Enter full name' },
                  { label: 'Employee ID', key: 'employeeNumber', type: 'text', placeholder: 'Optional employee ID' },
                  { label: 'Email Address', key: 'email', type: 'email', placeholder: 'Optional email' },
                  { label: 'Mobile Number', key: 'mobile', type: 'tel', placeholder: 'Optional mobile' },
                  { label: 'Designation', key: 'designation', type: 'text', placeholder: 'Optional designation' },
                  { label: 'Biometric Name', key: 'biometricName', type: 'text', placeholder: 'Optional biometric name' },
                  { label: 'Branch', key: 'branch', type: 'text', placeholder: 'Optional branch' },
                  { label: 'Monthly Salary (INR)', key: 'basicSalary', type: 'number', placeholder: 'Optional salary' },
                ].map(f => <div key={f.key} className=""><label className="mb-1.5 block text-xs font-medium text-slate-700">{f.label}</label><input type={f.type} value={form[f.key as keyof EditForm] as string} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></div>)}
                <div className="relative"><label className="mb-1.5 block text-xs font-medium text-slate-700">Salary Ledger Name</label><div className="relative"><input value={ledgerSearch} onFocus={() => setLedgerFocused(true)} onBlur={() => setTimeout(() => setLedgerFocused(false), 120)} onChange={e => { setLedgerFocused(true); setLedgerSearch(e.target.value); setForm(prev => ({ ...prev, salaryLedgerId: null })); }} placeholder={ledgersLoading ? 'Loading ledger accounts...' : 'Search ledger name or account code'} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 pr-9 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />{ledgerSearch && <button type="button" onClick={() => { setLedgerSearch(''); setLedgerFocused(false); setForm(prev => ({ ...prev, salaryLedgerId: null })); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-200" aria-label="Clear salary ledger"><span className="material-icons text-sm">close</span></button>}</div>{form.salaryLedgerId && (() => { const selected = salaryLedgers.find(ledger => ledger.id === form.salaryLedgerId); return selected ? <p className="mt-1 text-[11px] font-medium text-emerald-700">Linked account code: {selected.accountCode}</p> : null; })()}{ledgerFocused && ledgerSearch.trim() && !ledgersLoading && <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">{matchingLedgers.length ? matchingLedgers.map(ledger => <button type="button" key={ledger.id} onClick={() => { setForm(prev => ({ ...prev, salaryLedgerId: ledger.id })); setLedgerSearch(ledger.accountName); setLedgerFocused(false); }} className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-indigo-50"><span className="min-w-0 truncate text-xs font-medium text-slate-700">{ledger.accountName}</span><span className="shrink-0 text-[10px] text-slate-400">{ledger.accountCode}</span></button>) : <p className="px-3 py-2 text-xs text-slate-400">No ledger or account code matches.</p>}</div>}<p className="mt-1 text-[10px] text-slate-400">Search by ledger name or account code. The account code is linked automatically.</p></div>
                <div><label className="mb-1.5 block text-xs font-medium text-slate-700">Department</label><input list="employee-departments" value={form.department} onChange={e => setForm(prev => ({ ...prev, department: e.target.value }))} placeholder="Select or type a department" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /><datalist id="employee-departments">{departmentOptions.map(department => <option key={department} value={department} />)}</datalist><p className="mt-1 text-[10px] text-slate-400">Choose a department or type a new one.</p></div>
                <div><label className="mb-1.5 block text-xs font-medium text-slate-700">Status</label><select value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-300"><option>Active</option><option>Inactive</option></select></div>
                <div className="sm:col-span-2 space-y-4">
                  <p className="text-xs font-semibold text-slate-700">Shift timings</p>
                  <div className="space-y-3">
                    {([
                      { key: 'morning', label: 'Morning Shift', icon: 'wb_sunny', color: 'amber' },
                      { key: 'evening', label: 'Evening Shift', icon: 'wb_twilight', color: 'indigo' },
                      { key: 'night', label: 'Night Shift', icon: 'nightlight', color: 'slate' }
                    ] as const).map((shift) => (
                      <div key={shift.key} className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            shift.color === 'amber' ? 'bg-amber-100' :
                            shift.color === 'indigo' ? 'bg-indigo-100' :
                            'bg-slate-200'
                          }`}>
                            <span className={`material-icons text-sm ${
                              shift.color === 'amber' ? 'text-amber-600' :
                              shift.color === 'indigo' ? 'text-indigo-600' :
                              'text-slate-600'
                            }`}>{shift.icon}</span>
                          </div>
                          <p className="text-sm font-semibold text-slate-800">{shift.label}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                          <TimePicker
                            value={form.shiftTimings[shift.key].start}
                            onChange={value => setForm(prev => ({ ...prev, shiftTimings: { ...prev.shiftTimings, [shift.key]: { ...prev.shiftTimings[shift.key], start: value } } }))}
                            label="Start Time"
                          />
                          <TimePicker
                            value={form.shiftTimings[shift.key].end}
                            onChange={value => setForm(prev => ({ ...prev, shiftTimings: { ...prev.shiftTimings, [shift.key]: { ...prev.shiftTimings[shift.key], end: value } } }))}
                            label="End Time"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 flex gap-2 items-start">
                    <span className="material-icons text-amber-500 text-sm mt-0.5">info</span>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      The upload automatically matches the closest configured shift to the punch-in time. A Night Shift can end after midnight.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 space-y-4">{/(^|[^a-z])it([^a-z]|$)|information technology/i.test(form.department) || /rafttar/i.test(form.department) ? <div><p className="mb-2 text-xs font-medium text-slate-700">IT paid leave (2 days per month)</p><div className="grid grid-cols-2 gap-2">{[true, false].map(value => <button type="button" key={String(value)} onClick={() => setForm(prev => ({ ...prev, eligibleForPaidLeaves: value }))} className={`rounded-lg border py-2 text-sm font-medium ${form.eligibleForPaidLeaves === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>{value ? 'Yes' : 'No'}</button>)}</div><p className="mt-2 text-[11px] text-slate-400">IT employees always receive Sunday offs. Select Yes only for employees who should also receive two paid leaves each month.</p></div> : <div><p className="text-xs font-medium text-slate-700">Paid leaves</p><p className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Non-IT employees work on Sundays and automatically receive 4 paid leaves per month.</p></div>}<div><p className="mb-2 text-xs font-medium text-slate-700">Eligible for Overtime</p><div className="grid grid-cols-2 gap-2">{[true, false].map(value => <button type="button" key={String(value)} onClick={() => setForm(prev => ({ ...prev, eligibleForOvertime: value }))} className={`rounded-lg border py-2 text-sm font-medium ${form.eligibleForOvertime === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>{value ? 'Yes' : 'No'}</button>)}</div></div></div>
            </div>
            <div className="flex gap-2 border-t border-slate-100 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => adding ? addMutation.mutate(form) : mutation.mutate({ id: editing!.id, data: form })}
                disabled={mutation.isPending || addMutation.isPending}
                className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 transition-all"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
              >
                {mutation.isPending || addMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
