import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEmployees, updateEmployee, uploadEmployeePhoto, mergeEmployees, getShiftOptions, getEmployeeShiftAssignments, saveEmployeeShiftAssignment, type EmployeeShiftAssignment, type ShiftOption } from '../api';

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
  branch: string;
  status: string;
  basicSalary: string;
  shiftTimings: Record<string, { start: string; end: string }>;
  eligibleForPaidLeaves: boolean;
  eligibleForOvertime: boolean;
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
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EditForm>({ name: '', email: '', department: '', employeeNumber: '', mobile: '', designation: '', biometricName: '', branch: '', status: 'Active', basicSalary: '', shiftTimings: { morning: { start: '', end: '' }, evening: { start: '', end: '' }, night: { start: '', end: '' } }, eligibleForPaidLeaves: true, eligibleForOvertime: false });
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mergeKeepId, setMergeKeepId] = useState<number | null>(null);
  const [mergeError, setMergeError] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [page, setPage] = useState(1);
  const [openActionMenu, setOpenActionMenu] = useState<number | null>(null);
  const pageSize = 25;
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

  const mutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: EditForm }) => {
      const { basicSalary, ...employeeData } = data;
      await updateEmployee(id, { ...employeeData, monthlySalary: basicSalary.trim() ? Number(basicSalary) : null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setEditing(null); },
  });

  const searchText = search.trim().toLowerCase();
  const filtered = employees.filter(e => {
    const searchable = [e.name, e.email, e.department, e.organisation, e.entity]
      .map(value => String(value || '').toLowerCase())
      .join(' ');
    return (!searchText || searchable.includes(searchText)) && (!departmentFilter || e.department === departmentFilter);
  });
  const departments = Array.from(new Set(employees.map(employee => employee.department).filter(Boolean))) as string[];
  const departmentOptions = Array.from(new Set([
    'Nursing', 'OT', 'Ward', 'IT', 'HR', 'Accounts', 'Administration',
    'Reception', 'Pharmacy', 'Laboratory', 'Housekeeping', ...departments,
  ])).sort((a, b) => a.localeCompare(b));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleEmployees = filtered.slice((page - 1) * pageSize, page * pageSize);
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-shifts', workTimeEmployee?.id] }); setWorkTimeError(''); setWorkTimeMode('existing'); },
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
    setForm({
      name: emp.name, email: emp.email || '', department: emp.department || '', employeeNumber: emp.employeeId || '',
      mobile: emp.mobile || '', designation: emp.actualDesignation || emp.designation || '', biometricName: emp.biometricName || '', branch: emp.branch || emp.entity || '', status: emp.status || 'Active',
      basicSalary: emp.basicSalary ? String(emp.basicSalary) : '', shiftTimings: { morning: { start: emp.shiftTimings?.morning?.start || '', end: emp.shiftTimings?.morning?.end || '' }, evening: { start: emp.shiftTimings?.evening?.start || '', end: emp.shiftTimings?.evening?.end || '' }, night: { start: emp.shiftTimings?.night?.start || '', end: emp.shiftTimings?.night?.end || '' } },
      eligibleForPaidLeaves: emp.eligibleForPaidLeaves !== false, eligibleForOvertime: emp.eligibleForOvertime === true,
    });
  }

  function openWorkTimes(emp: Employee) {
    setWorkTimeEmployee(emp);
    setWorkTimeError('');
    setWorkTimeMode('existing');
    setWorkTimeForm({ shiftId: '', name: `${emp.name} custom`, roleTarget: 'GENERAL', startTime: '09:00', endTime: '18:00', graceMinutes: '15', isOvernight: false, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '' });
  }

  async function handlePhotoUpload(empId: number, file: File) {
    setUploadingPhotoFor(empId);
    try {
      await uploadEmployeePhoto(empId, file);
      qc.invalidateQueries({ queryKey: ['employees'] });
    } finally {
      setUploadingPhotoFor(null);
    }
  }

  function initials(name: string) {
    return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'E';
  }

  function timings(employee: Employee) {
    const configured = ([['M', employee.shiftTimings?.morning], ['E', employee.shiftTimings?.evening], ['N', employee.shiftTimings?.night]] as const)
      .filter(([, time]) => time?.start && time?.end);
    return configured.length ? configured.map(([label, time]) => `${label}: ${time!.start}-${time!.end}`).join(' · ') : '—';
  }

  return (
    <div className="w-full min-w-0 bg-slate-50/60 p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-[11px] font-medium text-slate-400">People <span className="mx-1">/</span> Employee Master</p><h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">Employee Master</h1><p className="mt-1 text-xs text-slate-500">Maintain employee records and keep payroll-ready workforce data organized.</p></div>
        <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600 shadow-sm">Last refreshed just now</button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[['Total employees', employees.length, 'groups', 'text-indigo-500'], ['Active employees', employees.length, 'person', 'text-indigo-500'], ['Inactive employees', 0, 'person_off', 'text-violet-500'], ['Departments', departments.length, 'business', 'text-violet-500']].map(([label, value, icon, tone]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-800">{value}</p><p className="mt-1 text-[10px] text-emerald-500">• {label === 'Departments' ? 'across the organisation' : 'of total workforce'}</p></div><span className={`material-icons rounded-lg bg-indigo-50 p-2 text-base ${tone}`}>{icon}</span></div></div>)}
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-3">
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1"><span className="material-icons pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">search</span><input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search by employee name, ID, mobile, designation or email" className="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></div>
            <select value={departmentFilter} onChange={e => { setDepartmentFilter(e.target.value); setPage(1); }} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 outline-none"><option value="">All departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}</select>
            <button onClick={() => { setSearch(''); setDepartmentFilter(''); setPage(1); }} className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><span className="material-icons mr-1 align-middle text-sm">filter_alt</span>Filters</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3"><div><h2 className="text-sm font-bold text-slate-800">Employee directory</h2><p className="text-[10px] text-slate-400">{filtered.length} active employees</p></div><div className="flex items-center gap-2"><button className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[10px] font-medium text-slate-600"><span className="material-icons mr-1 align-middle text-xs">download</span>Export</button>{selectedIds.length === 2 && <button onClick={() => { setMergeKeepId(selectedIds[0]); setMergeError(''); }} className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-[10px] font-semibold text-white"><span className="material-icons mr-1 align-middle text-xs">merge</span>Merge names</button>}</div></div>
        {isLoading ? <div className="p-12 text-center text-sm text-slate-400"><span className="material-icons mr-2 animate-spin align-middle">sync</span>Loading employees...</div> : filtered.length === 0 ? <div className="p-12 text-center text-sm text-slate-400">No employees match the current filters.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1530px] text-left"><thead className="border-b border-slate-200 bg-slate-50 text-[9px] font-bold uppercase tracking-wide text-slate-400"><tr><th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all visible employees" checked={visibleEmployees.length > 0 && visibleEmployees.every(e => selectedIds.includes(e.id))} onChange={() => setSelectedIds(visibleEmployees.every(e => selectedIds.includes(e.id)) ? [] : visibleEmployees.slice(0, 2).map(e => e.id))} /></th><th className="px-3 py-3">Employee</th><th className="px-3 py-3">Emp ID</th><th className="px-3 py-3">Mobile</th><th className="px-3 py-3">Department</th><th className="px-3 py-3">Branch</th><th className="px-3 py-3">Biometric Name</th><th className="px-3 py-3">Shift</th><th className="px-3 py-3">Timing</th><th className="px-3 py-3">Basic Salary</th><th className="px-3 py-3">Paid Leaves</th><th className="px-3 py-3">Overtime</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Edit</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleEmployees.map((emp, i) => <tr key={emp.id} className="group hover:bg-slate-50/70"><td className="px-4 py-2.5"><input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => setSelectedIds(ids => ids.includes(emp.id) ? ids.filter(id => id !== emp.id) : ids.length < 2 ? [...ids, emp.id] : ids)} /></td><td className="px-3 py-2.5"><button type="button" onClick={() => openEdit(emp)} className="flex items-center gap-2 text-left"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]} text-[9px] font-bold text-white`}>{emp.photoUrl ? <img src={emp.photoUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials(emp.name)}</div><div className="max-w-[180px]"><p className="truncate text-[11px] font-semibold text-slate-700 hover:text-indigo-600">{emp.name}</p><p className="truncate text-[9px] text-slate-400">{emp.email || '—'}</p></div></button></td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.employeeId || '—'}</td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.mobile || '—'}</td><td className="px-3 py-2.5"><span className="rounded bg-indigo-50 px-1.5 py-1 text-[9px] font-medium text-indigo-600">{emp.department || '—'}</span></td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.branch || emp.entity || '—'}</td><td className="px-3 py-2.5 text-[10px] text-slate-600">{emp.designation || emp.name}</td><td className="px-3 py-2.5"><button type="button" onClick={() => openWorkTimes(emp)} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100" title="Assign a shift / work time">M / E / N</button></td><td className="max-w-[190px] px-3 py-2.5 text-[9px] leading-4 text-slate-600">{timings(emp)}</td><td className="px-3 py-2.5 text-[10px] font-medium text-slate-700">{emp.basicSalary ? `₹${emp.basicSalary.toLocaleString('en-IN')}` : '—'}</td><td className="px-3 py-2.5 text-[10px] text-emerald-600">{emp.eligibleForPaidLeaves !== false ? 'Eligible' : 'No'}</td><td className="px-3 py-2.5 text-[10px] text-indigo-600">{emp.eligibleForOvertime ? 'Eligible' : 'No'}</td><td className="px-3 py-2.5"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-medium text-emerald-600">{emp.status || 'Active'}</span></td><td className="px-3 py-2.5"><button type="button" onClick={() => openEdit(emp)} className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-100"><span className="material-icons mr-1 align-middle text-xs">edit</span>Edit</button></td></tr>)}</tbody></table></div>}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-[10px] text-slate-400"><span>Showing {filtered.length ? ((page - 1) * pageSize) + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="flex gap-1"><button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">‹</button><span className="rounded bg-indigo-600 px-2 py-1 text-white">{page}</span><button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">›</button></div></div>
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
                  <div className="grid grid-cols-2 gap-3">
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Start time</span><input type="time" value={workTimeForm.startTime} onChange={e => setWorkTimeForm(prev => ({ ...prev, startTime: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">End time</span><input type="time" value={workTimeForm.endTime} onChange={e => setWorkTimeForm(prev => ({ ...prev, endTime: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Role target</span><input value={workTimeForm.roleTarget} onChange={e => setWorkTimeForm(prev => ({ ...prev, roleTarget: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                    <label><span className="mb-1.5 block text-sm font-medium text-slate-700">Grace minutes</span><input type="number" min="0" max="240" value={workTimeForm.graceMinutes} onChange={e => setWorkTimeForm(prev => ({ ...prev, graceMinutes: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" /></label>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={workTimeForm.isOvernight} onChange={e => setWorkTimeForm(prev => ({ ...prev, isOvernight: e.target.checked }))} className="h-4 w-4 accent-emerald-600" /> Overnight shift</label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
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

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div><h3 className="text-base font-bold text-slate-800">Edit Employee</h3><p className="mt-0.5 text-xs text-slate-400">Update this employee record</p></div>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <span className="material-icons text-xl text-slate-400">close</span>
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { label: 'Employee Name *', key: 'name', type: 'text', span: true }, { label: 'Employee ID *', key: 'employeeNumber', type: 'text' },
                  { label: 'Email Address', key: 'email', type: 'email' }, { label: 'Mobile Number', key: 'mobile', type: 'tel' },
                  { label: 'Designation', key: 'designation', type: 'text' }, { label: 'Biometric Name', key: 'biometricName', type: 'text' },
                  { label: 'Branch', key: 'branch', type: 'text' }, { label: 'Monthly Salary (INR)', key: 'basicSalary', type: 'number' },
                ].map(f => <div key={f.key} className={f.span ? 'sm:col-span-2' : ''}><label className="mb-1.5 block text-xs font-medium text-slate-700">{f.label}</label><input type={f.type} value={form[f.key as keyof EditForm] as string} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></div>)}
                <div><label className="mb-1.5 block text-xs font-medium text-slate-700">Department</label><input list="employee-departments" value={form.department} onChange={e => setForm(prev => ({ ...prev, department: e.target.value }))} placeholder="Select or type a department" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /><datalist id="employee-departments">{departmentOptions.map(department => <option key={department} value={department} />)}</datalist><p className="mt-1 text-[10px] text-slate-400">Choose a department or type a new one.</p></div>
                <div><label className="mb-1.5 block text-xs font-medium text-slate-700">Status</label><select value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-300"><option>Active</option><option>Inactive</option></select></div>
                <div className="sm:col-span-2"><p className="mb-2 text-xs font-semibold text-slate-700">Shift timings</p><div className="grid gap-2 sm:grid-cols-3">{(['morning', 'evening', 'night'] as const).map(shift => <div key={shift} className="rounded-lg border border-slate-200 p-2"><p className="text-xs font-medium capitalize text-slate-700">{shift} Shift</p><label className="mt-1 block text-[10px] text-slate-500">Start<input type="time" value={form.shiftTimings[shift].start} onChange={e => setForm(prev => ({ ...prev, shiftTimings: { ...prev.shiftTimings, [shift]: { ...prev.shiftTimings[shift], start: e.target.value } } }))} className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-xs" /></label><label className="mt-1 block text-[10px] text-slate-500">End<input type="time" value={form.shiftTimings[shift].end} onChange={e => setForm(prev => ({ ...prev, shiftTimings: { ...prev.shiftTimings, [shift]: { ...prev.shiftTimings[shift], end: e.target.value } } }))} className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-xs" /></label></div>)}</div><p className="mt-2 text-[11px] text-slate-400">The upload automatically matches the closest configured shift to the punch-in time. A Night Shift can end after midnight.</p></div>
              </div>
              <div className="mt-5 space-y-4">{/(^|[^a-z])it([^a-z]|$)|information technology/i.test(form.department) ? <div><p className="mb-2 text-xs font-medium text-slate-700">IT paid leave (2 days per month)</p><div className="grid grid-cols-2 gap-2">{[true, false].map(value => <button type="button" key={String(value)} onClick={() => setForm(prev => ({ ...prev, eligibleForPaidLeaves: value }))} className={`rounded-lg border py-2 text-sm font-medium ${form.eligibleForPaidLeaves === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>{value ? 'Yes' : 'No'}</button>)}</div><p className="mt-2 text-[11px] text-slate-400">IT employees always receive Sunday offs. Select Yes only for employees who should also receive two paid leaves each month.</p></div> : <div><p className="text-xs font-medium text-slate-700">Paid leaves</p><p className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Non-IT employees work on Sundays and automatically receive 4 paid leaves per month.</p></div>}<div><p className="mb-2 text-xs font-medium text-slate-700">Eligible for Overtime</p><div className="grid grid-cols-2 gap-2">{[true, false].map(value => <button type="button" key={String(value)} onClick={() => setForm(prev => ({ ...prev, eligibleForOvertime: value }))} className={`rounded-lg border py-2 text-sm font-medium ${form.eligibleForOvertime === value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>{value ? 'Yes' : 'No'}</button>)}</div></div></div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => mutation.mutate({ id: editing.id, data: form })}
                disabled={mutation.isPending}
                className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 transition-all"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
              >
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
