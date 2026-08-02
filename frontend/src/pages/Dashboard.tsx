import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import clsx from 'clsx';
import * as api from '../api';
import EmailDraftModal from '../components/email/EmailDraftModal';
import InspectExcelModal from '../components/attendance/InspectExcelModal';
import AttendanceSheetModal from '../components/attendance/AttendanceSheetModal';
import { DEPARTMENTS } from '../constants/departments';
import { mergeShiftOptions } from '../constants/shifts';

interface Summary {
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  absentDays: number;
  missedSwipeDays: number;
  lateComingDays: number;
  earlyLeavingDays: number;
  flaggedTotal: number;
  lopDays: number;
  lopAmount: number;
  hasDraft: boolean;
  draftStatus: string | null;
  draftId: number | null;
}

interface SheetEmployee {
  employeeId: number;
  employeeNumber: string;
  name: string;
  department: string;
  designation: string;
  days: Array<{ date: string; timeIn: string; timeOut: string; status: string; workingHours: number }>;
}

type AttendanceStatus = 'Present' | 'Absent' | 'Missing Punch' | 'Half Day' | 'Late' | 'Early Leaving';

const statusStyles: Record<AttendanceStatus, string> = {
  Present: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  Absent: 'bg-rose-50 text-rose-700 ring-rose-100',
  'Missing Punch': 'bg-orange-50 text-orange-700 ring-orange-100',
  'Half Day': 'bg-amber-50 text-amber-700 ring-amber-100',
  Late: 'bg-yellow-50 text-yellow-700 ring-yellow-100',
  'Early Leaving': 'bg-sky-50 text-sky-700 ring-sky-100',
};

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

function SummaryCard({
  icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  helper: string;
  tone: string;
}) {
  return (
    <div className="group rounded-3xl border border-white/70 bg-white p-4 shadow-sm shadow-slate-200/70 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-bold leading-none text-slate-950">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{helper}</p>
        </div>
        <div className={clsx('flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform group-hover:scale-105', tone)}>
          <Icon name={icon} className="text-2xl" />
        </div>
      </div>
    </div>
  );
}

function WorkflowStep({ label, done, active }: { label: string; done: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={clsx(
        'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-4',
        done ? 'bg-emerald-500 text-white ring-emerald-50' : active ? 'bg-indigo-600 text-white ring-indigo-50' : 'bg-slate-100 text-slate-400 ring-slate-50',
      )}>
        <Icon name={done ? 'check' : 'radio_button_unchecked'} className="text-sm" />
      </div>
      <span className={clsx('text-xs font-semibold', done ? 'text-slate-700' : active ? 'text-indigo-700' : 'text-slate-400')}>{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <span className={clsx('inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1', statusStyles[status])}>{status}</span>;
}

function isPresentDay(day: SheetEmployee['days'][number]) {
  const status = String(day.status || '').trim();
  if (['Normal', 'Present', 'Late Coming', 'Early Leaving', 'Missed Swipe'].includes(status)) return true;
  return !!(day.timeIn || day.timeOut);
}

export default function Dashboard() {
  const qc = useQueryClient();
  const inspectInputRef = useRef<HTMLInputElement>(null);
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [periodMonth, setPeriodMonth] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [acknowledgingCollision, setAcknowledgingCollision] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ completed: number; total: number; current: string } | null>(null);
  const [applyingRules, setApplyingRules] = useState(false);
  const [ruleResult, setRuleResult] = useState<{ draftsCreated: number; evaluated: number } | null>(null);
  const [checkingNoPunch, setCheckingNoPunch] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [noPunchOnly, setNoPunchOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [previewEmployee, setPreviewEmployee] = useState<{ uploadId: number; employeeId: number; name: string; email: string } | null>(null);
  const [inspectFile, setInspectFile] = useState<File | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: uploads = [] } = useQuery({ queryKey: ['uploads'], queryFn: () => api.getUploads().then(r => r.data) });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => api.getEmployees().then(r => r.data as any[]) });
  const { data: nameCollisionGroups = [] } = useQuery({
    queryKey: ['employee-name-collisions'],
    queryFn: () => api.getEmployeeNameCollisions().then(r => r.data),
  });
  const { data: summary = [], refetch: refetchSummary } = useQuery({
    queryKey: ['summary', uploadId],
    queryFn: () => api.getAttendanceSummary(uploadId!).then(r => r.data as Summary[]),
    enabled: !!uploadId,
  });
  const { data: drafts = [] } = useQuery({
    queryKey: ['drafts', uploadId],
    queryFn: () => api.getEmailDrafts(uploadId!).then(r => r.data),
    enabled: !!uploadId,
  });
  const { data: sheet = [] } = useQuery({
    queryKey: ['attendance-sheet', uploadId],
    queryFn: () => api.getAttendanceSheet(uploadId!).then(r => r.data as SheetEmployee[]),
    enabled: !!uploadId,
  });

  useEffect(() => {
    if (!uploadId && uploads.length > 0) {
      const latest = uploads[0] as { id: number; periodMonth: string };
      setUploadId(latest.id);
      setPeriodMonth(latest.periodMonth);
    }
  }, [uploads, uploadId]);

  useEffect(() => setPage(1), [search, deptFilter, shiftFilter, statusFilter, noPunchOnly, pageSize]);

  const selectedUpload = useMemo(() => (uploads as any[]).find(u => u.id === uploadId), [uploads, uploadId]);
  const employeeMap = useMemo(() => new Map((employees as any[]).map(emp => [emp.id, emp])), [employees]);
  const sheetMap = useMemo(() => new Map((sheet as SheetEmployee[]).map(emp => [emp.employeeId, emp])), [sheet]);
  const getDraftForEmployee = (empId: number) => (drafts as any[]).find((d: any) => d.employeeId === empId);
  const unresolvedNameCollisions = useMemo(
    () => nameCollisionGroups.filter(group => !group.acknowledged),
    [nameCollisionGroups],
  );
  const processingBlocked = unresolvedNameCollisions.length > 0;

  const onDrop = useCallback(async (files: File[]) => {
    if (!files[0]) return;
    setUploading(true);
    setUploadWarnings([]);
    try {
      const { data } = await api.uploadAttendance(files[0]);
      setUploadId(data.uploadId);
      setPeriodMonth(data.periodMonth);
      setUploadWarnings(data.warnings || []);
      qc.invalidateQueries({ queryKey: ['uploads'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee-name-collisions'] });
      showToast(`Uploaded ${data.rowCount} records and added ${data.employeeCreatedCount || 0} employees`);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Upload failed', 'err');
      setInspectFile(files[0]);
    } finally {
      setUploading(false);
    }
  }, [qc]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] },
    multiple: false,
  });

  const handleGenerate = async () => {
    if (!uploadId) return;
    if (processingBlocked) {
      showToast('Confirm all same-name employees before processing attendance', 'err');
      return;
    }
    setGenerating(true);
    setGenProgress({ completed: 0, total: 0, current: 'Starting...' });
    try {
      const response = await fetch(`/api/emails/generate/${uploadId}`, { method: 'POST' });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'progress') setGenProgress({ completed: ev.completed, total: ev.total, current: ev.currentEmployee });
            if (ev.type === 'done') showToast(`Processed ${ev.total} email drafts`);
            if (ev.type === 'error') showToast(ev.error, 'err');
          } catch {}
        }
      }
    } catch (err: any) {
      showToast('Processing failed: ' + String(err), 'err');
    } finally {
      setGenerating(false);
      setGenProgress(null);
      qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
    }
  };

  const handleApplyRules = async () => {
    if (!uploadId) return;
    if (processingBlocked) {
      showToast('Confirm all same-name employees before applying HR rules', 'err');
      return;
    }
    setApplyingRules(true);
    setRuleResult(null);
    try {
      const { data } = await api.evaluateRules(uploadId, true);
      setRuleResult({ draftsCreated: data.draftsCreated, evaluated: data.employeesEvaluated });
      showToast(`Rules applied: ${data.draftsCreated} draft${data.draftsCreated !== 1 ? 's' : ''} created`);
      qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
    } catch {
      showToast('Rule evaluation failed', 'err');
    } finally {
      setApplyingRules(false);
    }
  };

  const handleCheckNoPunch = async () => {
    setNoPunchOnly(true);
    setStatusFilter('');
    setCheckingNoPunch(true);
    try {
      await refetchSummary();
      showToast('Employees with no punches filtered');
    } finally {
      setCheckingNoPunch(false);
    }
  };

  const handleDispatch = async () => {
    if (!uploadId) return;
    if (processingBlocked) {
      showToast('Confirm all same-name employees before dispatching emails', 'err');
      return;
    }
    const pendingDrafts = (drafts as any[]).filter(d => d.status === 'pending' && (selected.size === 0 || selected.has(d.id)));
    if (pendingDrafts.length === 0) {
      showToast('No pending drafts to dispatch', 'err');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.sendBulk(pendingDrafts.map((d: any) => d.id));
      const sent = data.results.filter((r: any) => r.ok).length;
      const failed = data.results.filter((r: any) => !r.ok).length;
      showToast(`Dispatched ${sent} emails${failed > 0 ? `, ${failed} failed` : ''}`);
      qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
      setSelected(new Set());
    } catch {
      showToast('Dispatch failed', 'err');
    } finally {
      setSending(false);
    }
  };

  const rows = useMemo(() => {
    return (summary as Summary[]).map(item => {
      const emp = employeeMap.get(item.employeeId) || {};
      const sheetEmp = sheetMap.get(item.employeeId);
      const punchDay = sheetEmp?.days.find(d => ['Missed Swipe', 'Absent', 'Late Coming', 'Early Leaving', 'Half Day'].includes(d.status))
        || sheetEmp?.days.find(d => d.timeIn || d.timeOut)
        || sheetEmp?.days[0];
      const presentDays = sheetEmp?.days.filter(isPresentDay).length || 0;
      const status: AttendanceStatus =
        presentDays > item.absentDays ? 'Present'
          : item.missedSwipeDays > 2 ? 'Missing Punch'
          : item.absentDays > 0 ? 'Absent'
          : sheetEmp?.days.some(d => d.status === 'Half Day') ? 'Half Day'
          : item.lateComingDays > 0 ? 'Late'
          : item.earlyLeavingDays > 0 ? 'Early Leaving'
          : 'Present';
      const draft = getDraftForEmployee(item.employeeId);
      return {
        ...item,
        department: emp.department || sheetEmp?.department || 'Unassigned',
        shift: emp.shift || '-',
        employeeNumber: emp.employeeNumber || emp.employee_number || sheetEmp?.employeeNumber || `EMP-${item.employeeId}`,
        timeIn: punchDay?.timeIn || '-',
        timeOut: punchDay?.timeOut || '-',
        status,
        presentDays,
        draft,
      };
    });
  }, [summary, employeeMap, sheetMap, drafts]);

  const departments = useMemo(() => {
    const employeeDepartments = (employees as any[])
      .map(emp => emp.department)
      .filter(Boolean);
    const rowDepartments = rows
      .map(row => row.department)
      .filter(dept => dept && dept !== 'Unassigned');
    return [...new Set([...DEPARTMENTS, ...employeeDepartments, ...rowDepartments])].sort();
  }, [employees, rows]);
  const shifts = useMemo(() => {
    const employeeShifts = (employees as any[])
      .map(emp => emp.shift)
      .filter(Boolean);
    const rowShifts = rows
      .map(row => row.shift)
      .filter(shift => shift && shift !== '-');
    return mergeShiftOptions([...employeeShifts, ...rowShifts]);
  }, [employees, rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (deptFilter && row.department !== deptFilter) return false;
      if (shiftFilter && row.shift !== shiftFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (noPunchOnly && row.presentDays > 0) return false;
      if (q && !`${row.employeeName} ${row.employeeEmail} ${row.employeeNumber} ${row.department}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, deptFilter, shiftFilter, statusFilter, noPunchOnly, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const stats = useMemo(() => {
    const missingPunch = rows.filter(row => row.missedSwipeDays > 0).length;
    const absent = rows.filter(row => row.absentDays > 0).length;
    const late = rows.filter(row => row.lateComingDays > 0).length;
    const ready = rows.filter(row => row.draft?.status === 'pending' || row.draft?.status === 'sent').length;
    return { total: rows.length, missingPunch, absent, late, ready };
  }, [rows]);

  const pendingEmails = (drafts as any[]).filter(d => d.status === 'pending').length;
  const sentEmails = (drafts as any[]).filter(d => d.status === 'sent').length;
  const duplicateEstimate = Math.max(0, uploadWarnings.filter(w => /duplicate/i.test(w)).length);
  const verificationNeedsReview = uploadWarnings.length > 0 || processingBlocked;

  const acknowledgeNameCollision = async (group: api.EmployeeNameCollisionGroup) => {
    setAcknowledgingCollision(group.key);
    try {
      await api.acknowledgeEmployeeNameCollision(group);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['employee-name-collisions'] }),
        qc.invalidateQueries({ queryKey: ['employees'] }),
      ]);
      showToast(`${group.displayName} confirmed as separate employees`);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Could not save the confirmation', 'err');
    } finally {
      setAcknowledgingCollision(null);
    }
  };

  const exportCsv = () => {
    const headers = ['Employee ID', 'Employee Name', 'Email', 'Department', 'Shift', 'In Time', 'Out Time', 'Status', 'Absent', 'Missing Punch', 'Late', 'Draft Status'];
    const csvRows = filtered.map(row => [
      row.employeeNumber,
      row.employeeName,
      row.employeeEmail,
      row.department,
      row.shift,
      row.timeIn,
      row.timeOut,
      row.status,
      row.absentDays,
      row.missedSwipeDays,
      row.lateComingDays,
      row.draft?.status || 'No draft',
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-dispatcher-${periodMonth || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setDeptFilter('');
    setShiftFilter('');
    setStatusFilter('');
    setNoPunchOnly(false);
    setSearch('');
  };
  const hasActiveFilters = !!(deptFilter || shiftFilter || statusFilter || noPunchOnly || search.trim());

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
      <aside className="flex w-72 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-200/70 bg-white/95 shadow-sm">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-100">
              <Icon name="send" className="text-xl" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-950">Dispatcher</h2>
              <p className="text-xs text-slate-400">Attendance command center</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div
              {...getRootProps()}
              className={clsx(
                'cursor-pointer rounded-2xl border-2 border-dashed p-4 text-center transition-all',
                isDragActive ? 'border-indigo-400 bg-indigo-50 scale-[0.98]' : uploadId ? 'border-emerald-300 bg-emerald-50/60 hover:border-emerald-400' : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40',
              )}
            >
              <input {...getInputProps()} />
              <div className={clsx('mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl', uploading ? 'bg-indigo-100' : uploadId ? 'bg-emerald-100' : 'bg-white')}>
                <Icon name={uploading ? 'sync' : uploadId ? 'task_alt' : 'upload_file'} className={clsx('text-xl', uploading ? 'animate-spin text-indigo-600' : uploadId ? 'text-emerald-600' : 'text-slate-400')} />
              </div>
              <p className="text-sm font-bold text-slate-800">{uploading ? 'Processing file...' : selectedUpload?.filename || 'Upload attendance file'}</p>
              <p className="mt-1 text-xs text-slate-400">{uploadId ? `${periodMonth} - ${selectedUpload?.rowCount || 0} records` : 'Drop Excel file here'}</p>
            </div>
            <div className={clsx('mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-xs', verificationNeedsReview ? 'bg-amber-50' : 'bg-emerald-50')}>
              <span className={clsx('font-semibold', verificationNeedsReview ? 'text-amber-700' : 'text-emerald-700')}>Verification</span>
              <span className={clsx('font-bold', verificationNeedsReview ? 'text-amber-700' : 'text-emerald-700')}>
                {verificationNeedsReview ? 'Review Needed' : uploadId ? 'Verified' : 'Waiting'}
              </span>
            </div>
            {uploadWarnings.length > 0 && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                <div className="space-y-1">
                  {uploadWarnings.slice(0, showAllWarnings ? uploadWarnings.length : 2).map((warning, index) => <p key={index}>{warning}</p>)}
                </div>
                {uploadWarnings.length > 2 && (
                  <button type="button" onClick={() => setShowAllWarnings(value => !value)} className="mt-2 font-bold text-amber-800 underline underline-offset-2">
                    {showAllWarnings ? 'Show fewer notes' : `View all ${uploadWarnings.length} notes`}
                  </button>
                )}
              </div>
            )}
            {unresolvedNameCollisions.length > 0 && (
              <div className="mt-2 space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-2 text-xs text-violet-900">
                <p className="font-bold">Confirm employees with the same name</p>
                {unresolvedNameCollisions.map(group => (
                  <div key={group.key} className="rounded-lg border border-violet-200 bg-white p-2">
                    <p className="font-bold capitalize">{group.displayName}</p>
                    <p className="mt-1 text-violet-700">Employee numbers: {group.employees.map(employee => employee.employeeNumber).join(', ')}</p>
                    <button
                      type="button"
                      onClick={() => acknowledgeNameCollision(group)}
                      disabled={acknowledgingCollision === group.key}
                      className="mt-2 w-full rounded-lg bg-violet-600 px-2 py-1.5 font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {acknowledgingCollision === group.key ? 'Saving…' : 'Confirm Different Employees'}
                    </button>
                  </div>
                ))}
                <p className="text-violet-700">Processing stays locked until every group is confirmed.</p>
              </div>
            )}
            <button
              onClick={handleGenerate}
              disabled={!uploadId || generating || processingBlocked}
              title={processingBlocked ? 'Confirm all same-name employee groups first' : undefined}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-bold text-white shadow-lg shadow-indigo-100 transition hover:from-indigo-700 hover:to-purple-700 disabled:opacity-40"
            >
              <Icon name={generating ? 'sync' : 'auto_awesome'} className={clsx('text-base', generating && 'animate-spin')} />
              {generating && genProgress ? `${genProgress.completed}/${genProgress.total}` : 'Process Attendance'}
            </button>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Workflow</p>
            <div className="space-y-3">
              <WorkflowStep label="Upload File" done={!!uploadId} active={!uploadId} />
              <WorkflowStep label="Verify Data" done={!!uploadId && !verificationNeedsReview} active={!!uploadId && verificationNeedsReview} />
              <WorkflowStep label="Apply HR Rules" done={!!ruleResult || pendingEmails > 0 || sentEmails > 0} active={!!uploadId && !ruleResult && !processingBlocked} />
              <WorkflowStep label="Calculate Attendance" done={summary.length > 0} active={!!uploadId && summary.length === 0 && !processingBlocked} />
              <WorkflowStep label="Ready to Dispatch" done={pendingEmails > 0 || sentEmails > 0} active={summary.length > 0 && pendingEmails === 0 && !processingBlocked} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Quick Actions</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleApplyRules} disabled={!uploadId || applyingRules || processingBlocked} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-100 transition hover:bg-amber-100 disabled:opacity-40">
                <Icon name={applyingRules ? 'sync' : 'gavel'} className={clsx('mb-1 block text-base', applyingRules && 'animate-spin')} /> Apply HR Rules
              </button>
              <button onClick={handleCheckNoPunch} disabled={!uploadId || checkingNoPunch} className="rounded-xl bg-orange-50 px-3 py-2 text-xs font-bold text-orange-800 ring-1 ring-orange-100 transition hover:bg-orange-100 disabled:opacity-40">
                <Icon name={checkingNoPunch ? 'sync' : 'block'} className={clsx('mb-1 block text-base', checkingNoPunch && 'animate-spin')} /> No Punch
              </button>
              <button onClick={exportCsv} disabled={!filtered.length} className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-100 transition hover:bg-slate-100 disabled:opacity-40">
                <Icon name="download" className="mb-1 block text-base" /> Export Excel
              </button>
              <button onClick={handleDispatch} disabled={sending || pendingEmails === 0 || processingBlocked} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-100 transition hover:bg-emerald-100 disabled:opacity-40">
                <Icon name={sending ? 'sync' : 'send'} className={clsx('mb-1 block text-base', sending && 'animate-spin')} /> Dispatch Emails
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Icon name="auto_awesome" className="text-base text-indigo-600" />
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">AI Summary</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2"><span className="text-slate-500">Missing punches</span><b className="text-orange-700">{stats.missingPunch}</b></div>
              <div className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2"><span className="text-slate-500">Duplicate records</span><b className="text-slate-700">{duplicateEstimate}</b></div>
              <div className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2"><span className="text-slate-500">Absent employees</span><b className="text-rose-700">{stats.absent}</b></div>
              <div className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2"><span className="text-slate-500">Pending dispatch</span><b className="text-indigo-700">{pendingEmails}</b></div>
            </div>
          </section>

          <button
            onClick={() => inspectInputRef.current?.click()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100"
          >
            <Icon name="search" className="text-base" /> Inspect Excel
          </button>
          <input
            ref={inspectInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setInspectFile(f); e.target.value = ''; }}
          />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-slate-200/70 bg-white/90 px-5 py-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">Attendance Dispatcher</h1>
              <p className="mt-1 text-sm text-slate-500">Upload attendance, review flagged employees, apply HR rules, and dispatch emails from one clean workspace.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => uploadId && setShowSheet(true)} disabled={!uploadId} className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40">
                <Icon name="schedule" className="text-base" /> Punch In / Out
              </button>
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Set())} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50">
                  Clear ({selected.size})
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard icon="groups" label="Total Employees" value={stats.total} helper="Employees in current upload" tone="from-slate-600 to-slate-800" />
              <SummaryCard icon="touch_app" label="Missing Punch" value={stats.missingPunch} helper="Need punch correction" tone="from-orange-500 to-amber-500" />
              <SummaryCard icon="person_off" label="Absent" value={stats.absent} helper="Employees with absence" tone="from-rose-500 to-red-500" />
              <SummaryCard icon="schedule" label="Late" value={stats.late} helper="Late coming records" tone="from-yellow-500 to-orange-500" />
              <SummaryCard icon="outgoing_mail" label="Ready to Dispatch" value={stats.ready} helper="Drafts prepared or sent" tone="from-indigo-500 to-purple-600" />
            </section>

            <section className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[180px_160px_180px_1fr_auto]">
                <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className={controlClass('w-full')}>
                  <option value="">All departments</option>
                  {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                </select>
                <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)} className={controlClass('w-full')}>
                  <option value="">All shifts</option>
                  {shifts.map(shift => <option key={shift} value={shift}>{shift}</option>)}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={controlClass('w-full')}>
                  <option value="">All status</option>
                  {Object.keys(statusStyles).map(status => <option key={status} value={status}>{status}</option>)}
                </select>
                <div className="relative">
                  <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-slate-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee, ID, email..." className={controlClass('w-full pl-9')} />
                </div>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50">
                    Clear Filters
                  </button>
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-950">Employee Attendance Review</h2>
                  <p className="text-xs text-slate-400">Review status, select drafts, preview messages, and send attendance alerts.</p>
                </div>
                <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className={controlClass('w-28')}>
                  {[10, 25, 50].map(size => <option key={size} value={size}>{size} rows</option>)}
                </select>
              </div>

              <div className="max-h-[610px] overflow-auto">
                <table className="w-full min-w-[1080px] border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={paged.length > 0 && paged.every(row => row.draft && selected.has(row.draft.id))}
                          onChange={e => {
                            const next = new Set(selected);
                            paged.forEach(row => {
                              if (!row.draft) return;
                              if (e.target.checked) next.add(row.draft.id);
                              else next.delete(row.draft.id);
                            });
                            setSelected(next);
                          }}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                      </th>
                      {['Employee', 'Department', 'Shift', 'In Time', 'Out Time', 'Status', 'Action'].map(head => (
                        <th key={head} className={clsx('sticky top-0 z-10 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500', head === 'Action' ? 'text-right' : 'text-left')}>{head}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!uploadId && <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-400">Upload attendance file to start dispatch review.</td></tr>}
                    {uploadId && paged.length === 0 && <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-400">No employees match the current filters.</td></tr>}
                    {paged.map(row => {
                      const isSelected = row.draft && selected.has(row.draft.id);
                      return (
                        <tr key={row.employeeId} className={clsx('transition hover:bg-indigo-50/40', isSelected && 'bg-indigo-50/50')}>
                          <td className="px-4 py-3">
                            {row.draft ? (
                              <input
                                type="checkbox"
                                checked={!!isSelected}
                                onChange={e => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(row.draft.id);
                                  else next.delete(row.draft.id);
                                  setSelected(next);
                                }}
                                className="rounded border-slate-300 text-indigo-600"
                              />
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex min-w-56 items-center gap-3">
                              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-bold text-white shadow-md shadow-indigo-100">{initials(row.employeeName)}</div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{row.employeeName}</p>
                                <p className="truncate text-xs text-slate-400">{row.employeeNumber} - {row.employeeEmail}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{row.department}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{row.shift}</td>
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-emerald-700">{row.timeIn}</td>
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-indigo-700">{row.timeOut}</td>
                          <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              {row.draft ? (
                                <>
                                  <button onClick={() => setPreviewEmployee({ uploadId: uploadId!, employeeId: row.employeeId, name: row.employeeName, email: row.employeeEmail })} className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100">Preview</button>
                                  {row.draft.status === 'pending' && (
                                    <button
                                      onClick={async () => {
                                        try {
                                          await api.sendEmail(row.draft.id);
                                          qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
                                          qc.invalidateQueries({ queryKey: ['summary', uploadId] });
                                          showToast(`Email sent to ${row.employeeName}`);
                                        } catch {
                                          showToast('Send failed', 'err');
                                        }
                                      }}
                                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                                    >
                                      Send
                                    </button>
                                  )}
                                </>
                              ) : (
                                <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-400">No draft</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  Showing <span className="font-bold text-slate-800">{filtered.length ? (currentPage - 1) * pageSize + 1 : 0}</span> to <span className="font-bold text-slate-800">{Math.min(currentPage * pageSize, filtered.length)}</span> of <span className="font-bold text-slate-800">{filtered.length}</span>
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 disabled:opacity-40">Previous</button>
                  <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">{currentPage} / {pageCount}</span>
                  <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 disabled:opacity-40">Next</button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {previewEmployee && (
        <EmailDraftModal
          uploadId={previewEmployee.uploadId}
          employeeId={previewEmployee.employeeId}
          employeeName={previewEmployee.name}
          employeeEmail={previewEmployee.email}
          onClose={() => setPreviewEmployee(null)}
          onSent={() => {
            qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
            qc.invalidateQueries({ queryKey: ['summary', uploadId] });
            showToast(`Email sent to ${previewEmployee.name}`);
            setPreviewEmployee(null);
          }}
        />
      )}

      {inspectFile && <InspectExcelModal file={inspectFile} onClose={() => setInspectFile(null)} />}
      {showSheet && uploadId && <AttendanceSheetModal uploadId={uploadId} periodMonth={periodMonth} onClose={() => setShowSheet(false)} />}

      {toast && (
        <div className={clsx('fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl', toast.type === 'ok' ? 'bg-emerald-600' : 'bg-rose-600')}>
          <Icon name={toast.type === 'ok' ? 'check_circle' : 'error'} className="text-base" />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
