import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import clsx from 'clsx';
import * as api from '../api';
import { DEPARTMENTS } from '../constants/departments';
import { mergeShiftOptions } from '../constants/shifts';
import PayrollDetailModal from '../components/payroll/PayrollDetailModal';
import UploadCard from '../components/payroll/UploadCard';
import { fmtINR, fmtNum } from '../components/payroll/format';

interface PayrollRow {
  employeeId: number;
  employeeNumber: string | null;
  biometricId: string | null;
  employeeName: string;
  department: string | null;
  designation: string | null;
  shift: string | null;
  monthlySalary: number;
  dailySalary: number;
  presentDays: number;
  halfDays: number;
  totalAbsentDays: number;
  absentDays: number;
  lateDays: number;
  missingPunches: number;
  punchCount: number;
  totalWorkingHours: number;
  overtimeHours: number;
  overtimePay: number;
  absentDeduction: number;
  halfDayDeduction: number;
  payableDays: number;
  grossSalary: number;
  totalDeductions: number;
  ruleDeductionDays: number;
  ruleDeductionAmount: number;
  ruleAllowanceAmount: number;
  netSalary: number;
  status: string;
}

interface Summary {
  totalEmployees: number;
  presentEmployees: number;
  absentEmployees: number;
  halfDayEmployees: number;
  totalOvertimeHours: number;
  totalSalaryPayable: number;
}

interface HistoryRow {
  id: number;
  filename: string;
  uploadedAt: string;
  periodMonth: string;
  year: string;
  month: string;
  rowCount: number;
  status: string;
  uploadedBy: string;
}

type SortKey = keyof PayrollRow;

const months = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const currentYear = new Date().getFullYear();
const allYears = Array.from({ length: currentYear - 2000 + 6 }, (_, index) => String(2000 + index)).reverse();

const columns: Array<{ key: string; label: string; sortable?: SortKey; align?: 'left' | 'right'; defaultVisible?: boolean }> = [
  { key: 'employee', label: 'Employee', sortable: 'employeeName', defaultVisible: true },
  { key: 'employeeNumber', label: 'Employee ID', sortable: 'employeeNumber', defaultVisible: true },
  { key: 'department', label: 'Department', sortable: 'department', defaultVisible: true },
  { key: 'shift', label: 'Shift', sortable: 'shift', defaultVisible: true },
  { key: 'presentDays', label: 'Present Days', sortable: 'presentDays', align: 'right', defaultVisible: true },
  { key: 'absentDays', label: 'Absent Days', sortable: 'absentDays', align: 'right', defaultVisible: true },
  { key: 'halfDays', label: 'Half Days', sortable: 'halfDays', align: 'right', defaultVisible: true },
  { key: 'lateDays', label: 'Late Count', sortable: 'lateDays', align: 'right', defaultVisible: true },
  { key: 'totalWorkingHours', label: 'Working Hours', sortable: 'totalWorkingHours', align: 'right', defaultVisible: true },
  { key: 'overtimeHours', label: 'Overtime Hours', sortable: 'overtimeHours', align: 'right', defaultVisible: true },
  { key: 'overtimePay', label: 'Overtime Pay', sortable: 'overtimePay', align: 'right', defaultVisible: true },
  { key: 'halfDayDeduction', label: 'Half Day Deduction', sortable: 'halfDayDeduction', align: 'right', defaultVisible: true },
  { key: 'payableDays', label: 'Payable Days', sortable: 'payableDays', align: 'right', defaultVisible: true },
  { key: 'grossSalary', label: 'Gross Salary', sortable: 'grossSalary', align: 'right', defaultVisible: true },
  { key: 'totalDeductions', label: 'Deductions', sortable: 'totalDeductions', align: 'right', defaultVisible: true },
  { key: 'netSalary', label: 'Net Salary', sortable: 'netSalary', align: 'right', defaultVisible: true },
  { key: 'status', label: 'Status', sortable: 'status', defaultVisible: true },
  { key: 'actions', label: 'Actions', defaultVisible: true },
];

const pct = (part = 0, total = 0) => (total ? Math.round((part / total) * 100) : 0);
const idFor = (row: PayrollRow) => row.employeeNumber || row.biometricId || String(row.employeeId);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'HR';

function Icon({ name, className = 'text-base' }: { name: string; className?: string }) {
  return <span className={clsx('material-icons leading-none', className)}>{name}</span>;
}

function MetricCard({
  icon, label, value, helper, tone, bar, progress,
}: { icon: string; label: string; value: string | number; helper: string; tone: string; bar: string; progress: number }) {
  return (
    <div className="group rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="flex min-h-[78px] items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-3 text-2xl font-black leading-7 text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{helper}</p>
        </div>
        <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-sm transition group-hover:shadow', tone)}>
          <Icon name={icon} className="text-lg" />
        </div>
      </div>
      <div className="mt-4 h-[3px] rounded-full bg-slate-100">
        <div
          className={clsx('h-full rounded-full transition-all group-hover:brightness-95', bar)}
          style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
}

function SummaryTile({
  icon, label, value, helper, tone, bar, progress,
}: { icon: string; label: string; value: string; helper: string; tone: string; bar: string; progress: number }) {
  return (
    <div className="group flex min-w-[160px] flex-1 flex-col justify-between gap-2 px-4 py-3 transition hover:bg-slate-50/80">
      <div className="flex items-start gap-3">
        <div className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white', tone)}>
          <Icon name={icon} className="text-base" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black leading-6 text-slate-950">{value}</p>
          <p className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="truncate text-[11px] text-slate-500">{helper}</p>
        </div>
      </div>
      <div className="h-1 rounded-full bg-slate-100">
        <div
          className={clsx('h-full rounded-full transition-all group-hover:brightness-95', bar)}
          style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function controlClass(extra = '') {
  return clsx(
    'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100',
    extra,
  );
}

function Th({
  children, align = 'left', sortable, sortKey, sortDir, onSort,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  sortable?: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = sortable === sortKey;
  return (
    <th className={clsx('sticky top-0 z-10 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500', align === 'right' ? 'text-right' : 'text-left')}>
      {sortable ? (
        <button onClick={() => onSort(sortable)} className={clsx('inline-flex items-center gap-1 whitespace-nowrap', align === 'right' && 'justify-end')}>
          {children}
          <Icon name={active && sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'} className={clsx('text-sm', active ? 'text-indigo-600' : 'text-slate-300')} />
        </button>
      ) : (
        <span className="whitespace-nowrap">{children}</span>
      )}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return <td className={clsx('px-4 py-3 text-sm text-slate-700', align === 'right' ? 'text-right' : 'text-left', className)}>{children}</td>;
}

export default function PayrollPage() {
  const qc = useQueryClient();
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [periodMonth, setPeriodMonth] = useState('');
  const [periodYear, setPeriodYear] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [deleteUploadId, setDeleteUploadId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ employeeId: number; name: string } | null>(null);

  const [fMonth, setFMonth] = useState('');
  const [fYear, setFYear] = useState('');
  const [fDept, setFDept] = useState('');
  const [fShift, setFShift] = useState('');
  const [fEmp, setFEmp] = useState('');
  const [onlyNoPunch, setOnlyNoPunch] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('netSalary');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(columns.map(c => [c.key, c.defaultVisible !== false])),
  );

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: history = [] } = useQuery<HistoryRow[]>({ queryKey: ['payroll-history'], queryFn: () => api.getPayrollHistory().then(r => r.data) });
  const { data: filters } = useQuery({ queryKey: ['payroll-filters'], queryFn: () => api.getPayrollFilters().then(r => r.data) });
  const { data: run, refetch: refetchRun, isFetching } = useQuery({
    queryKey: ['payroll-run', uploadId],
    queryFn: () => api.getPayrollRun(uploadId!).then(r => r.data),
    enabled: !!uploadId,
  });
  const { data: finalization } = useQuery({
    queryKey: ['payroll-finalization', periodMonth],
    queryFn: () => api.getPayrollFinalizationStatus(periodMonth).then(response => response.data),
    enabled: /^\d{4}-\d{2}$/.test(periodMonth),
  });

  useEffect(() => {
    if (!uploadId && history.length > 0) {
      const latest = history[0];
      setUploadId(latest.id);
      setPeriodMonth(latest.periodMonth);
      setPeriodYear(latest.year);
    }
  }, [history, uploadId]);

  const selectedUpload = useMemo(() => history.find(h => h.id === uploadId), [history, uploadId]);
  const rows: PayrollRow[] = (run?.payroll?.rows as PayrollRow[]) || [];
  const summary: Summary = run?.payroll?.summary || {
    totalEmployees: rows.length,
    presentEmployees: rows.filter(r => r.presentDays > 0).length,
    absentEmployees: rows.filter(r => r.absentDays > 0).length,
    halfDayEmployees: rows.filter(r => r.halfDays > 0).length,
    totalOvertimeHours: rows.reduce((sum, r) => sum + (r.overtimeHours || 0), 0),
    totalSalaryPayable: rows.reduce((sum, r) => sum + (r.netSalary || 0), 0),
  };

  const onDrop = async (files: File[]) => {
    if (!files[0]) return;
    setUploading(true);
    setUploadWarnings([]);
    try {
      const { data } = await api.processPayroll(files[0]);
      setUploadId(data.uploadId);
      setPeriodMonth(data.periodMonth);
      setPeriodYear(data.periodYear);
      setUploadWarnings(data.warnings || []);
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      qc.invalidateQueries({ queryKey: ['payroll-filters'] });
      const uploadMonths = Array.isArray(data.uploads) && data.uploads.length > 1
        ? data.uploads.map((item: { periodMonth: string }) => item.periodMonth).join(', ')
        : data.periodMonth;
      showToast(`Processed ${data.rowCount} day-wise records for ${uploadMonths}`);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Processing failed', 'err');
    } finally {
      setUploading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
  });

  const years = useMemo(() => {
    const uploadYears = history.map(h => h.year).filter(Boolean);
    return [...new Set([...allYears, ...uploadYears])].sort((a, b) => Number(b) - Number(a));
  }, [history]);
  const deptOptions = useMemo(() => [...new Set([...DEPARTMENTS, ...(filters?.departments || [])])].sort(), [filters]);
  const shiftOptions = useMemo(() => mergeShiftOptions(filters?.shifts || []), [filters]);
  const activeColumns = columns.filter(c => visible[c.key]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (fMonth && periodMonth.substring(5, 7) !== fMonth) return false;
      if (fYear && periodYear !== fYear) return false;
      if (fDept && r.department !== fDept) return false;
      if (fShift && r.shift !== fShift) return false;
      if (onlyNoPunch && (r.punchCount ?? 0) > 0) return false;
      const employeeQuery = fEmp.trim().toLowerCase();
      if (employeeQuery && !`${r.employeeName} ${idFor(r)}`.toLowerCase().includes(employeeQuery)) return false;
      return true;
    });
  }, [rows, fMonth, fYear, fDept, fShift, fEmp, onlyNoPunch, periodMonth, periodYear]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const result = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? result : -result;
    });
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [fMonth, fYear, fDept, fShift, fEmp, onlyNoPunch, pageSize]);

  const payrollTotals = useMemo(() => {
    const totalGross = filtered.reduce((sum, r) => sum + (r.grossSalary || 0), 0);
    const totalDeductions = filtered.reduce((sum, r) => sum + (r.totalDeductions || 0), 0);
    const net = filtered.reduce((sum, r) => sum + (r.netSalary || 0), 0);
    const processed = filtered.filter(r => r.status === 'Processed').length;
    const pending = Math.max(0, filtered.length - processed);
    return { totalGross, totalDeductions, net, processed, pending };
  }, [filtered]);

  const resetFilters = () => {
    setFMonth('');
    setFYear('');
    setFDept('');
    setFShift('');
    setFEmp('');
    setOnlyNoPunch(false);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  const exportCsv = () => {
    const headers = ['Employee ID', 'Employee Name', 'Department', 'Shift', 'Present Days', 'Absent Days', 'Half Days', 'Late Count', 'Working Hours', 'Overtime Hours', 'Overtime Pay', 'Half Day Deduction', 'Payable Days', 'Gross Salary', 'Deductions', 'Net Salary', 'Status'];
    const csvRows = sorted.map(r => [
      idFor(r), r.employeeName, r.department || '', r.shift || '', r.presentDays, r.absentDays, r.halfDays, r.lateDays,
      r.totalWorkingHours, r.overtimeHours, r.overtimePay, r.halfDayDeduction, r.payableDays, r.grossSalary, r.totalDeductions, r.netSalary, r.status,
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-summary-${periodMonth || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  async function confirmDeleteUpload() {
    if (deleteUploadId == null) return;
    const target = deleteUploadId;
    try {
      await api.deleteUpload(target);
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      qc.invalidateQueries({ queryKey: ['payroll-filters'] });
      if (uploadId === target) {
        setUploadId(null);
        setPeriodMonth('');
        setPeriodYear('');
      }
      showToast('Upload deleted');
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Failed to delete upload', 'err');
    } finally {
      setDeleteUploadId(null);
    }
  }

  const renderCell = (row: PayrollRow, key: string) => {
    switch (key) {
      case 'employee':
        return (
          <div className="flex min-w-56 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-bold text-white shadow-md shadow-indigo-100">
              {initials(row.employeeName)}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{row.employeeName}</p>
              <p className="truncate text-xs text-slate-400">{row.designation || 'Payroll employee'}</p>
            </div>
          </div>
        );
      case 'employeeNumber':
        return <span className="font-mono text-xs text-slate-500">{idFor(row)}</span>;
      case 'department':
        return row.department || '-';
      case 'shift':
        return row.shift || '-';
      case 'presentDays':
        return fmtNum(row.presentDays, 1);
      case 'absentDays':
        return <span className={row.absentDays > 0 ? 'font-semibold text-rose-600' : ''}>{row.absentDays || '-'}</span>;
      case 'halfDays':
        return row.halfDays || '-';
      case 'lateDays':
        return row.lateDays || '-';
      case 'totalWorkingHours':
        return fmtNum(row.totalWorkingHours, 1);
      case 'overtimeHours':
        return <span className={row.overtimeHours > 0 ? 'font-semibold text-indigo-600' : ''}>{row.overtimeHours || '-'}</span>;
      case 'overtimePay':
        return <span className={row.overtimePay > 0 ? 'font-semibold text-emerald-700' : ''}>{row.overtimePay ? `INR ${fmtINR(row.overtimePay)}` : '-'}</span>;
      case 'halfDayDeduction':
        return <span className={row.halfDayDeduction > 0 ? 'font-semibold text-amber-700' : ''}>{row.halfDayDeduction ? `INR ${fmtINR(row.halfDayDeduction)}` : '-'}</span>;
      case 'payableDays':
        return fmtNum(row.payableDays, 1);
      case 'grossSalary':
        return `INR ${fmtINR(row.grossSalary)}`;
      case 'totalDeductions':
        return <span className="text-rose-600">{row.totalDeductions ? `INR ${fmtINR(row.totalDeductions)}` : '-'}</span>;
      case 'netSalary':
        return <span className="font-bold text-emerald-700">INR {fmtINR(row.netSalary)}</span>;
      case 'status':
        return (
          <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize', row.status === 'Processed' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100')}>
            {row.status}
          </span>
        );
      case 'actions':
        return (
          <button
            onClick={() => setDetail({ employeeId: row.employeeId, name: row.employeeName })}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100"
          >
            <Icon name="visibility" className="text-sm" />
            View Details
          </button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-sm shadow-slate-200/70 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 ring-1 ring-indigo-100">
                <Icon name="auto_awesome" className="text-sm" />
                AI payroll command center
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">Payroll / Salary Calculation</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Upload attendance, verify payroll readiness, analyze trends, and review salary calculations from one dashboard.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {finalization?.latestRun && (
                <span className="inline-flex h-10 items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700">
                  Finalized v{finalization.latestRun.version} · {finalization.latestRun.publish_status}
                </span>
              )}
              <button
                onClick={() => refetchRun()}
                disabled={!uploadId || isFetching}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition hover:from-indigo-700 hover:to-purple-700 disabled:opacity-40"
              >
                <Icon name={isFetching ? 'sync' : 'calculate'} className={clsx('text-base', isFetching && 'animate-spin')} />
                {isFetching ? 'Calculating' : 'Calculate Salary'}
              </button>
              <button onClick={resetFilters} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50">
                <Icon name="restart_alt" className="text-base" />
                Reset
              </button>
              <button
                onClick={() => setShowHistory(s => !s)}
                className={clsx('inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold transition', showHistory ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
              >
                <Icon name="history" className="text-base" />
                Upload History
              </button>
            </div>
          </div>
        </header>

        <UploadCard
          ready={!!uploadId}
          uploading={uploading}
          isDragActive={isDragActive}
          filename={selectedUpload?.filename}
          uploadedAt={selectedUpload?.uploadedAt}
          periodMonth={periodMonth}
          recordCount={selectedUpload?.rowCount}
          employeeCount={summary.totalEmployees}
          hasWarnings={uploadWarnings.length > 0}
          getRootProps={getRootProps}
          getInputProps={getInputProps}
        />

        {uploadWarnings.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <div className="mb-1 flex items-center gap-2 font-bold">
              <Icon name="warning" className="text-base" />
              File validation notes
            </div>
            {uploadWarnings.slice(0, 5).map((w, i) => <p key={i} className="text-xs">{w}</p>)}
            {uploadWarnings.length > 5 && <p className="mt-1 text-xs font-semibold">+{uploadWarnings.length - 5} more notes</p>}
          </div>
        )}

        {showHistory && (
          <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-900">Upload History</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{history.length} uploads</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">File Name</th>
                    <th className="px-4 py-3 text-left">Uploaded</th>
                    <th className="px-4 py-3 text-left">Period</th>
                    <th className="px-4 py-3 text-right">Records</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Uploaded By</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No uploads yet</td></tr>}
                  {history.map(h => (
                    <tr key={h.id} className="transition hover:bg-indigo-50/40">
                      <td className="px-4 py-3 font-semibold text-slate-800">{h.filename}</td>
                      <td className="px-4 py-3 text-slate-500">{new Date(h.uploadedAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-600">{h.periodMonth}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{h.rowCount}</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold capitalize text-emerald-700">{h.status}</span></td>
                      <td className="px-4 py-3 text-slate-500">{h.uploadedBy}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => { setUploadId(h.id); setPeriodMonth(h.periodMonth); setPeriodYear(h.year); setShowHistory(false); }} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100">Load</button>
                          <button onClick={() => setDeleteUploadId(h.id)} className="rounded-lg bg-rose-50 px-2 py-1.5 text-rose-600 hover:bg-rose-100" title="Delete upload"><Icon name="delete" className="text-base" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon="groups"
            label="Total Employees"
            value={summary.totalEmployees}
            helper="100% payroll base"
            tone="border-slate-200 bg-slate-50 text-slate-700"
            bar="bg-slate-700"
            progress={100}
          />
          <MetricCard
            icon="check_circle"
            label="Present Employees"
            value={summary.presentEmployees}
            helper={`${pct(summary.presentEmployees, summary.totalEmployees)}% attendance`}
            tone="border-emerald-100 bg-emerald-50 text-emerald-600"
            bar="bg-emerald-500"
            progress={pct(summary.presentEmployees, summary.totalEmployees)}
          />
          <MetricCard
            icon="pending_actions"
            label="Pending Employees"
            value={payrollTotals.pending}
            helper="Need payroll review"
            tone="border-amber-100 bg-amber-50 text-amber-600"
            bar="bg-amber-500"
            progress={pct(payrollTotals.pending, Math.max(summary.totalEmployees, filtered.length))}
          />
          <MetricCard
            icon="payments"
            label="Salary Payable"
            value={`INR ${fmtINR(summary.totalSalaryPayable)}`}
            helper="Net payroll value"
            tone="border-purple-100 bg-purple-50 text-purple-600"
            bar="bg-purple-500"
            progress={pct(summary.totalSalaryPayable, payrollTotals.totalGross)}
          />
        </section>

        <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
            <div>
              <h2 className="text-sm font-bold text-slate-950">Payroll Summary</h2>
              <p className="text-[11px] text-slate-400">Selected payroll run totals</p>
            </div>
            <span className="whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
              {filtered.length} Employees Selected
            </span>
          </div>
          <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-5">
            <SummaryTile
              icon="account_balance_wallet"
              label="Gross Salary"
              value={`INR ${fmtINR(payrollTotals.totalGross)}`}
              helper="Before deductions"
              tone="border-violet-100 text-violet-600"
              bar="bg-violet-500"
              progress={100}
            />
            <SummaryTile
              icon="remove_circle"
              label="Total Deductions"
              value={`INR ${fmtINR(payrollTotals.totalDeductions)}`}
              helper="PF, ESI, loans, advances"
              tone="border-rose-100 text-rose-600"
              bar="bg-rose-500"
              progress={pct(payrollTotals.totalDeductions, payrollTotals.totalGross)}
            />
            <SummaryTile
              icon="payments"
              label="Net Payable"
              value={`INR ${fmtINR(payrollTotals.net)}`}
              helper="Final payable salary"
              tone="border-emerald-100 text-emerald-600"
              bar="bg-emerald-500"
              progress={pct(payrollTotals.net, payrollTotals.totalGross)}
            />
            <SummaryTile
              icon="task_alt"
              label="Processed"
              value={String(payrollTotals.processed)}
              helper="Employees calculated"
              tone="border-teal-100 text-teal-600"
              bar="bg-teal-500"
              progress={pct(payrollTotals.processed, filtered.length)}
            />
            <SummaryTile
              icon="hourglass_top"
              label="Pending"
              value={String(payrollTotals.pending)}
              helper="Employees pending"
              tone="border-amber-100 text-amber-600"
              bar="bg-amber-500"
              progress={pct(payrollTotals.pending, filtered.length)}
            />
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Payroll Filters</h2>
              <p className="text-xs text-slate-400">Refine attendance and salary rows without changing the processed run.</p>
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{filtered.length} matching employees</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Field label="Month">
              <select value={fMonth} onChange={e => setFMonth(e.target.value)} className={controlClass()}>
                <option value="">All months</option>
                {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Year">
              <select value={fYear} onChange={e => setFYear(e.target.value)} className={controlClass()}>
                <option value="">All years</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select value={fDept} onChange={e => setFDept(e.target.value)} className={controlClass()}>
                <option value="">All departments</option>
                {deptOptions.map((d: string) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Shift">
              <select value={fShift} onChange={e => setFShift(e.target.value)} className={controlClass()}>
                <option value="">All shifts</option>
                {shiftOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Employee Search">
              <input value={fEmp} onChange={e => setFEmp(e.target.value)} placeholder="Name or ID" className={controlClass()} />
            </Field>
            <Field label="No Punch">
              <button
                onClick={() => setOnlyNoPunch(v => !v)}
                className={clsx('inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition', onlyNoPunch ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
              >
                <Icon name="touch_app" className="text-base" />
                {onlyNoPunch ? 'Enabled' : 'Show only'}
              </button>
            </Field>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-950">Employee Salary Summary</h2>
                <p className="text-xs text-slate-400">Sticky headers, sorting, search, pagination, export, and column controls.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={exportCsv} disabled={!sorted.length} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                  <Icon name="download" className="text-base" />
                  Export
                </button>
                <div className="relative">
                  <button onClick={() => setShowColumns(v => !v)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50">
                    <Icon name="view_column" className="text-base" />
                    Columns
                  </button>
                  {showColumns && (
                    <div className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                      {columns.filter(c => c.key !== 'employee' && c.key !== 'actions').map(c => (
                        <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                          <input type="checkbox" checked={visible[c.key]} onChange={e => setVisible(v => ({ ...v, [c.key]: e.target.checked }))} className="rounded border-slate-300 text-indigo-600" />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className={controlClass('w-28')}>
                  {[10, 25, 50].map(size => <option key={size} value={size}>{size} rows</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[1320px] border-separate border-spacing-0">
              <thead>
                <tr>
                  {activeColumns.map(c => (
                    <Th key={c.key} align={c.align} sortable={c.sortable} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>{c.label}</Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!uploadId && <tr><td colSpan={activeColumns.length} className="px-4 py-14 text-center text-slate-400">Upload an attendance file to see the salary sheet.</td></tr>}
                {uploadId && sorted.length === 0 && <tr><td colSpan={activeColumns.length} className="px-4 py-14 text-center text-slate-400">No employees match the current filters.</td></tr>}
                {paged.map(row => (
                  <tr key={row.employeeId} className="group transition hover:bg-indigo-50/40">
                    {activeColumns.map(c => <Td key={c.key} align={c.align}>{renderCell(row, c.key)}</Td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              Showing <span className="font-bold text-slate-800">{sorted.length ? (currentPage - 1) * pageSize + 1 : 0}</span> to <span className="font-bold text-slate-800">{Math.min(currentPage * pageSize, sorted.length)}</span> of <span className="font-bold text-slate-800">{sorted.length}</span>
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 disabled:opacity-40">Previous</button>
              <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">{currentPage} / {pageCount}</span>
              <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 disabled:opacity-40">Next</button>
            </div>
          </div>
        </section>
      </div>

      {detail && uploadId && (
        <PayrollDetailModal
          uploadId={uploadId}
          employeeId={detail.employeeId}
          employeeName={detail.name}
          onClose={() => setDetail(null)}
        />
      )}

      {deleteUploadId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Delete Upload</h3>
            <p className="mt-2 text-sm text-slate-500">This permanently removes the uploaded file, attendance records, and email drafts created from it.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setDeleteUploadId(null)} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={confirmDeleteUpload} className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-bold text-white hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={clsx('fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl', toast.type === 'ok' ? 'bg-emerald-600' : 'bg-rose-600')}>
          <Icon name={toast.type === 'ok' ? 'check_circle' : 'error'} className="text-base" />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
