import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  FolderClosed,
  FolderOpen,
  LogIn,
  LogOut,
  Mail,
  Pencil,
  Phone,
  ReceiptText,
  RefreshCw,
  TimerReset,
  Umbrella,
  UserRound,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import * as api from '../../api';
import { Employee, DrawerTab, effectivePaidLeavePolicy, fmtINR } from './types';

interface LatestPayroll {
  periodMonth: string;
  detail: any;
}

interface EmployeeDocument {
  id: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  source: string;
  uploadedBy?: string | null;
  createdAt: string;
  url: string;
}

const TABS: { key: DrawerTab; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: 'Overview', icon: UserRound },
  { key: 'salary', label: 'Salary', icon: WalletCards },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck2 },
  { key: 'leave', label: 'Leave', icon: CalendarOff },
  { key: 'documents', label: 'Documents', icon: FolderClosed },
];

interface Props {
  employee: Employee;
  initialTab: DrawerTab;
  onClose: () => void;
  onEdit: () => void;
}

function ProfileAvatar({ employee }: { employee: Employee }) {
  if (employee.photoUrl) {
    return (
      <img
        src={employee.photoUrl}
        alt={employee.name}
        className="h-[84px] w-[84px] rounded-full border-4 border-white object-cover shadow-[0_6px_20px_rgba(15,23,42,0.12)]"
      />
    );
  }

  return (
    <div className="flex h-[84px] w-[84px] items-center justify-center rounded-full border-4 border-white bg-indigo-600 text-3xl font-semibold text-white shadow-[0_6px_20px_rgba(15,23,42,0.12)]">
      {(employee.name || '?').charAt(0).toUpperCase()}
    </div>
  );
}

function InfoItem({ icon: Icon, label, value, last = false }: { icon: LucideIcon; label: string; value: ReactNode; last?: boolean }) {
  return (
    <div className={clsx('flex items-start gap-3.5 px-4 py-3.5', !last && 'border-b border-slate-100')}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <Icon size={17} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 pt-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
        <p className="mt-1 break-words text-[13px] font-medium leading-5 text-slate-800">{value || '—'}</p>
      </div>
    </div>
  );
}

function Chip({ label, value, tone = 'slate' }: { label: string; value: ReactNode; tone?: 'slate' | 'emerald' | 'red' | 'amber' | 'indigo' }) {
  const tones: Record<string, string> = {
    slate: 'border-slate-200 bg-white text-slate-800',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-800',
    red: 'border-rose-100 bg-rose-50/70 text-rose-800',
    amber: 'border-amber-100 bg-amber-50/70 text-amber-800',
    indigo: 'border-indigo-100 bg-indigo-50/70 text-indigo-800',
  };
  return (
    <div className={clsx('rounded-xl border px-3.5 py-3', tones[tone])}>
      <p className="text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <Icon size={21} strokeWidth={1.7} />
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      {sub && <p className="mx-auto mt-1.5 max-w-xs text-xs leading-5 text-slate-500">{sub}</p>}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <RefreshCw size={20} className="animate-spin" />
    </div>
  );
}

function fileSizeLabel(bytes?: number) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

export default function EmployeeProfileDrawer({ employee, initialTab, onClose, onEdit }: Props) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);

  const { data: payrollSettings } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => api.getSettings().then(r => r.data as Record<string, string>),
    staleTime: 60_000,
  });
  const itPaidLeaveLimit = Math.max(0, Number(payrollSettings?.paid_leave_days || 2));
  const paidLeavePolicy = effectivePaidLeavePolicy(employee, itPaidLeaveLimit);

  const { data: payroll, isLoading } = useQuery<LatestPayroll | null>({
    queryKey: ['emp-profile-payroll', employee.id],
    queryFn: async () => {
      try {
        const { data: history } = await api.getPayrollHistory();
        const latest = (history || [])[0];
        if (!latest) return null;
        const { data } = await api.getPayrollEmployeeDetail(latest.id, employee.id);
        return { periodMonth: latest.periodMonth, detail: data };
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });

  const { data: documents = [], isLoading: documentsLoading } = useQuery<EmployeeDocument[]>({
    queryKey: ['emp-documents', employee.id],
    queryFn: () => api.getEmployeeDocuments(employee.id).then(r => r.data),
    enabled: tab === 'documents',
  });

  const { data: leaveData, isLoading: leavesLoading } = useQuery({
    queryKey: ['employee-leaves', employee.id],
    queryFn: () => api.getEmployeeLeaves(employee.id).then(r => r.data),
    enabled: tab === 'leave',
    staleTime: 30_000,
  });

  const inactive = employee.status === 'Inactive';
  const detail = payroll?.detail;
  const joining = employee.createdAt
    ? new Date(employee.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${employee.name} profile`}>
      <button className="absolute inset-0 cursor-default bg-slate-950/35 animate-fade-in" onClick={onClose} aria-label="Close employee profile" />

      <aside className="relative flex h-full w-full max-w-[450px] flex-col border-l border-slate-200 bg-[#F8FAFC] shadow-[-16px_0_50px_rgba(15,23,42,0.16)] animate-slide-in-right">
        <header className="shrink-0 border-b border-slate-200 bg-white px-6 pb-5 pt-5">
          <div className="flex items-start justify-between gap-4">
            <ProfileAvatar employee={employee} />
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] font-semibold tracking-[-0.025em] text-slate-950">{employee.name}</h2>
              <span className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
                inactive ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700',
              )}>
                <span className={clsx('h-1.5 w-1.5 rounded-full', inactive ? 'bg-slate-400' : 'bg-emerald-500')} />
                {inactive ? 'Inactive' : 'Active'}
              </span>
            </div>
            <p className="mt-1.5 text-sm font-medium text-slate-600">
              {[employee.designation, employee.department].filter(Boolean).join(' · ') || 'No role assigned'}
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <BadgeCheck size={15} className="text-slate-400" />
              <span>Employee ID</span>
              <span className="font-mono font-semibold text-slate-700">{employee.employeeNumber || '—'}</span>
            </div>
          </div>

          {employee.email && (
            <a
              href={`mailto:${employee.email}`}
              className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <Mail size={14} className="shrink-0" />
              <span className="truncate">{employee.email}</span>
            </a>
          )}
        </header>

        <nav className="shrink-0 border-b border-slate-200 bg-white px-4 py-3" aria-label="Employee profile sections">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-50 p-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={clsx(
                  'flex min-w-max flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition-all',
                  tab === key
                    ? 'bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]'
                    : 'text-slate-500 hover:bg-white hover:text-slate-700',
                )}
              >
                <Icon size={14} strokeWidth={1.9} />
                {label}
              </button>
            ))}
          </div>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {tab === 'overview' && (
            <div className="space-y-4">
              <section>
                <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Employment</h3>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <InfoItem icon={BadgeCheck} label="Employee ID" value={employee.employeeNumber || '—'} />
                  <InfoItem icon={Building2} label="Department" value={employee.department || '—'} />
                  <InfoItem icon={BriefcaseBusiness} label="Designation" value={employee.designation || '—'} last />
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Schedule & policy</h3>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <InfoItem icon={Clock3} label="Shift" value={employee.shift || '—'} />
                  <InfoItem icon={LogIn} label="Shift Start Time" value={employee.shiftStartTime || '—'} />
                  <InfoItem icon={LogOut} label="Shift End Time" value={employee.shiftEndTime || '—'} />
                  <InfoItem icon={CalendarDays} label="Member Since" value={joining} />
                  <InfoItem icon={Umbrella} label="Paid Leave Policy" value={paidLeavePolicy.eligible ? `${paidLeavePolicy.limit} days / month` : 'Not eligible'} />
                  <InfoItem icon={TimerReset} label="Overtime Eligible" value={employee.overtimeEligible ? 'Yes' : 'No'} last />
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Contact</h3>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <InfoItem icon={Mail} label="Email" value={employee.email || '—'} />
                  <InfoItem icon={Phone} label="Mobile Number" value={employee.mobile || '—'} last />
                </div>
              </section>
            </div>
          )}

          {tab === 'salary' && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Monthly salary</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">₹ {fmtINR(employee.monthlySalary)}</p>
                    <p className="mt-2 text-xs text-slate-500">Annual CTC ≈ ₹ {fmtINR((employee.monthlySalary || 0) * 12)}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><WalletCards size={19} /></div>
                </div>
              </section>
              {isLoading ? <LoadingState /> : detail ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="mb-3.5 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">Latest payroll</p>
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">{payroll?.periodMonth}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Chip label="Payable days" value={detail.payableDays ?? '—'} tone="indigo" />
                    <Chip label="Gross" value={`₹${fmtINR(detail.grossSalary)}`} tone="emerald" />
                    <Chip label="Deductions" value={`₹${fmtINR(detail.totalDeductions)}`} tone="red" />
                    <Chip label="Net" value={`₹${fmtINR(detail.netSalary)}`} tone="emerald" />
                  </div>
                </section>
              ) : <EmptyState icon={ReceiptText} title="No payroll processed yet" sub="Upload attendance on the Payroll page to generate salary details." />}
            </div>
          )}

          {tab === 'attendance' && (
            <div className="space-y-3">
              {isLoading ? <LoadingState /> : detail ? (
                <>
                  <div className="flex items-center justify-between px-0.5">
                    <p className="text-sm font-semibold text-slate-800">Attendance summary</p>
                    <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">{payroll?.periodMonth}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Chip label="Present" value={detail.presentDays ?? 0} tone="emerald" />
                    <Chip label="Absent" value={detail.absentDays ?? 0} tone="red" />
                    <Chip label="Late" value={detail.lateDays ?? 0} tone="amber" />
                    <Chip label="Missing punch" value={detail.missingPunches ?? 0} tone="amber" />
                    <Chip label="Weekly off" value={detail.weeklyOffs ?? 0} tone="slate" />
                    <Chip label="Paid leave" value={detail.paidLeave ?? 0} tone="indigo" />
                  </div>
                </>
              ) : <EmptyState icon={CalendarClock} title="No attendance data" sub="Upload an attendance file to see this employee's monthly summary." />}
            </div>
          )}

          {tab === 'leave' && (
            <div className="space-y-3">
              <section className="flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', paidLeavePolicy.eligible ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                  <Umbrella size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{paidLeavePolicy.eligible ? `Eligible — ${paidLeavePolicy.limit} paid leave days / month` : 'Not eligible for paid leaves'}</p>
                  <p className="mt-1 text-xs text-slate-500">{paidLeavePolicy.sundayIsWeeklyOff ? 'Sunday is a weekly off' : 'Sunday attendance is required; Sunday absence is unpaid'}</p>
                </div>
              </section>

              {leavesLoading ? <LoadingState /> : (
                <>
                  {leaveData?.balances.length ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      {leaveData.balances.map(balance => <Chip key={balance.id} label={`${balance.leaveType} available`} value={balance.available} tone="emerald" />)}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">No leave balance has been configured for this employee.</div>
                  )}

                  {leaveData?.requests.length ? (
                    <div className="space-y-2.5">
                      {leaveData.requests.slice(0, 8).map(request => (
                        <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{request.leaveType}</p>
                              <p className="mt-1 text-xs text-slate-500">{request.startDate} to {request.endDate} · {request.days} day{request.days === 1 ? '' : 's'}</p>
                            </div>
                            <span className={clsx(
                              'rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize',
                              request.status === 'approved' && 'bg-emerald-50 text-emerald-700',
                              request.status === 'rejected' && 'bg-rose-50 text-rose-700',
                              request.status === 'pending' && 'bg-amber-50 text-amber-700',
                            )}>{request.status}</span>
                          </div>
                          {request.approverNotes && <p className="mt-2.5 border-t border-slate-100 pt-2.5 text-xs leading-5 text-slate-500">HR: {request.approverNotes}</p>}
                        </article>
                      ))}
                    </div>
                  ) : <EmptyState icon={CalendarOff} title="No leave applications" sub="Requests submitted from Adamrit will appear here." />}

                  <a href={`/leaves?employeeId=${employee.id}`} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-700">
                    <ArrowUpRight size={16} />
                    Open leave workspace
                  </a>
                </>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <div className="space-y-3">
              {documentsLoading ? <LoadingState /> : documents.length ? (
                documents.map(document => {
                  const downloadUrl = `/api/employees/${employee.id}/documents/${document.id}/download`;
                  return (
                    <article key={document.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-indigo-200">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><FileText size={19} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{document.originalFilename}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{document.documentType} · {fileSizeLabel(document.fileSize)} · {new Date(document.createdAt).toLocaleString()}</p>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Source: {document.source === 'adamrit' ? 'Adamrit ESS' : 'HRPulse'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <a href={downloadUrl} target="_blank" rel="noreferrer" title="Open document" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"><ExternalLink size={16} /></a>
                        <a href={downloadUrl} download={document.originalFilename} title="Download document" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"><Download size={16} /></a>
                      </div>
                    </article>
                  );
                })
              ) : <EmptyState icon={FolderOpen} title="No documents uploaded" sub="Documents uploaded by the employee from Adamrit will appear here." />}
            </div>
          )}
        </div>

        <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-200 bg-white px-5 py-4">
          <button onClick={onClose} className="h-11 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
            Close
          </button>
          <button onClick={onEdit} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
            <Pencil size={15} />
            Edit profile
          </button>
        </footer>
      </aside>
    </div>
  );
}
