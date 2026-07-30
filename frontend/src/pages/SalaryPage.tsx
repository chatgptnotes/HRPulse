import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import clsx from 'clsx';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import * as api from '../api';

type SalaryStatus = 'paid' | 'pending' | 'on_hold' | 'resigned';
type SortKey = 'employeeNumber' | 'name' | 'department' | 'designation' | 'monthlySalary' | 'paidAmount' | 'paymentDate' | 'status';

interface SalaryEmployee {
  id: number;
  employeeNumber: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  shift: string;
  monthlySalary: number;
  paidAmount: number;
  paymentDate: string;
  status: SalaryStatus;
  statusLabel: string;
  deductions: number;
  absentDays: number;
  missedSwipeDays: number;
  lopDays: number;
  payableDays: number;
  bonuses: number;
  grossSalary: number;
  netSalary: number;
  holdReason: string;
  notes: string;
  markedBy: string;
}

interface SalaryPayment {
  employeeId: number;
  periodMonth: string;
  status: SalaryStatus;
  paidAmount: number;
  paymentDate: string;
  holdReason: string;
  notes: string;
  markedBy: string;
}

const STATUS_META: Record<SalaryStatus, { label: string; icon: string; color: string; chip: string; bar: string }> = {
  paid: {
    label: 'Paid',
    icon: 'check_circle',
    color: 'from-emerald-500 to-teal-500',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    bar: 'bg-emerald-500',
  },
  pending: {
    label: 'Pending',
    icon: 'pending_actions',
    color: 'from-amber-500 to-orange-500',
    chip: 'bg-amber-50 text-amber-700 ring-amber-100',
    bar: 'bg-amber-500',
  },
  on_hold: {
    label: 'On Hold',
    icon: 'pause_circle',
    color: 'from-rose-500 to-red-500',
    chip: 'bg-rose-50 text-rose-700 ring-rose-100',
    bar: 'bg-rose-500',
  },
  resigned: {
    label: 'Resigned',
    icon: 'person_off',
    color: 'from-violet-500 to-purple-600',
    chip: 'bg-purple-50 text-purple-700 ring-purple-100',
    bar: 'bg-purple-500',
  },
};

const tabs: SalaryStatus[] = ['paid', 'pending', 'on_hold', 'resigned'];
const monthOptions = [
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
const yearOptions = Array.from({ length: new Date().getFullYear() - 2000 + 6 }, (_, index) => String(2000 + index)).reverse();

const fmtINR = (n: number | null | undefined) =>
  n == null || isNaN(n) ? '-' : n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const pct = (part = 0, total = 0) => (total ? Math.round((part / total) * 100) : 0);

function Icon({ name, className = 'text-base' }: { name: string; className?: string }) {
  return <span className={clsx('material-icons leading-none', className)}>{name}</span>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'HR';
}

function controlClass(extra = '') {
  return clsx(
    'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100',
    extra,
  );
}

function MonthYearSelect({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [year = String(new Date().getFullYear()), selectedMonth = '01'] = value.split('-');
  const update = (nextYear: string, nextMonth: string) => onChange(`${nextYear}-${nextMonth}`);
  const selectedLabel = monthOptions.find(option => option.value === selectedMonth)?.label || selectedMonth;

  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-white px-3 py-2 transition hover:border-slate-300 focus-within:border-purple-300 focus-within:ring-4 focus-within:ring-purple-100', compact ? 'min-w-[250px]' : 'w-full')}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <Icon name="calendar_month" className="text-sm text-purple-500" />
        Payroll Period
      </div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <select value={selectedMonth} onChange={e => update(year, e.target.value)} className="h-6 min-w-[78px] appearance-none bg-transparent pr-5 text-sm font-bold text-slate-900 outline-none">
            {monthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <Icon name="keyboard_arrow_down" className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-base text-slate-900" />
        </div>
        <div className="relative">
          <select value={year} onChange={e => update(e.target.value, selectedMonth)} aria-label={`${selectedLabel} year`} className="h-6 w-[74px] appearance-none bg-transparent pr-5 text-sm font-bold text-slate-900 outline-none">
            {yearOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <Icon name="keyboard_arrow_down" className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-base text-slate-900" />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  status,
  amount,
  count,
  percent,
  selected,
  onClick,
}: {
  status: SalaryStatus;
  amount: number;
  count: number;
  percent: number;
  selected: boolean;
  onClick: () => void;
}) {
  const meta = STATUS_META[status];
  const iconTone: Record<SalaryStatus, string> = {
    paid: 'border-emerald-100 bg-emerald-50 text-emerald-600',
    pending: 'border-amber-100 bg-amber-50 text-amber-600',
    on_hold: 'border-rose-100 bg-rose-50 text-rose-600',
    resigned: 'border-purple-100 bg-purple-50 text-purple-600',
  };
  const selectedTone: Record<SalaryStatus, string> = {
    paid: 'border-emerald-400 shadow-emerald-100/80 ring-2 ring-emerald-100',
    pending: 'border-amber-400 shadow-amber-100/80 ring-2 ring-amber-100',
    on_hold: 'border-rose-400 shadow-rose-100/80 ring-2 ring-rose-100',
    resigned: 'border-purple-400 shadow-purple-100/80 ring-2 ring-purple-100',
  };
  const safePercent = Math.max(0, Math.min(100, percent));
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md',
        selected ? selectedTone[status] : 'border-slate-200/80 shadow-slate-200/60',
      )}
    >
      <div className="flex min-h-[66px] items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{meta.label}</p>
          <p className="mt-2 truncate text-xl font-black leading-6 text-slate-950">INR {fmtINR(amount)}</p>
          <p className="mt-1 text-xs text-slate-500">{count} employee{count === 1 ? '' : 's'} &bull; {safePercent}% of payroll</p>
        </div>
        <div className={clsx('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border shadow-sm transition group-hover:shadow', iconTone[status])}>
          <Icon name={meta.icon} className="text-lg" />
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
        <div className={clsx('h-full rounded-full transition-all group-hover:brightness-95', meta.bar)} style={{ width: `${Math.max(4, safePercent)}%` }} />
      </div>
    </button>
  );
}

function Gauge({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      className="flex h-36 w-36 flex-shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(#6366f1 ${clamped * 3.6}deg, #e2e8f0 0deg)` }}
    >
      <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white shadow-inner">
        <p className="text-2xl font-bold text-slate-950">{clamped}%</p>
        <p className="text-xs font-semibold text-slate-400">paid</p>
      </div>
    </div>
  );
}

function BudgetItem({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={clsx('mt-2 text-xl font-bold', tone)}>{value}</p>
    </div>
  );
}

function DrawerRow({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'strong' | 'red' | 'green' }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={clsx('text-right text-sm', tone === 'strong' && 'font-bold text-slate-900', tone === 'red' && 'font-bold text-rose-600', tone === 'green' && 'font-bold text-emerald-700', tone === 'default' && 'font-semibold text-slate-700')}>
        {value}
      </span>
    </div>
  );
}

function DrawerSection({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Icon name={icon} className="text-base" />
        </div>
        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SalaryDrawer({ employee, onClose }: { employee: SalaryEmployee; onClose: () => void }) {
  const meta = STATUS_META[employee.status];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-sm">
      <button aria-label="Close salary details" onClick={onClose} className="hidden flex-1 cursor-default md:block" />
      <aside className="animate-slide-in-right flex h-full w-full max-w-3xl flex-col bg-slate-50 shadow-2xl">
        <header className="border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-lg font-bold text-white shadow-lg shadow-indigo-200">
                {initials(employee.name)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Salary details</p>
                <h2 className="truncate text-xl font-bold text-slate-950">{employee.name}</h2>
                <p className="truncate text-sm text-slate-500">{employee.employeeNumber} - {employee.department} - {employee.designation}</p>
              </div>
            </div>
            <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900">
              <Icon name="close" className="text-xl" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-900 p-5 text-white shadow-xl shadow-indigo-200">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Monthly Salary</p>
                <p className="mt-1 text-2xl font-bold">INR {fmtINR(employee.monthlySalary)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Net Salary</p>
                <p className="mt-1 text-2xl font-bold text-emerald-300">INR {fmtINR(employee.netSalary)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Payment Status</p>
                <span className="mt-2 inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-bold text-white ring-1 ring-white/20">{meta.label}</span>
              </div>
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <DrawerSection title="Employee Profile" icon="badge">
              <DrawerRow label="Employee ID" value={employee.employeeNumber} />
              <DrawerRow label="Department" value={employee.department || '-'} />
              <DrawerRow label="Designation" value={employee.designation || '-'} />
              <DrawerRow label="Shift" value={employee.shift || '-'} />
            </DrawerSection>

            <DrawerSection title="Payment History" icon="history">
              <DrawerRow label="Current Status" value={employee.statusLabel} />
              <DrawerRow label="Payment Date" value={employee.paymentDate} />
              <DrawerRow label="Paid Amount" value={`INR ${fmtINR(employee.paidAmount)}`} tone="green" />
              {employee.holdReason && <DrawerRow label="Hold Reason" value={employee.holdReason} tone="red" />}
              {employee.notes && <DrawerRow label="Notes" value={employee.notes} />}
              {employee.markedBy && <DrawerRow label="Marked By" value={employee.markedBy} />}
            </DrawerSection>
          </div>

          <DrawerSection title="Attendance Summary" icon="event_available">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-400">Payable Days</p><p className="mt-1 text-lg font-bold text-slate-900">{employee.payableDays}</p></div>
              <div className="rounded-2xl bg-rose-50 p-3"><p className="text-xs font-semibold text-rose-500">Absent Days</p><p className="mt-1 text-lg font-bold text-rose-700">{employee.absentDays}</p></div>
              <div className="rounded-2xl bg-orange-50 p-3"><p className="text-xs font-semibold text-orange-500">Missed Swipes</p><p className="mt-1 text-lg font-bold text-orange-700">{employee.missedSwipeDays}</p></div>
              <div className="rounded-2xl bg-indigo-50 p-3"><p className="text-xs font-semibold text-indigo-500">Bonuses</p><p className="mt-1 text-lg font-bold text-indigo-700">INR {fmtINR(employee.bonuses)}</p></div>
            </div>
          </DrawerSection>

          <div className="grid gap-4 md:grid-cols-2">
            <DrawerSection title="Earnings" icon="add_card">
              <DrawerRow label="Monthly Salary" value={`INR ${fmtINR(employee.monthlySalary)}`} />
              <DrawerRow label="Bonuses" value={`INR ${fmtINR(employee.bonuses)}`} tone="green" />
              <DrawerRow label="Gross Salary" value={`INR ${fmtINR(employee.grossSalary)}`} tone="strong" />
            </DrawerSection>

            <DrawerSection title="Deductions" icon="remove_circle">
              <DrawerRow label="PF" value="INR 0" />
              <DrawerRow label="ESI" value="INR 0" />
              <DrawerRow label="Loans" value="INR 0" />
              <DrawerRow label="Advances" value="INR 0" />
              <DrawerRow label="LOP Deduction" value={`INR ${fmtINR(employee.deductions)}`} tone="red" />
            </DrawerSection>
          </div>

          <DrawerSection title="Salary Calculation Breakdown" icon="functions">
            <DrawerRow label="Gross Salary" value={`INR ${fmtINR(employee.grossSalary)}`} />
            <DrawerRow label="Payable Days" value={`${employee.payableDays} days`} />
            <DrawerRow label="LOP Days" value={`${employee.lopDays.toFixed(1)} days`} />
            <DrawerRow label="Total Deductions" value={`INR ${fmtINR(employee.deductions)}`} tone="red" />
            <DrawerRow label="Net Salary" value={`INR ${fmtINR(employee.netSalary)}`} tone="green" />
          </DrawerSection>
        </div>
      </aside>
    </div>
  );
}

function PayslipPreviewModal({
  employee,
  month,
  onClose,
  onDownload,
}: {
  employee: SalaryEmployee;
  month: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const meta = STATUS_META[employee.status];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Payslip Preview</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{employee.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{employee.employeeNumber} - {month}</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50">
            <Icon name="close" className="text-xl" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 md:flex-row md:items-start md:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-lg font-bold text-white shadow-lg shadow-indigo-100">
                  {initials(employee.name)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-950">{employee.name}</h3>
                  <p className="text-sm text-slate-500">{employee.department} - {employee.designation}</p>
                  <p className="text-xs text-slate-400">Shift: {employee.shift || '-'}</p>
                </div>
              </div>
              <span className={clsx('inline-flex rounded-full px-3 py-1 text-sm font-bold ring-1', meta.chip)}>{meta.label}</span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <BudgetItem label="Monthly Salary" value={`INR ${fmtINR(employee.monthlySalary)}`} tone="text-slate-950" />
              <BudgetItem label="Gross Salary" value={`INR ${fmtINR(employee.grossSalary)}`} tone="text-indigo-700" />
              <BudgetItem label="Net Salary" value={`INR ${fmtINR(employee.netSalary)}`} tone="text-emerald-700" />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <DrawerSection title="Earnings" icon="add_card">
                <DrawerRow label="Monthly Salary" value={`INR ${fmtINR(employee.monthlySalary)}`} />
                <DrawerRow label="Bonuses" value={`INR ${fmtINR(employee.bonuses)}`} tone="green" />
                <DrawerRow label="Gross Salary" value={`INR ${fmtINR(employee.grossSalary)}`} tone="strong" />
              </DrawerSection>
              <DrawerSection title="Deductions" icon="remove_circle">
                <DrawerRow label="LOP Days" value={`${employee.lopDays.toFixed(1)} days`} />
                <DrawerRow label="LOP Deduction" value={`INR ${fmtINR(employee.deductions)}`} tone="red" />
                <DrawerRow label="Net Payable" value={`INR ${fmtINR(employee.netSalary)}`} tone="green" />
              </DrawerSection>
            </div>

            <div className="mt-5 rounded-2xl bg-slate-50 p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <DrawerRow label="Payable Days" value={`${employee.payableDays}`} />
                <DrawerRow label="Paid Amount" value={`INR ${fmtINR(employee.paidAmount)}`} tone="green" />
                <DrawerRow label="Payment Date" value={employee.paymentDate} />
                <DrawerRow label="Status" value={employee.statusLabel} />
              </div>
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50">Close</button>
          <button onClick={onDownload} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-100 transition hover:from-indigo-700 hover:to-purple-700">
            <Icon name="download" className="text-base" />
            Download PDF
          </button>
        </footer>
      </div>
    </div>
  );
}

function ActionMenu({
  row,
  onView,
  onGeneratePayslip,
  onDownloadPdf,
  onPending,
  onMarkPaid,
  onHold,
  onResigned,
}: {
  row: SalaryEmployee;
  onView: () => void;
  onGeneratePayslip: () => void;
  onDownloadPdf: () => void;
  onPending: () => void;
  onMarkPaid: () => void;
  onHold: () => void;
  onResigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const itemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50';

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const menuWidth = 192;
    const menuHeight = 310;
    const gap = 8;
    const rect = buttonRef.current.getBoundingClientRect();
    const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, rect.right - menuWidth));
    const opensDown = rect.bottom + gap + menuHeight <= window.innerHeight - 12;
    const top = opensDown ? rect.bottom + gap : Math.max(12, rect.top - menuHeight - gap);
    setMenuPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <div className="relative">
      <button ref={buttonRef} onClick={() => setOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50">
        <Icon name="more_vert" className="text-lg" />
      </button>
      {open && menuPos && (
        <div
          className="fixed z-[80] w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-2 shadow-2xl shadow-slate-300/70"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button onClick={() => { onView(); setOpen(false); }} className={clsx(itemClass, 'hover:bg-indigo-50 hover:text-indigo-700')}><Icon name="visibility" />View Details</button>
          <button onClick={() => { onGeneratePayslip(); setOpen(false); }} className={itemClass}><Icon name="receipt_long" />Generate Payslip</button>
          <button onClick={() => { onDownloadPdf(); setOpen(false); }} className={itemClass}><Icon name="download" />Download PDF</button>
          <button onClick={() => { onMarkPaid(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50"><Icon name="check_circle" />Mark as Paid</button>
          <button onClick={() => { onHold(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"><Icon name="pause_circle" />Hold Payment</button>
          <button onClick={() => { onPending(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50"><Icon name="pending_actions" />Mark Pending</button>
          <button onClick={() => { onResigned(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-purple-700 hover:bg-purple-50"><Icon name="person_off" />Mark Resigned</button>
        </div>
      )}
    </div>
  );
}

export default function SalaryPage() {
  const qc = useQueryClient();
  const currentMonth = format(new Date(), 'yyyy-MM');
  const [month, setMonth] = useState(currentMonth);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<SalaryStatus>('pending');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [deptFilter, setDeptFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('paidAmount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detail, setDetail] = useState<SalaryEmployee | null>(null);
  const [payslipPreview, setPayslipPreview] = useState<SalaryEmployee | null>(null);

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => api.getEmployees().then(r => r.data as any[]) });
  const { data: payments = [] } = useQuery({
    queryKey: ['salary-payments', month],
    queryFn: () => api.getSalaryPayments(month).then(r => r.data as SalaryPayment[]),
  });
  const { data: uploads = [] } = useQuery({ queryKey: ['uploads'], queryFn: () => api.getUploads().then(r => r.data as any[]) });
  const latestUpload = (uploads as any[])[0];
  const { data: deductions = [] } = useQuery({
    queryKey: ['deductions', latestUpload?.id],
    queryFn: () => api.getSalaryDeductions(latestUpload!.id).then(r => r.data as any[]),
    enabled: !!latestUpload,
  });

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const paymentMutation = useMutation({
    mutationFn: (payload: {
      employeeId: number;
      status: SalaryStatus;
      paidAmount?: number;
      paymentDate?: string;
      holdReason?: string;
      notes?: string;
    }) => api.saveSalaryPayment(payload.employeeId, {
      periodMonth: month,
      status: payload.status,
      paidAmount: payload.paidAmount,
      paymentDate: payload.paymentDate,
      holdReason: payload.holdReason,
      notes: payload.notes,
      markedBy: 'HR',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-payments', month] });
      showToast('Salary status saved');
    },
    onError: (err: any) => showToast(err?.response?.data?.error || 'Failed to save salary status', 'err'),
  });

  const salaryRows: SalaryEmployee[] = useMemo(() => {
    const getDeduction = (empId: number) => (deductions as any[]).find(d => d.employeeId === empId);
    const paymentMap = new Map((payments as SalaryPayment[]).map(payment => [payment.employeeId, payment]));
    const source = employees.length > 0
      ? employees
      : (deductions as any[]).map((d: any) => ({ id: d.employeeId, name: d.employeeName, employeeNumber: '', department: '', designation: '', shift: '', status: 'Active' }));

    return source.map((emp: any) => {
      const ded = getDeduction(emp.id);
      const payment = paymentMap.get(emp.id);
      const salary = Number(emp.monthlySalary || emp.monthly_salary || 0);
      const deductionsAmount = Number(ded?.lopAmount || 0);
      const grossSalary = salary;
      const netSalary = Math.max(0, grossSalary - deductionsAmount);
      const status = payment?.status || 'pending';
      const paidAmount = status === 'paid' ? Number(payment?.paidAmount || netSalary) : Number(payment?.paidAmount || 0);
      const payableDays = Math.max(0, Math.round(((ded?.workingDays || 30) - (ded?.lopDays || 0)) * 10) / 10);

      return {
        id: emp.id,
        employeeNumber: emp.employeeNumber || emp.employee_number || `EMP-${emp.id}`,
        name: emp.name || emp.employeeName || 'Employee',
        email: emp.email || '',
        department: emp.department || 'Unassigned',
        designation: emp.designation || '-',
        shift: emp.shift || '-',
        monthlySalary: salary,
        paidAmount,
        paymentDate: payment?.paymentDate || '-',
        status,
        statusLabel: STATUS_META[status].label,
        deductions: deductionsAmount,
        absentDays: Number(ded?.absentDays || 0),
        missedSwipeDays: Number(ded?.missedSwipeDays || 0),
        lopDays: Number(ded?.lopDays || 0),
        payableDays,
        bonuses: 0,
        grossSalary,
        netSalary,
        holdReason: payment?.holdReason || '',
        notes: payment?.notes || '',
        markedBy: payment?.markedBy || '',
      };
    });
  }, [employees, deductions, payments]);

  const summary = useMemo(() => {
    const totalPayroll = salaryRows.reduce((sum, row) => sum + row.netSalary, 0);
    const byStatus = tabs.reduce((acc, status) => {
      const rows = salaryRows.filter(row => row.status === status);
      const amount = rows.reduce((sum, row) => sum + (status === 'paid' ? row.paidAmount : row.netSalary), 0);
      acc[status] = { count: rows.length, amount, percent: pct(amount, totalPayroll) };
      return acc;
    }, {} as Record<SalaryStatus, { count: number; amount: number; percent: number }>);

    return {
      totalPayroll,
      totalPaid: byStatus.paid.amount,
      remaining: Math.max(0, totalPayroll - byStatus.paid.amount),
      paidPercent: pct(byStatus.paid.amount, totalPayroll),
      byStatus,
    };
  }, [salaryRows]);

  const departments = useMemo(() => [...new Set(salaryRows.map(row => row.department).filter(Boolean))].sort(), [salaryRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return salaryRows.filter(row => {
      if (row.status !== selectedStatus) return false;
      if (deptFilter && row.department !== deptFilter) return false;
      if (q && !`${row.employeeNumber} ${row.name} ${row.department} ${row.designation}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [salaryRows, selectedStatus, deptFilter, search]);

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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  const saveStatus = (row: SalaryEmployee, status: SalaryStatus) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const holdReason = status === 'on_hold'
      ? window.prompt('Reason for holding salary?', row.holdReason || 'Attendance / payroll review pending') || ''
      : '';

    paymentMutation.mutate({
      employeeId: row.id,
      status,
      paidAmount: status === 'paid' ? row.netSalary : 0,
      paymentDate: status === 'paid' ? today : '',
      holdReason,
    });
  };

  const exportCsv = () => {
    const rows = sorted.map((row, index) => ({
      'S.No': index + 1,
      'Employee ID': row.employeeNumber || '',
      'Employee Name': row.name || '',
      Department: row.department || '',
      Designation: row.designation || '',
      Shift: row.shift || '',
      'Monthly Salary': row.monthlySalary || 0,
      'Payable Days': row.payableDays || 0,
      'Gross Salary': row.grossSalary || 0,
      Deductions: row.deductions || 0,
      'Net Salary': row.netSalary || 0,
      'Paid Amount': row.paidAmount || 0,
      'Payment Date': row.paymentDate || '',
      'Salary Status': row.statusLabel || '',
      'Hold Reason': row.holdReason || '',
      Notes: row.notes || '',
      'Marked By': row.markedBy || '',
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [
      { wch: 8 },
      { wch: 14 },
      { wch: 24 },
      { wch: 18 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 28 },
      { wch: 28 },
      { wch: 16 },
    ];
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 };

    ['G', 'I', 'J', 'K', 'L'].forEach(col => {
      for (let row = 2; row <= sorted.length + 1; row += 1) {
        const cell = sheet[`${col}${row}`];
        if (cell) {
          cell.t = 'n';
          cell.z = '₹ #,##0';
        }
      }
    });

    const workbook = XLSX.utils.book_new();
    workbook.Props = {
      Title: 'HRPulse Salary Dashboard',
      Subject: `Salary export for ${month}`,
      Author: 'HRPulse',
      CreatedDate: new Date(),
    };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Salary Dashboard');
    XLSX.writeFile(workbook, `salary-dashboard-${month}-${selectedStatus}.xlsx`, { compression: true });
  };

  const downloadSalaryPdf = (row: SalaryEmployee) => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;

    const money = (n: number) => `INR ${fmtINR(n)}`;
    const line = (x1: number, y1: number, x2: number, y2: number, color: [number, number, number] = [226, 232, 240]) => {
      doc.setDrawColor(...color);
      doc.line(x1, y1, x2, y2);
    };
    const labelValue = (label: string, value: string, x: number, y: number, width = 220) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(label, x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      doc.text(value || '-', x + width, y, { align: 'right' });
    };
    const drawTable = (title: string, rows: Array<[string, string]>, x: number, y: number, width: number, accent: [number, number, number]) => {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, width, 34 + rows.length * 30, 10, 10, 'F');
      doc.setFillColor(...accent);
      doc.roundedRect(x, y, width, 34, 10, 10, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text(title, x + 14, y + 22);
      rows.forEach(([label, value], index) => {
        const rowY = y + 56 + index * 30;
        if (index > 0) line(x + 12, rowY - 18, x + width - 12, rowY - 18);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(label, x + 14, rowY);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(value, x + width - 14, rowY, { align: 'right' });
      });
    };

    doc.setFillColor(30, 27, 75);
    doc.rect(0, 0, pageWidth, 118, 'F');
    doc.setFillColor(99, 102, 241);
    doc.circle(margin + 18, 42, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text('HR', margin + 18, 46, { align: 'center' });
    doc.setFontSize(24);
    doc.text('Salary Payslip', margin + 48, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(199, 210, 254);
    doc.text(`Generated by HRPulse - ${new Date().toLocaleString()}`, margin + 48, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text(month, pageWidth - margin, 42, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(199, 210, 254);
    doc.text('Payroll Month', pageWidth - margin, 58, { align: 'right' });

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 88, contentWidth, 104, 14, 14, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, 88, contentWidth, 104, 14, 14, 'S');
    doc.setFillColor(124, 58, 237);
    doc.circle(margin + 36, 126, 24, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(initials(row.name), margin + 36, 131, { align: 'center' });
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(row.name, margin + 74, 118);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`${row.employeeNumber} | ${row.department || '-'} | ${row.designation || '-'}`, margin + 74, 136);
    doc.text(`Shift: ${row.shift || '-'} | Email: ${row.email || '-'}`, margin + 74, 154);

    const statusColor: Record<SalaryStatus, [number, number, number]> = {
      paid: [5, 150, 105],
      pending: [217, 119, 6],
      on_hold: [225, 29, 72],
      resigned: [124, 58, 237],
    };
    const badgeColor = statusColor[row.status];
    doc.setFillColor(...badgeColor);
    doc.roundedRect(pageWidth - margin - 128, 112, 128, 28, 14, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(row.statusLabel, pageWidth - margin - 64, 130, { align: 'center' });

    const topY = 220;
    const cardGap = 14;
    const cardW = (contentWidth - cardGap * 2) / 3;
    const summaryCards: Array<[string, string, [number, number, number]]> = [
      ['Monthly Salary', money(row.monthlySalary), [79, 70, 229] as [number, number, number]],
      ['Gross Salary', money(row.grossSalary), [14, 116, 144] as [number, number, number]],
      ['Net Payable', money(row.netSalary), [5, 150, 105] as [number, number, number]],
    ];
    summaryCards.forEach(([label, value, color], index) => {
      const x = margin + index * (cardW + cardGap);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, topY, cardW, 78, 12, 12, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, topY, cardW, 78, 12, 12, 'S');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(String(label), x + 14, topY + 24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(...color);
      doc.text(String(value), x + 14, topY + 52);
    });

    drawTable('Earnings', [
      ['Monthly Salary', money(row.monthlySalary)],
      ['Bonuses', money(row.bonuses)],
      ['Gross Salary', money(row.grossSalary)],
    ], margin, 326, (contentWidth - 16) / 2, [79, 70, 229]);

    drawTable('Deductions', [
      ['LOP Days', `${row.lopDays.toFixed(1)} days`],
      ['LOP / Attendance Deduction', money(row.deductions)],
      ['Total Deductions', money(row.deductions)],
    ], margin + (contentWidth + 16) / 2, 326, (contentWidth - 16) / 2, [225, 29, 72]);

    doc.setFillColor(240, 253, 244);
    doc.roundedRect(margin, 470, contentWidth, 76, 14, 14, 'F');
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(margin, 470, contentWidth, 76, 14, 14, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(22, 101, 52);
    doc.text('Final Net Salary', margin + 18, 498);
    doc.setFontSize(22);
    doc.text(money(row.netSalary), pageWidth - margin - 18, 503, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Payable days: ${row.payableDays} | Paid amount: ${money(row.paidAmount)} | Payment date: ${row.paymentDate || '-'}`, margin + 18, 524);

    const detailY = 585;
    labelValue('Payment Status', row.statusLabel, margin, detailY, 170);
    labelValue('Absent Days', String(row.absentDays), margin + 285, detailY, 170);
    labelValue('Missed Swipes', String(row.missedSwipeDays), margin, detailY + 24, 170);
    labelValue('Marked By', row.markedBy || '-', margin + 285, detailY + 24, 170);
    if (row.holdReason) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(225, 29, 72);
      doc.text('Hold Reason', margin, detailY + 62);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(doc.splitTextToSize(row.holdReason, contentWidth), margin, detailY + 80);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    line(margin, pageHeight - 52, pageWidth - margin, pageHeight - 52);
    doc.text('This is a system generated payslip from HRPulse.', margin, pageHeight - 32);
    doc.text('HRPulse Payroll', pageWidth - margin, pageHeight - 32, { align: 'right' });

    const safe = (row.name || 'employee').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'employee';
    doc.save(`payslip-${safe}-${month}.pdf`);
  };

  const tableHeaders: Array<{ key: SortKey | 'action'; label: string; align?: 'left' | 'right' }> = [
    { key: 'employeeNumber', label: 'Employee ID' },
    { key: 'name', label: 'Employee Name' },
    { key: 'department', label: 'Department' },
    { key: 'designation', label: 'Designation' },
    { key: 'monthlySalary', label: 'Monthly Salary', align: 'right' },
    { key: 'paidAmount', label: 'Paid Amount', align: 'right' },
    { key: 'paymentDate', label: 'Payment Date' },
    { key: 'status', label: 'Salary Status' },
    { key: 'action', label: 'Actions', align: 'right' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm md:px-7 md:py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-950">Salary Dashboard</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">Track salary payments and payroll status in one place.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <MonthYearSelect value={month} onChange={setMonth} compact />
              <button onClick={exportCsv} className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm">
                <Icon name="download" className="text-base" />
                Export
              </button>
              <button onClick={() => showToast('Salary uses Employee salary; payment status is saved month-wise from Actions')} className="inline-flex h-12 items-center gap-2 rounded-xl bg-purple-600 px-5 text-sm font-bold text-white shadow-sm shadow-purple-200 transition hover:-translate-y-0.5 hover:bg-purple-700 hover:shadow-md">
                <Icon name="credit_card" className="text-base" />
                Process Salary
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tabs.map(status => (
            <SummaryCard
              key={status}
              status={status}
              amount={summary.byStatus[status].amount}
              count={summary.byStatus[status].count}
              percent={summary.byStatus[status].percent}
              selected={selectedStatus === status}
              onClick={() => { setSelectedStatus(status); setPage(1); }}
            />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950">Salary Budget Summary</h2>
              <p className="mt-1 text-sm text-slate-500">Simple company-wide payment status for the selected month.</p>
            </div>
            <Gauge percent={summary.paidPercent} />
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <BudgetItem label="Total Salary Budget" value={`INR ${fmtINR(summary.totalPayroll)}`} tone="text-slate-950" />
              <BudgetItem label="Total Salary Paid" value={`INR ${fmtINR(summary.totalPaid)}`} tone="text-emerald-700" />
              <BudgetItem label="Remaining Salary Amount" value={`INR ${fmtINR(summary.remaining)}`} tone="text-amber-700" />
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {tabs.map(status => (
                  <button
                    key={status}
                    onClick={() => { setSelectedStatus(status); setPage(1); }}
                    className={clsx('inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ring-1 transition', selectedStatus === status ? `${STATUS_META[status].chip} shadow-sm` : 'bg-slate-50 text-slate-500 ring-slate-100 hover:bg-slate-100')}
                  >
                    {STATUS_META[status].label}
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs">{summary.byStatus[status].count}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-slate-400" />
                  <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search employee" className={controlClass('w-60 pl-9')} />
                </div>
                <button onClick={() => setShowFilters(v => !v)} className={clsx('inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition', showFilters ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
                  <Icon name="filter_alt" className="text-base" />
                  Filter
                </button>
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className={controlClass('w-28')}>
                  {[10, 25, 50].map(size => <option key={size} value={size}>{size} rows</option>)}
                </select>
              </div>
            </div>

            {showFilters && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Department</span>
                  <select value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setPage(1); }} className={controlClass('w-full')}>
                    <option value="">All departments</option>
                    {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Month</span>
                  <MonthYearSelect value={month} onChange={setMonth} />
                </label>
                <div className="flex items-end">
                  <button onClick={() => { setDeptFilter(''); setSearch(''); }} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50">
                    Clear Filters
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[1120px] border-separate border-spacing-0">
              <thead>
                <tr>
                  {tableHeaders.map(head => (
                    <th key={head.key} className={clsx('sticky top-0 z-10 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500', head.align === 'right' ? 'text-right' : 'text-left')}>
                      {head.key === 'action' ? (
                        <span>Actions</span>
                      ) : (
                        <button onClick={() => handleSort(head.key as SortKey)} className={clsx('inline-flex items-center gap-1 whitespace-nowrap', head.align === 'right' && 'justify-end')}>
                          {head.label}
                          <Icon name={sortKey === head.key && sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'} className={clsx('text-sm', sortKey === head.key ? 'text-indigo-600' : 'text-slate-300')} />
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged.length === 0 && (
                  <tr><td colSpan={tableHeaders.length} className="px-4 py-14 text-center text-slate-400">No employees match the selected salary status.</td></tr>
                )}
                {paged.map(row => (
                    <tr key={row.id} className="group transition hover:bg-indigo-50/40">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.employeeNumber}</td>
                      <td className="px-4 py-3">
                        <div className="flex min-w-56 items-center gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-bold text-white shadow-md shadow-indigo-100">{initials(row.name)}</div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{row.name}</p>
                            <p className="truncate text-xs text-slate-400">{row.email || row.designation}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{row.department}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{row.designation}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">
                        INR {fmtINR(row.monthlySalary)}
                        <p className="mt-0.5 text-[11px] font-medium text-slate-400">From Employee section</p>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-emerald-700">INR {fmtINR(row.paidAmount)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{row.paymentDate}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1', STATUS_META[row.status].chip)}>{row.statusLabel}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <ActionMenu
                            row={row}
                            onView={() => setDetail(row)}
                            onGeneratePayslip={() => setPayslipPreview(row)}
                            onDownloadPdf={() => downloadSalaryPdf(row)}
                            onPending={() => saveStatus(row, 'pending')}
                            onMarkPaid={() => saveStatus(row, 'paid')}
                            onHold={() => saveStatus(row, 'on_hold')}
                            onResigned={() => saveStatus(row, 'resigned')}
                          />
                        </div>
                      </td>
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

      {detail && <SalaryDrawer employee={detail} onClose={() => setDetail(null)} />}
      {payslipPreview && (
        <PayslipPreviewModal
          employee={payslipPreview}
          month={month}
          onClose={() => setPayslipPreview(null)}
          onDownload={() => downloadSalaryPdf(payslipPreview)}
        />
      )}

      {toast && (
        <div className={clsx('fixed bottom-6 right-6 z-50 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl', toast.type === 'ok' ? 'bg-emerald-600' : 'bg-rose-600')}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
