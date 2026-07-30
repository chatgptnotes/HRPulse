import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import * as api from '../../api';
import EmployeeAvatar from './EmployeeAvatar';
import { Employee, DrawerTab, fmtINR } from './types';

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

const TABS: { key: DrawerTab; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'person' },
  { key: 'salary', label: 'Salary', icon: 'payments' },
  { key: 'attendance', label: 'Attendance', icon: 'event_available' },
  { key: 'leave', label: 'Leave', icon: 'event_busy' },
  { key: 'documents', label: 'Documents', icon: 'folder' },
];

interface Props {
  employee: Employee;
  initialTab: DrawerTab;
  onClose: () => void;
  onEdit: () => void;
}

function InfoItem({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
        <span className="material-icons text-slate-400 text-base">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-800 font-medium truncate">{value || '—'}</p>
      </div>
    </div>
  );
}

function Chip({ label, value, tone = 'slate' }: { label: string; value: React.ReactNode; tone?: 'slate' | 'emerald' | 'red' | 'amber' | 'indigo' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  };
  return (
    <div className={clsx('rounded-xl px-3 py-2.5', tones[tone])}>
      <p className="text-lg font-bold leading-none">{value}</p>
      <p className="text-[11px] mt-1 opacity-80">{label}</p>
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="text-center py-10 px-4">
      <span className="material-icons text-5xl text-slate-200 block mb-2">{icon}</span>
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      {sub && <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">{sub}</p>}
    </div>
  );
}

function fileSizeLabel(bytes?: number) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

// Modern right-hand profile drawer. Attendance + salary sections reuse the
// existing payroll endpoints (latest run + per-employee detail) — no backend
// changes required.
export default function EmployeeProfileDrawer({ employee, initialTab, onClose, onEdit }: Props) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);

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
  const joining = employee.createdAt ? new Date(employee.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <aside className="relative w-full max-w-md h-full bg-slate-50 shadow-2xl flex flex-col animate-slide-in-right">
        {/* Banner */}
        <div className="h-28 bg-gradient-to-r from-indigo-600 to-purple-600 relative flex-shrink-0">
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
            <span className="material-icons text-lg">close</span>
          </button>
        </div>

        <div className="px-6 -mt-10 relative">
          <EmployeeAvatar name={employee.name} photoUrl={employee.photoUrl} size={80} ring />
        </div>

        {/* Name + status */}
        <div className="px-6 pt-3 pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-slate-800">{employee.name}</h2>
            <span className={clsx('text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1',
              inactive ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700')}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', inactive ? 'bg-slate-400' : 'bg-emerald-500')} />
              {inactive ? 'Inactive' : 'Active'}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {[employee.designation, employee.department].filter(Boolean).join(' · ') || 'No role assigned'}
          </p>
          <p className="text-xs text-slate-400 mt-1 font-mono">EMP ID: {employee.employeeNumber || '—'}</p>
        </div>

        {/* Quick contact */}
        <div className="px-6 pb-3 flex gap-2 flex-wrap">
          {employee.email && (
            <a href={`mailto:${employee.email}`} className="inline-flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-full px-3 py-1 text-slate-600 hover:bg-slate-50">
              <span className="material-icons text-sm text-slate-400">mail</span>{employee.email}
            </a>
          )}
          {employee.mobile && (
            <a href={`tel:${employee.mobile}`} className="inline-flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-full px-3 py-1 text-slate-600 hover:bg-slate-50">
              <span className="material-icons text-sm text-slate-400">call</span>{employee.mobile}
            </a>
          )}
        </div>

        {/* Tabs */}
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-200 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={clsx(
                  'flex-1 min-w-[68px] flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap',
                  tab === t.key ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50',
                )}
              >
                <span className="material-icons text-sm">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === 'overview' && (
            <div className="bg-white rounded-2xl border border-slate-200/70 p-2 divide-y divide-slate-100">
              <InfoItem icon="badge" label="Employee ID" value={employee.employeeNumber || '—'} />
              <InfoItem icon="apartment" label="Department" value={employee.department || '—'} />
              <InfoItem icon="work" label="Designation" value={employee.designation || '—'} />
              <InfoItem icon="schedule" label="Shift" value={employee.shift || '—'} />
              <InfoItem icon="login" label="Shift Start Time" value={employee.shiftStartTime || '—'} />
              <InfoItem icon="logout" label="Shift End Time" value={employee.shiftEndTime || '—'} />
              <InfoItem icon="event" label="Member Since" value={joining} />
              <InfoItem icon="event_available" label="Paid Leave Eligible" value={employee.paidLeavesEligible ? 'Yes (2 days / month)' : 'No'} />
              <InfoItem icon="timer" label="Overtime Eligible" value={employee.overtimeEligible ? 'Yes' : 'No'} />
              <InfoItem icon="mail" label="Email" value={employee.email || '—'} />
              <InfoItem icon="call" label="Mobile" value={employee.mobile || '—'} />
            </div>
          )}

          {tab === 'salary' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl p-5 text-white shadow-sm">
                <p className="text-xs opacity-80">Monthly Salary</p>
                <p className="text-3xl font-bold mt-1">₹ {fmtINR(employee.monthlySalary)}</p>
                <p className="text-xs opacity-80 mt-2">Annual CTC ≈ ₹ {fmtINR((employee.monthlySalary || 0) * 12)}</p>
              </div>
              {isLoading ? (
                <div className="text-center py-6 text-slate-400"><span className="material-icons animate-spin inline-block">sync</span></div>
              ) : detail ? (
                <div className="bg-white rounded-2xl border border-slate-200/70 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-slate-700">Latest Payroll</p>
                    <span className="text-xs text-slate-400">{payroll?.periodMonth}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Chip label="Payable days" value={detail.payableDays ?? '—'} tone="indigo" />
                    <Chip label="Gross" value={`₹${fmtINR(detail.grossSalary)}`} tone="emerald" />
                    <Chip label="Deductions" value={`₹${fmtINR(detail.totalDeductions)}`} tone="red" />
                    <Chip label="Net" value={`₹${fmtINR(detail.netSalary)}`} tone="emerald" />
                  </div>
                </div>
              ) : (
                <EmptyState icon="receipt_long" title="No payroll processed yet" sub="Upload attendance on the Payroll page to generate salary details." />
              )}
            </div>
          )}

          {tab === 'attendance' && (
            <div className="space-y-3">
              {isLoading ? (
                <div className="text-center py-6 text-slate-400"><span className="material-icons animate-spin inline-block">sync</span></div>
              ) : detail ? (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">Attendance Summary</p>
                    <span className="text-xs text-slate-400">{payroll?.periodMonth}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Chip label="Present" value={detail.presentDays ?? 0} tone="emerald" />
                    <Chip label="Absent" value={detail.absentDays ?? 0} tone="red" />
                    <Chip label="Late" value={detail.lateDays ?? 0} tone="amber" />
                    <Chip label="Missing punch" value={detail.missingPunches ?? 0} tone="amber" />
                    <Chip label="Weekly off" value={detail.weeklyOffs ?? 0} tone="slate" />
                    <Chip label="Paid leave" value={detail.paidLeave ?? 0} tone="indigo" />
                  </div>
                </>
              ) : (
                <EmptyState icon="event_busy" title="No attendance data" sub="Upload an attendance file to see this employee's monthly summary." />
              )}
            </div>
          )}

          {tab === 'leave' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl border border-slate-200/70 p-4 flex items-center gap-3">
                <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center', employee.paidLeavesEligible ? 'bg-emerald-50' : 'bg-slate-100')}>
                  <span className={clsx('material-icons', employee.paidLeavesEligible ? 'text-emerald-600' : 'text-slate-400')}>event_available</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{employee.paidLeavesEligible ? 'Eligible — 2 paid leaves / month' : 'Not eligible for paid leaves'}</p>
                  <p className="text-xs text-slate-400">Paid-leave policy</p>
                </div>
              </div>
              {leavesLoading ? (
                <div className="py-8 text-center text-slate-400"><span className="material-icons animate-spin">sync</span></div>
              ) : (
                <>
                  {leaveData?.balances.length ? (
                    <div className="grid grid-cols-2 gap-2">
                      {leaveData.balances.map(balance => (
                        <Chip key={balance.id} label={`${balance.leaveType} available`} value={balance.available} tone="emerald" />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">No leave balance has been configured for this employee.</div>
                  )}

                  {leaveData?.requests.length ? (
                    <div className="space-y-2">
                      {leaveData.requests.slice(0, 8).map(request => (
                        <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{request.leaveType}</p>
                              <p className="text-xs text-slate-400">{request.startDate} to {request.endDate} · {request.days} day{request.days === 1 ? '' : 's'}</p>
                            </div>
                            <span className={clsx(
                              'rounded-full px-2 py-0.5 text-[11px] font-bold capitalize',
                              request.status === 'approved' && 'bg-emerald-50 text-emerald-700',
                              request.status === 'rejected' && 'bg-rose-50 text-rose-700',
                              request.status === 'pending' && 'bg-amber-50 text-amber-700',
                            )}>{request.status}</span>
                          </div>
                          {request.approverNotes && <p className="mt-2 text-xs text-slate-500">HR: {request.approverNotes}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="event_note" title="No leave applications" sub="Requests submitted from Adamrit will appear here." />
                  )}

                  <a href={`/leaves?employeeId=${employee.id}`} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700">
                    <span className="material-icons text-base">open_in_new</span>
                    Open leave workspace
                  </a>
                </>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <div className="space-y-3">
              {documentsLoading ? (
                <div className="py-10 text-center text-sm text-slate-400">Loading documents...</div>
              ) : documents.length ? (
                documents.map(document => {
                  const downloadUrl = `/api/employees/${employee.id}/documents/${document.id}/download`;
                  return (
                  <div
                    key={document.id}
                    className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:bg-indigo-50/30"
                  >
                    <span className="material-icons flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">description</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-800">{document.originalFilename}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {document.documentType} · {fileSizeLabel(document.fileSize)} · {new Date(document.createdAt).toLocaleString()}
                      </span>
                      <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Source: {document.source === 'adamrit' ? 'Adamrit ESS' : 'HRPulse'}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <a
                        href={downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open document"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <span className="material-icons text-xl">open_in_new</span>
                      </a>
                      <a
                        href={downloadUrl}
                        download={document.originalFilename}
                        title="Download document"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                      >
                        <span className="material-icons text-xl">download</span>
                      </a>
                    </span>
                  </div>
                  );
                })
              ) : (
                <EmptyState icon="folder_open" title="No documents uploaded" sub="Documents uploaded by the employee from Adamrit will appear here." />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-white flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Close
          </button>
          <button
            onClick={onEdit}
            className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
          >
            <span className="material-icons text-base align-middle mr-1">edit</span>
            Edit
          </button>
        </div>
      </aside>
    </div>
  );
}
