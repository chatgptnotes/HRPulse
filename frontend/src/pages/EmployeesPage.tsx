import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Columns3,
  Download,
  Filter,
  Import,
  Search,
  SlidersHorizontal,
  UserCheck,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
  X,
} from 'lucide-react';
import {
  getEmployees,
  getSettings,
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
import { Employee, DrawerTab, effectivePaidLeavePolicy, fmtINR } from '../components/employees/types';

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
const CHART_COLORS = ['#4F46E5', '#0EA5E9', '#14B8A6', '#F59E0B', '#8B5CF6', '#94A3B8'];
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

function employeePayload(employee: Employee, overrides: Partial<EmployeeMaster> = {}): EmployeeMaster {
  return {
    employeeNumber: employee.employeeNumber,
    name: employee.name,
    email: employee.email,
    mobile: employee.mobile,
    department: employee.department,
    designation: employee.designation,
    shift: employee.shift,
    shiftStartTime: employee.shiftStartTime,
    shiftEndTime: employee.shiftEndTime,
    monthlySalary: employee.monthlySalary,
    status: employee.status === 'Inactive' ? 'Inactive' : 'Active',
    paidLeavesEligible: employee.paidLeavesEligible,
    overtimeEligible: employee.overtimeEligible,
    ...overrides,
  };
}

function importValue(row: Record<string, unknown>, names: string[]) {
  const key = Object.keys(row).find(candidate => names.includes(candidate.trim().toLowerCase()));
  return key ? String(row[key] ?? '').trim() : '';
}

export default function EmployeesPage() {
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  // filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [onlyPaidLeave, setOnlyPaidLeave] = useState(false);
  const [onlyOvertime, setOnlyOvertime] = useState(false);
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // sort + paginate
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // column visibility
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set(['designation']));
  const [showColMenu, setShowColMenu] = useState(false);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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
  const { data: payrollSettings = {} } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => getSettings().then(r => r.data as Record<string, string>),
    staleTime: 60_000,
  });
  const itPaidLeaveLimit = Math.max(0, Number(payrollSettings.paid_leave_days || 2));

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
    if (onlyPaidLeave && !effectivePaidLeavePolicy(e, itPaidLeaveLimit).eligible) return false;
    if (onlyOvertime && e.overtimeEligible !== true) return false;
    if (salaryMin && e.monthlySalary < Number(salaryMin)) return false;
    if (salaryMax && e.monthlySalary > Number(salaryMax)) return false;
    return true;
  }), [employees, search, deptFilter, statusFilter, shiftFilter, onlyPaidLeave, onlyOvertime, salaryMin, salaryMax, itPaidLeaveLimit]);

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
  useEffect(() => { setPage(1); }, [search, deptFilter, statusFilter, shiftFilter, onlyPaidLeave, onlyOvertime, salaryMin, salaryMax, pageSize]);

  useEffect(() => {
    const focusEmployeeSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusEmployeeSearch);
    return () => window.removeEventListener('keydown', focusEmployeeSearch);
  }, []);

  const activeCount = employees.filter(e => e.status !== 'Inactive').length;
  const employeeDepartments = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const deptCount = employeeDepartments.length;
  const addedThisMonth = employees.filter(employee => {
    const created = new Date(employee.createdAt);
    const now = new Date();
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;
  const departmentData = useMemo(() => {
    const totals = new Map<string, number>();
    employees.forEach(employee => {
      const department = employee.department || 'Unassigned';
      totals.set(department, (totals.get(department) || 0) + 1);
    });
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [employees]);

  const hasActiveFilters = !!(search || deptFilter || statusFilter || shiftFilter || onlyPaidLeave || onlyOvertime || salaryMin || salaryMax);
  const advancedFilterCount = [onlyPaidLeave, onlyOvertime, salaryMin, salaryMax].filter(Boolean).length;
  const resetFilters = () => {
    setSearch('');
    setDeptFilter('');
    setStatusFilter('');
    setShiftFilter('');
    setOnlyPaidLeave(false);
    setOnlyOvertime(false);
    setSalaryMin('');
    setSalaryMax('');
  };

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

  async function handleImport(file: File | undefined) {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const records = rows.map(row => ({
        employeeNumber: importValue(row, ['employee id', 'employee number', 'emp id']),
        name: importValue(row, ['employee', 'employee name', 'name']),
        email: importValue(row, ['email', 'email address']),
        mobile: importValue(row, ['mobile', 'phone', 'mobile number']),
        department: importValue(row, ['department']),
        designation: importValue(row, ['designation', 'job title']),
        shift: importValue(row, ['shift']),
        shiftStartTime: importValue(row, ['shift start time', 'shift start', 'start time']),
        shiftEndTime: importValue(row, ['shift end time', 'shift end', 'end time']),
        monthlySalary: Number(importValue(row, ['monthly salary', 'salary'])) || 0,
        status: 'Active' as const,
        paidLeavesEligible: false,
        overtimeEligible: false,
      })).filter(record => record.name);

      if (!records.length) throw new Error('No employee rows with a Name column were found');
      if (!window.confirm(`Import ${records.length} employee${records.length === 1 ? '' : 's'} into HRPulse?`)) return;
      const results = await Promise.allSettled(records.map(record => createEmployee(record)));
      const imported = results.filter(result => result.status === 'fulfilled').length;
      const failed = results.length - imported;
      await qc.invalidateQueries({ queryKey: ['employees'] });
      setToast({
        message: failed ? `${imported} imported, ${failed} failed validation` : `${imported} employees imported successfully`,
        error: failed > 0,
      });
      window.setTimeout(() => setToast(null), 4500);
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Employee import failed', error: true });
      window.setTimeout(() => setToast(null), 4500);
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function updateSelectedStatus(status: 'Active' | 'Inactive') {
    const targets = employees.filter(employee => selectedIds.has(employee.id));
    if (!targets.length || bulkBusy) return;
    setBulkBusy(true);
    setShowBulkMenu(false);
    try {
      const results = await Promise.allSettled(targets.map(employee => updateEmployee(employee.id, employeePayload(employee, { status }))));
      const changed = results.filter(result => result.status === 'fulfilled').length;
      await qc.invalidateQueries({ queryKey: ['employees'] });
      setSelectedIds(new Set());
      setToast({ message: `${changed} employee${changed === 1 ? '' : 's'} marked ${status.toLowerCase()}` });
      window.setTimeout(() => setToast(null), 3000);
    } finally {
      setBulkBusy(false);
    }
  }

  const toggleCol = (key: string) =>
    setHiddenCols(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const colVisible = (c: ColumnDef) => c.key === 'name' || !hiddenCols.has(c.key);
  const allPageRowsSelected = pageRows.length > 0 && pageRows.every(employee => selectedIds.has(employee.id));
  const togglePageRows = () => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (allPageRowsSelected) pageRows.forEach(employee => next.delete(employee.id));
      else pageRows.forEach(employee => next.add(employee.id));
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <div className="mx-auto max-w-[1580px] px-4 py-7 md:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>People</span><ChevronRight size={13} /><span className="text-slate-600">Employee Master</span>
            </div>
            <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-slate-950">Employee Master</h1>
            <p className="mt-1.5 text-sm text-slate-500">Maintain employee records and keep payroll-ready workforce data organized.</p>
          </div>
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
            Last refreshed just now
          </p>
        </div>

        <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EmployeeStatCard icon={Users} label="Total employees" value={employees.length} detail={`+${addedThisMonth} added this month`} detailTone="positive" />
            <EmployeeStatCard icon={UserRoundCheck} label="Active employees" value={activeCount} detail={`${employees.length ? Math.round(activeCount / employees.length * 100) : 0}% of total workforce`} detailTone="positive" />
            <EmployeeStatCard icon={UserRoundX} label="Inactive employees" value={employees.length - activeCount} detail={`${employees.length ? Math.round((employees.length - activeCount) / employees.length * 100) : 0}% of total workforce`} />
            <EmployeeStatCard icon={Building2} label="Departments" value={deptCount} detail={`${employeeDepartments.length} represented in Employee Master`} />
          </div>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Department distribution</h2>
                <p className="mt-1 text-xs text-slate-500">Current workforce composition</p>
              </div>
              <span className="rounded-lg bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Live</span>
            </div>
            <div className="mt-2 grid grid-cols-[150px_1fr] items-center gap-2">
              <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={departmentData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">
                      {departmentData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2.5">
                {departmentData.slice(0, 5).map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                    <span className="min-w-0 flex-1 truncate text-slate-600">{entry.name}</span>
                    <span className="font-semibold text-slate-900">{entry.value}</span>
                  </div>
                ))}
                {!departmentData.length && <p className="text-xs text-slate-400">No department data</p>}
              </div>
            </div>
          </article>
        </section>

        <section className="relative mb-4 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[280px] flex-[2_1_420px]">
              <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                placeholder="Search by employee name, ID, mobile, designation or email"
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-9 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-50"
              />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X size={16} /></button>}
            </div>
            {[{
              value: deptFilter, set: setDeptFilter, label: 'All departments', options: departments,
            }, {
              value: shiftFilter, set: setShiftFilter, label: 'All shifts', options: shifts,
            }, {
              value: statusFilter, set: setStatusFilter, label: 'All statuses', options: ['Active', 'Inactive'],
            }].map(filterItem => (
              <div key={filterItem.label} className="relative">
                <select value={filterItem.value} onChange={event => filterItem.set(event.target.value)} className="h-11 min-w-[145px] appearance-none rounded-xl border border-slate-200 bg-white px-3 pr-9 text-xs font-medium text-slate-600 outline-none hover:border-slate-300 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50">
                  <option value="">{filterItem.label}</option>
                  {filterItem.options.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            ))}
            <button onClick={() => setShowAdvancedFilters(value => !value)} className={clsx(
              'relative flex h-11 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition',
              showAdvancedFilters || advancedFilterCount ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
            )}>
              <SlidersHorizontal size={16} />Filters
              {advancedFilterCount > 0 && <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] text-white">{advancedFilterCount}</span>}
            </button>
            {hasActiveFilters && <button onClick={resetFilters} className="h-11 px-2 text-xs font-semibold text-slate-500 hover:text-slate-900">Clear all</button>}
          </div>
          {showAdvancedFilters && (
            <div className="absolute right-3 top-[62px] z-30 w-[360px] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_18px_48px_rgba(15,23,42,0.14)]">
              <div className="flex items-center justify-between">
                <div><p className="text-sm font-semibold text-slate-900">Advanced filters</p><p className="mt-0.5 text-xs text-slate-500">Refine using available employee data</p></div>
                <button onClick={() => setShowAdvancedFilters(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">Minimum salary<input type="number" value={salaryMin} onChange={event => setSalaryMin(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-indigo-300" placeholder="₹ 0" /></label>
                <label className="text-xs font-medium text-slate-600">Maximum salary<input type="number" value={salaryMax} onChange={event => setSalaryMax(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-indigo-300" placeholder="No limit" /></label>
              </div>
              <div className="mt-4 space-y-2">
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 p-3 text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><CalendarDays size={15} className="text-slate-400" />Paid-leave eligible</span><input type="checkbox" checked={onlyPaidLeave} onChange={() => setOnlyPaidLeave(value => !value)} className="h-4 w-4 accent-indigo-600" /></label>
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 p-3 text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><Clock3 size={15} className="text-slate-400" />Overtime eligible</span><input type="checkbox" checked={onlyOvertime} onChange={() => setOnlyOvertime(value => !value)} className="h-4 w-4 accent-indigo-600" /></label>
              </div>
            </div>
          )}
        </section>

        <section className="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5">
            <div>
              <p className="text-sm font-semibold text-slate-900">Employee directory</p>
              <p className="mt-0.5 text-xs text-slate-500">{filtered.length === employees.length ? `${employees.length} total employees` : `${filtered.length} of ${employees.length} employees`}{selectedIds.size ? ` · ${selectedIds.size} selected` : ''}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => exportEmployeesCsv(selectedIds.size ? employees.filter(employee => selectedIds.has(employee.id)) : filtered, itPaidLeaveLimit)} disabled={!filtered.length} className="enterprise-action-button"><Download size={15} />Export</button>
              <input ref={importRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={event => void handleImport(event.target.files?.[0])} />
              <button onClick={() => importRef.current?.click()} className="enterprise-action-button"><Import size={15} />Import</button>
              <div className="relative">
                <button disabled={!selectedIds.size || bulkBusy} onClick={() => setShowBulkMenu(value => !value)} className="enterprise-action-button disabled:cursor-not-allowed disabled:opacity-45"><Check size={15} />Bulk actions<ChevronDown size={13} /></button>
                {showBulkMenu && (
                  <div className="absolute right-0 z-30 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.14)]">
                    <button onClick={() => void updateSelectedStatus('Active')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"><UserCheck size={15} className="text-emerald-600" />Mark active</button>
                    <button onClick={() => void updateSelectedStatus('Inactive')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"><UserRoundX size={15} className="text-slate-500" />Mark inactive</button>
                  </div>
                )}
              </div>
              <div className="relative">
                <button onClick={() => setShowColMenu(value => !value)} className="enterprise-action-button"><Columns3 size={15} />Columns</button>
                {showColMenu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowColMenu(false)} />
                    <div className="absolute right-0 z-30 mt-2 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_14px_36px_rgba(15,23,42,0.14)]">
                      <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Visible columns</p>
                      {COLUMNS.filter(column => column.hideable).map(column => (
                        <label key={column.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={!hiddenCols.has(column.key)} onChange={() => toggleCol(column.key)} className="accent-indigo-600" />{column.label}</label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button onClick={openCreate} className="flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"><UserPlus size={15} />Add employee</button>
            </div>
          </div>

        {/* Table body */}
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full min-w-[1160px] border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <th className="w-12 border-b border-slate-200 px-4 py-3.5 text-left">
                  <input type="checkbox" checked={allPageRowsSelected} onChange={togglePageRows} className="h-4 w-4 rounded border-slate-300 accent-indigo-600" aria-label="Select page" />
                </th>
                {COLUMNS.filter(colVisible).map(c => (
                  <th
                    key={c.key}
                    onClick={() => c.sortable && toggleSort(c.key as SortKey)}
                    className={clsx(
                      'border-b border-slate-200 px-4 py-3.5 font-semibold select-none',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                      c.sortable && 'cursor-pointer hover:text-slate-700',
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {c.label}
                      {c.sortable && (
                        sortKey === c.key
                          ? <ChevronDown size={13} className={sortDir === 'asc' ? 'rotate-180 text-indigo-600' : 'text-indigo-600'} />
                          : <ChevronsUpDown size={12} className="text-slate-300" />
                      )}
                    </span>
                  </th>
                ))}
                <th className="w-14 border-b border-slate-200 px-3 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={COLUMNS.filter(colVisible).length + 2} className="px-4 py-16 text-center text-slate-400">
                  <span className="material-icons animate-spin text-3xl block mb-2 text-indigo-400">sync</span>Loading employees...
                </td></tr>
              )}
              {!isLoading && pageRows.length === 0 && (
                <tr><td colSpan={COLUMNS.filter(colVisible).length + 2} className="px-4 py-16 text-center text-slate-400">
                  <span className="material-icons text-4xl block mb-2 opacity-30">people</span>
                  {employees.length === 0 ? 'No employees yet. Click “Add Employee” to create your first record.' : 'No employees match the filters.'}
                </td></tr>
              )}
              {pageRows.map((emp, rowIndex) => {
                const inactive = emp.status === 'Inactive';
                const selected = selectedIds.has(emp.id);
                const paidLeavePolicy = effectivePaidLeavePolicy(emp, itPaidLeaveLimit);
                return (
                  <tr
                    key={emp.id}
                    onClick={() => openDrawer(emp, 'overview')}
                    className={clsx(
                      'group cursor-pointer transition-colors hover:bg-indigo-50/50',
                      rowIndex % 2 === 1 && 'bg-slate-50/35',
                      selected && 'bg-indigo-50/70 hover:bg-indigo-50/80',
                    )}
                  >
                    <td className="border-b border-slate-100 px-4 py-3.5" onClick={event => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => setSelectedIds(previous => {
                          const next = new Set(previous);
                          next.has(emp.id) ? next.delete(emp.id) : next.add(emp.id);
                          return next;
                        })}
                        className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                        aria-label={`Select ${emp.name}`}
                      />
                    </td>
                    {/* Employee (always visible) */}
                    <td className="border-b border-slate-100 px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar name={emp.name} photoUrl={emp.photoUrl} size={40} />
                        <div className="min-w-0">
                          <p className={clsx('truncate text-[13px] font-semibold', inactive ? 'text-slate-400' : 'text-slate-900')}>{emp.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">{[emp.designation, emp.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
                        </div>
                      </div>
                    </td>
                    {colVisible({ key: 'employeeNumber' } as ColumnDef) && <td className="border-b border-slate-100 px-4 py-3.5 font-mono text-xs font-medium text-slate-500">{emp.employeeNumber || '—'}</td>}
                    {colVisible({ key: 'mobile' } as ColumnDef) && <td className="border-b border-slate-100 px-4 py-3.5 text-xs text-slate-600">{emp.mobile || '—'}</td>}
                    {colVisible({ key: 'department' } as ColumnDef) && (
                      <td className="border-b border-slate-100 px-4 py-3.5 text-xs">
                        {emp.department ? <span className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">{emp.department}</span> : '—'}
                      </td>
                    )}
                    {colVisible({ key: 'designation' } as ColumnDef) && <td className="border-b border-slate-100 px-4 py-3.5 text-xs text-slate-600">{emp.designation || '—'}</td>}
                    {colVisible({ key: 'shift' } as ColumnDef) && <td className="border-b border-slate-100 px-4 py-3.5 text-xs font-medium text-slate-600">{emp.shift || '—'}</td>}
                    {colVisible({ key: 'timing' } as ColumnDef) && (
                      <td className="border-b border-slate-100 px-4 py-3.5 text-xs text-slate-600">
                        {emp.shiftStartTime || emp.shiftEndTime ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                            <Clock3 size={13} />
                            {emp.shiftStartTime || '--:--'} - {emp.shiftEndTime || '--:--'}
                          </span>
                        ) : '—'}
                      </td>
                    )}
                    {colVisible({ key: 'monthlySalary' } as ColumnDef) && (
                      <td className="border-b border-slate-100 px-4 py-3.5 text-right text-xs font-semibold text-slate-900">{emp.monthlySalary ? `₹ ${fmtINR(emp.monthlySalary)}` : '—'}</td>
                    )}
                    {colVisible({ key: 'paidLeavesEligible' } as ColumnDef) && (
                      <td className="border-b border-slate-100 px-4 py-3.5 text-center">
                        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                          !paidLeavePolicy.eligible ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-700')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', !paidLeavePolicy.eligible ? 'bg-slate-400' : 'bg-emerald-500')} />
                          {paidLeavePolicy.eligible ? `${paidLeavePolicy.limit} days` : 'No'}
                        </span>
                      </td>
                    )}
                    {colVisible({ key: 'overtimeEligible' } as ColumnDef) && (
                      <td className="border-b border-slate-100 px-4 py-3.5 text-center">
                        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                          emp.overtimeEligible ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', emp.overtimeEligible ? 'bg-indigo-500' : 'bg-slate-400')} />
                          {emp.overtimeEligible ? 'Yes' : 'No'}
                        </span>
                      </td>
                    )}
                    {colVisible({ key: 'status' } as ColumnDef) && (
                      <td className="border-b border-slate-100 px-4 py-3.5">
                        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          inactive ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700')}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', inactive ? 'bg-slate-400' : 'bg-emerald-500')} />
                          {inactive ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                    )}
                    <td className="border-b border-slate-100 px-3 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                      <EmployeeActionMenu onAction={a => handleAction(emp, a)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3.5">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Rows per page</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium outline-none focus:border-indigo-300">
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="ml-2 font-medium text-slate-600">
              {sorted.length === 0 ? '0–0 of 0' : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} of ${sorted.length}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-40">
              <ChevronLeft size={15} />
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              .filter(p => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1)
              .map((p, idx, arr) => (
                <span key={p} className="inline-flex items-center">
                  {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-slate-300">…</span>}
                  <button
                    onClick={() => setPage(p)}
                    className={clsx('h-8 min-w-[32px] rounded-lg border px-2 text-xs font-semibold',
                      p === safePage ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
                  >
                    {p}
                  </button>
                </span>
              ))}
            <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-40">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        </section>

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
