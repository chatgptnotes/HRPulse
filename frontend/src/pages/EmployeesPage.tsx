import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  sendEmployeeNotification,
  type EmployeeMaster,
  type EmployeeNotificationSeverity,
} from '../api';
import { DEPARTMENTS } from '../constants/departments';
import { mergeShiftOptions } from '../constants/shifts';
import clsx from 'clsx';
import EmployeeStatCard from '../components/employees/EmployeeStatCard';
import EmployeeAvatar from '../components/employees/EmployeeAvatar';
import EmployeeActionMenu, { EmployeeAction } from '../components/employees/EmployeeActionMenu';
import EmployeeFormModal from '../components/employees/EmployeeFormModal';
import EmployeeProfileDrawer from '../components/employees/EmployeeProfileDrawer';
import { exportEmployeesCsv } from '../components/employees/employeeCsv';
import { Employee, DrawerTab, fmtINR } from '../components/employees/types';

type SortKey = 'name' | 'employeeNumber' | 'department' | 'designation' | 'shift' | 'monthlySalary' | 'status';
type SortDir = 'asc' | 'desc';

interface ColumnDef { key: string; label: string; sortable: boolean; align?: 'left' | 'right' | 'center'; hideable: boolean }

// 'name' (the Employee column) is always visible — the rest can be toggled.
const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Employee', sortable: true, hideable: false },
  { key: 'employeeNumber', label: 'Emp ID', sortable: true, hideable: true },
  { key: 'mobile', label: 'Mobile', sortable: false, hideable: true },
  { key: 'department', label: 'Department', sortable: true, hideable: true },
  { key: 'designation', label: 'Designation', sortable: true, hideable: true },
  { key: 'shift', label: 'Shift', sortable: true, hideable: true },
  { key: 'timing', label: 'Timing', sortable: false, hideable: true },
  { key: 'monthlySalary', label: 'Monthly Salary', sortable: true, align: 'right', hideable: true },
  { key: 'paidLeavesEligible', label: 'Paid Leaves', sortable: false, align: 'center', hideable: true },
  { key: 'overtimeEligible', label: 'Overtime', sortable: false, align: 'center', hideable: true },
  { key: 'status', label: 'Status', sortable: true, hideable: true },
];

const PAGE_SIZES = [10, 25, 50, 100];
const NOTIFICATION_TYPES = [
  { value: 'personal', label: 'Personal' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'leave', label: 'Leave' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'announcement', label: 'Announcement' },
];
const NOTIFICATION_SEVERITIES: { value: EmployeeNotificationSeverity; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

// Suggest the next sequential Employee ID (EMP001, EMP002, ...).
function suggestNextId(employees: { employeeNumber: string }[]): string {
  let max = 0;
  for (const e of employees) {
    const m = /(\d+)/.exec(e.employeeNumber || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `EMP${String(max + 1).padStart(3, '0')}`;
}

export default function EmployeesPage() {
  const qc = useQueryClient();

  // filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [onlyPaidLeave, setOnlyPaidLeave] = useState(false);
  const [onlyOvertime, setOnlyOvertime] = useState(false);

  // sort + paginate
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // column visibility
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set(['designation']));
  const [showColMenu, setShowColMenu] = useState(false);

  // overlays
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [drawerEmp, setDrawerEmp] = useState<Employee | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [notifyEmp, setNotifyEmp] = useState<Employee | null>(null);
  const [notifyForm, setNotifyForm] = useState({
    type: 'personal',
    severity: 'info' as EmployeeNotificationSeverity,
    title: '',
    body: '',
  });
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => getEmployees().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: EmployeeMaster) => createEmployee(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setFormOpen(false);
      setEditing(null);
      setToast({ message: 'Employee saved successfully' });
      window.setTimeout(() => setToast(null), 2500);
    },
    onError: (err: any) => {
      setToast({ message: err?.response?.data?.error || err?.message || 'Employee save failed', error: true });
      window.setTimeout(() => setToast(null), 4500);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeeMaster }) => updateEmployee(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setFormOpen(false);
      setEditing(null);
      setToast({ message: 'Employee updated successfully' });
      window.setTimeout(() => setToast(null), 2500);
    },
    onError: (err: any) => {
      setToast({ message: err?.response?.data?.error || err?.message || 'Employee update failed', error: true });
      window.setTimeout(() => setToast(null), 4500);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteEmployee(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setDeleteId(null); },
  });
  const notifyMutation = useMutation({
    mutationFn: ({ employee, data }: {
      employee: Employee;
      data: { type: string; severity: EmployeeNotificationSeverity; title: string; body: string };
    }) => sendEmployeeNotification(employee.id, data),
    onSuccess: (response) => {
      const synced = response.data?.adamritSynced !== false;
      setNotifyEmp(null);
      setNotifyForm({ type: 'personal', severity: 'info', title: '', body: '' });
      setToast({
        message: synced ? 'Notification sent to Adamrit HR bell' : 'Saved in HRPulse, but Adamrit sync is not configured',
        error: !synced,
      });
      window.setTimeout(() => setToast(null), 3500);
    },
    onError: (err: any) => {
      setToast({ message: err?.response?.data?.error || err?.message || 'Notification failed', error: true });
      window.setTimeout(() => setToast(null), 4500);
    },
  });

  const departments = useMemo(
    () => [...new Set([...DEPARTMENTS, ...employees.map(e => e.department).filter(Boolean)])].sort(),
    [employees],
  );
  const shifts = useMemo(
    () => mergeShiftOptions(employees.map(e => e.shift)),
    [employees],
  );

  const filtered = useMemo(() => employees.filter(e => {
    const q = search.trim().toLowerCase();
    if (q && !(`${e.name} ${e.employeeNumber} ${e.mobile} ${e.designation} ${e.email}`.toLowerCase().includes(q))) return false;
    if (deptFilter && e.department !== deptFilter) return false;
    if (statusFilter && e.status !== statusFilter) return false;
    if (shiftFilter && e.shift !== shiftFilter) return false;
    if (onlyPaidLeave && e.paidLeavesEligible === false) return false;
    if (onlyOvertime && e.overtimeEligible !== true) return false;
    return true;
  }), [employees, search, deptFilter, statusFilter, shiftFilter, onlyPaidLeave, onlyOvertime]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a: any, b: any) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'monthlySalary') return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
      if (sortKey === 'employeeNumber') return String(va || '').localeCompare(String(vb || ''), undefined, { numeric: true }) * dir;
      return String(va || '').localeCompare(String(vb || '')) * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // reset to first page whenever filters/sort change
  useEffect(() => { setPage(1); }, [search, deptFilter, statusFilter, shiftFilter, onlyPaidLeave, onlyOvertime, pageSize]);

  const activeCount = employees.filter(e => e.status !== 'Inactive').length;
  const deptCount = departments.length;

  const hasActiveFilters = !!(search || deptFilter || statusFilter || shiftFilter || onlyPaidLeave || onlyOvertime);
  const resetFilters = () => { setSearch(''); setDeptFilter(''); setStatusFilter(''); setShiftFilter(''); setOnlyPaidLeave(false); setOnlyOvertime(false); };

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function openDrawer(emp: Employee, tab: DrawerTab = 'overview') { setDrawerEmp(emp); setDrawerTab(tab); }
  function openCreate() { setEditing(null); setFormOpen(true); }
  function openEdit(emp: Employee) { setEditing(emp); setFormOpen(true); }
  function openNotify(emp: Employee) {
    setNotifyEmp(emp);
    setNotifyForm({ type: 'personal', severity: 'info', title: '', body: '' });
  }

  function handleAction(emp: Employee, action: EmployeeAction) {
    switch (action) {
      case 'view': openDrawer(emp, 'overview'); break;
      case 'edit': openEdit(emp); break;
      case 'notify': openNotify(emp); break;
      case 'attendance': openDrawer(emp, 'attendance'); break;
      case 'salary': openDrawer(emp, 'salary'); break;
      case 'leave': openDrawer(emp, 'leave'); break;
      case 'documents': openDrawer(emp, 'documents'); break;
      case 'delete': setDeleteId(emp.id); break;
    }
  }

  function submitForm(data: EmployeeMaster) {
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  }

  function submitNotification() {
    if (!notifyEmp || notifyMutation.isPending) return;
    notifyMutation.mutate({ employee: notifyEmp, data: notifyForm });
  }

  const toggleCol = (key: string) =>
    setHiddenCols(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const colVisible = (c: ColumnDef) => c.key === 'name' || !hiddenCols.has(c.key);

  return (
    <div className="p-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Employee Master</h1>
          <p className="text-slate-500 text-sm mt-1">Maintain employee records. Attendance import links to these entries.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportEmployeesCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border bg-white border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            title="Export the filtered list to CSV"
          >
            <span className="material-icons text-lg">download</span>
            Export
          </button>
          <button
            onClick={() => setOnlyPaidLeave(v => !v)}
            className={clsx(
              'flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border transition-all',
              onlyPaidLeave ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
            title="Show only employees eligible for paid leaves"
          >
            <span className="material-icons text-lg">event_available</span>
            Paid Leaves
          </button>
          <button
            onClick={() => setOnlyOvertime(v => !v)}
            className={clsx(
              'flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border transition-all',
              onlyOvertime ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
            title="Show only employees eligible for overtime"
          >
            <span className="material-icons text-lg">timer</span>
            Overtime
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-all hover:shadow-md"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
          >
            <span className="material-icons text-lg">person_add</span>
            Add Employee
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <EmployeeStatCard icon="groups" label="Total Employees" value={employees.length} tone="indigo" />
        <EmployeeStatCard icon="check_circle" label="Active Employees" value={activeCount} sub={`${employees.length ? Math.round(activeCount / employees.length * 100) : 0}% of total`} tone="emerald" />
        <EmployeeStatCard icon="pause_circle" label="Inactive Employees" value={employees.length - activeCount} tone="slate" />
        <EmployeeStatCard icon="apartment" label="Departments" value={deptCount} tone="sky" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-3 mb-4 shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">search</span>
          <input
            placeholder="Search name, ID, mobile, designation, email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 bg-slate-50"
          />
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
          <option value="">All shifts</option>
          {shifts.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
          <option value="">All status</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        {hasActiveFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-2">
            <span className="material-icons text-base">restart_alt</span>Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm overflow-visible">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm text-slate-500">
            {filtered.length === employees.length
              ? `${employees.length} employee${employees.length === 1 ? '' : 's'}`
              : `${filtered.length} of ${employees.length} employees`}
          </p>
          <div className="relative">
            <button
              onClick={() => setShowColMenu(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg"
            >
              <span className="material-icons text-base">view_column</span>Columns
            </button>
            {showColMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColMenu(false)} />
                <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-50 animate-scale-in origin-top-right">
                  <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Toggle columns</p>
                  {COLUMNS.filter(c => c.hideable).map(c => (
                    <label key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} className="accent-indigo-600" />
                      {c.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Table body */}
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full min-w-[820px]">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                {COLUMNS.filter(colVisible).map(c => (
                  <th
                    key={c.key}
                    onClick={() => c.sortable && toggleSort(c.key as SortKey)}
                    className={clsx(
                      'px-4 py-3 font-semibold select-none',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                      c.sortable && 'cursor-pointer hover:text-slate-700',
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {c.sortable && (
                        <span className="material-icons text-sm">
                          {sortKey === c.key ? (sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                        </span>
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={COLUMNS.filter(colVisible).length + 1} className="px-4 py-12 text-center text-slate-400">
                  <span className="material-icons animate-spin text-3xl block mb-2 text-indigo-400">sync</span>Loading employees...
                </td></tr>
              )}
              {!isLoading && pageRows.length === 0 && (
                <tr><td colSpan={COLUMNS.filter(colVisible).length + 1} className="px-4 py-12 text-center text-slate-400">
                  <span className="material-icons text-4xl block mb-2 opacity-30">people</span>
                  {employees.length === 0 ? 'No employees yet. Click “Add Employee” to create your first record.' : 'No employees match the filters.'}
                </td></tr>
              )}
              {pageRows.map(emp => {
                const inactive = emp.status === 'Inactive';
                return (
                  <tr
                    key={emp.id}
                    onClick={() => openDrawer(emp, 'overview')}
                    className="border-t border-slate-100 hover:bg-indigo-50/30 transition-colors cursor-pointer"
                  >
                    {/* Employee (always visible) */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar name={emp.name} photoUrl={emp.photoUrl} size={38} />
                        <div className="min-w-0">
                          <p className={clsx('font-semibold text-sm truncate', inactive ? 'text-slate-400' : 'text-slate-800')}>{emp.name}</p>
                          {emp.email && <p className="text-xs text-slate-400 truncate">{emp.email}</p>}
                        </div>
                      </div>
                    </td>
                    {colVisible({ key: 'employeeNumber' } as ColumnDef) && <td className="px-3 py-3 text-sm font-mono text-slate-500">{emp.employeeNumber || '—'}</td>}
                    {colVisible({ key: 'mobile' } as ColumnDef) && <td className="px-3 py-3 text-sm text-slate-600">{emp.mobile || '—'}</td>}
                    {colVisible({ key: 'department' } as ColumnDef) && (
                      <td className="px-3 py-3 text-sm">
                        {emp.department ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs">{emp.department}</span> : '—'}
                      </td>
                    )}
                    {colVisible({ key: 'designation' } as ColumnDef) && <td className="px-3 py-3 text-sm text-slate-600">{emp.designation || '—'}</td>}
                    {colVisible({ key: 'shift' } as ColumnDef) && <td className="px-3 py-3 text-sm text-slate-600">{emp.shift || '—'}</td>}
                    {colVisible({ key: 'timing' } as ColumnDef) && (
                      <td className="px-3 py-3 text-sm text-slate-600">
                        {emp.shiftStartTime || emp.shiftEndTime ? (
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                            <span className="material-icons text-sm">schedule</span>
                            {emp.shiftStartTime || '--:--'} - {emp.shiftEndTime || '--:--'}
                          </span>
                        ) : '—'}
                      </td>
                    )}
                    {colVisible({ key: 'monthlySalary' } as ColumnDef) && (
                      <td className="px-3 py-3 text-sm text-right font-semibold text-slate-800">{emp.monthlySalary ? `₹ ${fmtINR(emp.monthlySalary)}` : '—'}</td>
                    )}
                    {colVisible({ key: 'paidLeavesEligible' } as ColumnDef) && (
                      <td className="px-3 py-3 text-center">
                        <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                          emp.paidLeavesEligible === false ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-700')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', emp.paidLeavesEligible === false ? 'bg-slate-400' : 'bg-emerald-500')} />
                          {emp.paidLeavesEligible === false ? 'No' : 'Yes'}
                        </span>
                      </td>
                    )}
                    {colVisible({ key: 'overtimeEligible' } as ColumnDef) && (
                      <td className="px-3 py-3 text-center">
                        <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                          emp.overtimeEligible ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', emp.overtimeEligible ? 'bg-indigo-500' : 'bg-slate-400')} />
                          {emp.overtimeEligible ? 'Yes' : 'No'}
                        </span>
                      </td>
                    )}
                    {colVisible({ key: 'status' } as ColumnDef) && (
                      <td className="px-3 py-3">
                        <span className={clsx('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                          inactive ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', inactive ? 'bg-slate-400' : 'bg-emerald-500')} />
                          {inactive ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <EmployeeActionMenu onAction={a => handleAction(emp, a)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Rows per page</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="border border-slate-200 rounded-md px-2 py-1 text-xs bg-white">
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="ml-2">
              {sorted.length === 0 ? '0–0 of 0' : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} of ${sorted.length}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40">
              <span className="material-icons text-lg">chevron_left</span>
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              .filter(p => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1)
              .map((p, idx, arr) => (
                <span key={p} className="inline-flex items-center">
                  {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-slate-300">…</span>}
                  <button
                    onClick={() => setPage(p)}
                    className={clsx('min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold',
                      p === safePage ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100')}
                  >
                    {p}
                  </button>
                </span>
              ))}
            <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40">
              <span className="material-icons text-lg">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit modal */}
      {formOpen && (
        <EmployeeFormModal
          editing={editing}
          suggestedId={suggestNextId(employees)}
          isPending={isPending}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSubmit={submitForm}
        />
      )}

      {/* Send Adamrit notification */}
      {notifyEmp && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Notify Employee</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {notifyEmp.name}{notifyEmp.email ? ` - ${notifyEmp.email}` : ' - email missing'}
                </p>
              </div>
              <button
                onClick={() => setNotifyEmp(null)}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="Close"
              >
                <span className="material-icons text-lg">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              {!notifyEmp.email && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                  Employee email is required because Adamrit maps HR notifications by email.
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">Type</span>
                  <select
                    value={notifyForm.type}
                    onChange={e => setNotifyForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {NOTIFICATION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">Severity</span>
                  <select
                    value={notifyForm.severity}
                    onChange={e => setNotifyForm(f => ({ ...f, severity: e.target.value as EmployeeNotificationSeverity }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {NOTIFICATION_SEVERITIES.map(severity => <option key={severity.value} value={severity.value}>{severity.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">Title</span>
                <input
                  value={notifyForm.title}
                  onChange={e => setNotifyForm(f => ({ ...f, title: e.target.value }))}
                  maxLength={160}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Notification title"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">Message</span>
                <textarea
                  value={notifyForm.body}
                  onChange={e => setNotifyForm(f => ({ ...f, body: e.target.value }))}
                  maxLength={2000}
                  rows={5}
                  className="w-full resize-none border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Message shown in Adamrit HR notifications"
                />
              </label>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setNotifyEmp(null)}
                className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitNotification}
                disabled={!notifyEmp.email || !notifyForm.title.trim() || !notifyForm.body.trim() || notifyMutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:hover:bg-indigo-600"
              >
                <span className="material-icons text-base">notifications</span>
                {notifyMutation.isPending ? 'Sending...' : 'Send to Adamrit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile drawer */}
      {drawerEmp && (
        <EmployeeProfileDrawer
          employee={drawerEmp}
          initialTab={drawerTab}
          onClose={() => setDrawerEmp(null)}
          onEdit={() => { const emp = drawerEmp; setDrawerEmp(null); if (emp) openEdit(emp); }}
        />
      )}

      {/* Delete confirm */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-scale-in">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <span className="material-icons text-red-500">delete</span>
            </div>
            <h3 className="text-lg font-bold text-slate-800 text-center mb-1">Delete Employee</h3>
            <p className="text-slate-500 text-sm text-center mb-5">This employee record will be permanently removed. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={clsx('fixed right-5 top-5 z-[70] rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xl', toast.error ? 'bg-rose-600' : 'bg-emerald-600')}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
