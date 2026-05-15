import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import clsx from 'clsx';
import * as api from '../api';
import StatusBadge from '../components/email/StatusBadge';
import EmailDraftModal from '../components/email/EmailDraftModal';

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

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: number | string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 p-4 flex items-center gap-4 shadow-sm">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
        <span className="material-icons text-white text-lg">{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800 leading-none">{value}</p>
        <p className="text-xs text-slate-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [periodMonth, setPeriodMonth] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [customGuide, setCustomGuide] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ completed: number; total: number; current: string } | null>(null);
  const [search, setSearch] = useState('');
  const [previewEmployee, setPreviewEmployee] = useState<{ uploadId: number; employeeId: number; name: string; email: string } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [applyingRules, setApplyingRules] = useState(false);
  const [ruleResult, setRuleResult] = useState<{ draftsCreated: number; evaluated: number } | null>(null);
  const [checkingReminders, setCheckingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ created: number; checked: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: uploads = [] } = useQuery({ queryKey: ['uploads'], queryFn: () => api.getUploads().then(r => r.data) });
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

  useEffect(() => {
    if (!uploadId && uploads.length > 0) {
      const latest = uploads[0] as { id: number; periodMonth: string };
      setUploadId(latest.id);
      setPeriodMonth(latest.periodMonth);
    }
  }, [uploads]);

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
      showToast(`Uploaded: ${data.rowCount} records for ${data.periodMonth}`);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Upload failed', 'err');
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
          if (line.startsWith('data: ')) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress') setGenProgress({ completed: ev.completed, total: ev.total, current: ev.currentEmployee });
              if (ev.type === 'done') showToast(`Generated ${ev.total} email drafts`);
              if (ev.type === 'error') showToast(ev.error, 'err');
            } catch {}
          }
        }
      }
    } catch (err: any) {
      showToast('Generation failed: ' + String(err), 'err');
    } finally {
      setGenerating(false);
      setGenProgress(null);
      qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
    }
  };

  const handleCheckReminders = async () => {
    setCheckingReminders(true);
    setReminderResult(null);
    try {
      const { data } = await api.checkPendingReminders();
      setReminderResult(data);
      if (data.created > 0) {
        showToast(`${data.created} reminder draft${data.created !== 1 ? 's' : ''} created for overdue employees`);
        qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
        qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      } else {
        showToast(`Checked ${data.checked} employees — no reminders needed yet`);
      }
    } catch {
      showToast('Reminder check failed', 'err');
    } finally {
      setCheckingReminders(false);
    }
  };

  const handleApplyRules = async () => {
    if (!uploadId) return;
    setApplyingRules(true);
    setRuleResult(null);
    try {
      const { data } = await api.evaluateRules(uploadId, true);
      setRuleResult({ draftsCreated: data.draftsCreated, evaluated: data.employeesEvaluated });
      showToast(`Rules applied: ${data.draftsCreated} draft${data.draftsCreated !== 1 ? 's' : ''} created from ${data.employeesEvaluated} employees`);
      qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
    } catch {
      showToast('Rule evaluation failed', 'err');
    } finally {
      setApplyingRules(false);
    }
  };

  const handleDispatch = async () => {
    if (!uploadId) return;
    const pendingDrafts = (drafts as any[]).filter(d => d.status === 'pending' && (selected.size === 0 || selected.has(d.id)));
    if (pendingDrafts.length === 0) { showToast('No pending drafts to send', 'err'); return; }
    setSending(true);
    try {
      const { data } = await api.sendBulk(pendingDrafts.map((d: any) => d.id));
      const sent = data.results.filter((r: any) => r.ok).length;
      const failed = data.results.filter((r: any) => !r.ok).length;
      showToast(`Sent ${sent} emails${failed > 0 ? `, ${failed} failed` : ''}`);
      qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
      setSelected(new Set());
    } catch {
      showToast('Dispatch failed', 'err');
    } finally {
      setSending(false);
    }
  };

  const filtered = summary.filter(s =>
    s.employeeName.toLowerCase().includes(search.toLowerCase()) ||
    s.employeeEmail.toLowerCase().includes(search.toLowerCase())
  );

  const uniqueEntities = summary.length;
  const flaggedRecords = summary.reduce((acc, s) => acc + s.flaggedTotal, 0);
  const pendingEmails = (drafts as any[]).filter(d => d.status === 'pending').length;
  const sentEmails = (drafts as any[]).filter(d => d.status === 'sent').length;

  const getDraftForEmployee = (empId: number) => (drafts as any[]).find((d: any) => d.employeeId === empId);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Left Panel */}
      <div className="w-64 bg-white border-r border-slate-200/70 flex flex-col overflow-y-auto shadow-sm">
        <div className="px-5 py-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800 text-sm">Attendance Dispatcher</h2>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Powered by local Ollama
          </p>
        </div>

        {/* Upload Zone */}
        <div className="px-4 py-4 border-b border-slate-100">
          <div
            {...getRootProps()}
            className={clsx(
              'border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all',
              isDragActive
                ? 'border-indigo-400 bg-indigo-50 scale-[0.98]'
                : uploadId
                ? 'border-emerald-300 bg-emerald-50/50 hover:border-emerald-400'
                : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30'
            )}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <>
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-2">
                  <span className="material-icons text-indigo-500 text-xl animate-spin">sync</span>
                </div>
                <p className="text-xs font-medium text-slate-600">Processing...</p>
              </>
            ) : uploadId ? (
              <>
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center mx-auto mb-2">
                  <span className="material-icons text-emerald-600 text-xl">check_circle</span>
                </div>
                <p className="text-xs font-semibold text-emerald-700">{periodMonth}</p>
                <p className="text-xs text-slate-400 mt-0.5">Drop to replace</p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-2">
                  <span className="material-icons text-slate-400 text-xl">upload_file</span>
                </div>
                <p className="text-xs font-semibold text-slate-600">Upload Attendance File</p>
                <p className="text-xs text-slate-400 mt-0.5">Drop Excel (.xlsx) here</p>
              </>
            )}
          </div>

          {uploadWarnings.length > 0 && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-0.5">
              {uploadWarnings.slice(0, 3).map((w, i) => <div key={i}>⚠ {w}</div>)}
              {uploadWarnings.length > 3 && <div className="text-amber-500">+{uploadWarnings.length - 3} more</div>}
            </div>
          )}

          {uploads.length > 1 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Past uploads</p>
              {(uploads as any[]).slice(0, 5).map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => { setUploadId(u.id); setPeriodMonth(u.periodMonth); }}
                  className={clsx(
                    'w-full text-left text-xs px-3 py-2 rounded-xl transition-colors font-medium',
                    u.id === uploadId
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'text-slate-500 hover:bg-slate-50 border border-transparent'
                  )}
                >
                  {u.periodMonth} · {u.rowCount} rows
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom Guide */}
        <div className="px-4 py-3 border-b border-slate-100">
          <label className="text-xs font-semibold text-slate-500 block mb-1.5">AI Draft Instructions</label>
          <textarea
            value={customGuide}
            onChange={e => setCustomGuide(e.target.value)}
            placeholder="Optional: add specific tone or context for the AI..."
            className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 bg-slate-50"
            rows={3}
          />
        </div>

        {/* Generate Button */}
        <div className="px-4 py-3 border-b border-slate-100">
          <button
            onClick={handleGenerate}
            disabled={!uploadId || generating}
            className="w-full text-white text-sm font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-indigo-900/20"
            style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
          >
            {generating ? (
              <>
                <span className="material-icons text-base animate-spin">sync</span>
                {genProgress ? `${genProgress.completed}/${genProgress.total}` : 'Starting...'}
              </>
            ) : (
              <><span className="material-icons text-base">auto_awesome</span> Process with AI</>
            )}
          </button>
          {generating && genProgress && (
            <div className="mt-2.5">
              <div className="w-full bg-slate-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${genProgress.total ? (genProgress.completed / genProgress.total) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, #6366f1, #4f46e5)',
                  }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1 truncate">{genProgress.current}</p>
            </div>
          )}

          <button
            onClick={handleApplyRules}
            disabled={!uploadId || applyingRules}
            className="w-full mt-2 text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 text-sm font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {applyingRules
              ? <><span className="material-icons text-base animate-spin">sync</span> Evaluating...</>
              : <><span className="material-icons text-base">gavel</span> Apply HR Rules</>
            }
          </button>
          {ruleResult && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
              <span className="material-icons text-xs">check_circle</span>
              {ruleResult.draftsCreated} draft{ruleResult.draftsCreated !== 1 ? 's' : ''} from {ruleResult.evaluated} employees
            </div>
          )}

          <button
            onClick={handleCheckReminders}
            disabled={checkingReminders}
            className="w-full mt-2 text-rose-800 bg-rose-50 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 text-sm font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {checkingReminders
              ? <><span className="material-icons text-base animate-spin">sync</span> Checking...</>
              : <><span className="material-icons text-base">alarm</span> Check 7-Day Reminders</>
            }
          </button>
          {reminderResult && reminderResult.created > 0 && (
            <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
              <span className="material-icons text-xs">mark_email_unread</span>
              {reminderResult.created} reminder{reminderResult.created !== 1 ? 's' : ''} queued
            </div>
          )}
        </div>

        {/* Stats */}
        {uploadId && (
          <div className="px-4 py-4 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Summary</p>
            <div className="space-y-2">
              {[
                { label: 'Employees', value: uniqueEntities, color: 'text-slate-700', bg: 'bg-slate-100' },
                { label: 'Flagged Records', value: flaggedRecords, color: 'text-red-600', bg: 'bg-red-50' },
                { label: 'Pending Emails', value: pendingEmails, color: 'text-amber-600', bg: 'bg-amber-50' },
                ...(sentEmails > 0 ? [{ label: 'Sent', value: sentEmails, color: 'text-emerald-600', bg: 'bg-emerald-50' }] : []),
              ].map(s => (
                <div key={s.label} className={clsx('flex items-center justify-between px-3 py-2 rounded-xl', s.bg)}>
                  <span className="text-xs text-slate-600">{s.label}</span>
                  <span className={clsx('text-sm font-bold', s.color)}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dispatch Button */}
        {uploadId && (
          <div className="px-4 py-4 mt-auto">
            <button
              onClick={handleDispatch}
              disabled={sending || pendingEmails === 0}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-900/20"
            >
              {sending
                ? <><span className="material-icons text-base animate-spin">sync</span> Dispatching...</>
                : <><span className="material-icons text-base">send</span> Dispatch Emails{selected.size > 0 ? ` (${selected.size})` : ''}</>
              }
            </button>
          </div>
        )}
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-white border-b border-slate-200/70 flex items-center justify-between shadow-sm">
          <div>
            <h3 className="font-bold text-slate-800 text-base">Records Preview</h3>
            {uploadId && (
              <p className="text-xs text-slate-400 mt-0.5">
                {periodMonth} · <span className="text-indigo-500 font-medium">{summary.length} employees</span> with flagged records
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">search</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employee..."
                className="text-sm border border-slate-200 rounded-xl pl-9 pr-4 py-2 w-52 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 bg-slate-50"
              />
            </div>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors">
                Clear ({selected.size})
              </button>
            )}
          </div>
        </div>

        {!uploadId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center mx-auto mb-4">
                <span className="material-icons text-slate-300 text-4xl">upload_file</span>
              </div>
              <p className="font-semibold text-slate-600">Upload an attendance file to get started</p>
              <p className="text-sm text-slate-400 mt-1">SmartTime GDHR format supported</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <p>{summary.length === 0 ? 'No flagged records found' : 'No employees match search'}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <div className="col-span-1 flex items-center">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={e => {
                    if (e.target.checked) {
                      const ids = filtered.map(s => getDraftForEmployee(s.employeeId)?.id).filter(Boolean);
                      setSelected(new Set(ids));
                    } else {
                      setSelected(new Set());
                    }
                  }}
                  className="rounded"
                />
              </div>
              <div className="col-span-3">Employee</div>
              <div className="col-span-4">Flags</div>
              <div className="col-span-2">Action</div>
              <div className="col-span-2">Status</div>
            </div>

            {/* Rows */}
            {filtered.map(s => {
              const draft = getDraftForEmployee(s.employeeId);
              const isSelected = draft && selected.has(draft.id);
              return (
                <div
                  key={s.employeeId}
                  className={clsx(
                    'grid grid-cols-12 gap-4 px-4 py-3.5 bg-white rounded-2xl border items-center transition-all shadow-sm hover:shadow-md',
                    isSelected
                      ? 'border-indigo-300 bg-indigo-50/50 shadow-indigo-100'
                      : 'border-slate-200/70 hover:border-slate-300'
                  )}
                >
                  <div className="col-span-1">
                    {draft && (
                      <input
                        type="checkbox"
                        checked={!!isSelected}
                        onChange={e => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(draft.id);
                          else next.delete(draft.id);
                          setSelected(next);
                        }}
                        className="rounded"
                      />
                    )}
                  </div>

                  <div className="col-span-3 flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">{s.employeeName.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{s.employeeName}</p>
                      <p className="text-xs text-slate-400 truncate">{s.employeeEmail}</p>
                    </div>
                  </div>

                  <div className="col-span-4 flex flex-wrap gap-1.5 items-center">
                    {s.absentDays > 0 && <StatusBadge label="Absent" small />}
                    {s.missedSwipeDays > 0 && <StatusBadge label="Missed Swipe" small />}
                    {s.lateComingDays > 0 && <StatusBadge label="Late Coming" small />}
                    {s.earlyLeavingDays > 0 && <StatusBadge label="Early Leaving" small />}
                    <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{s.flaggedTotal}</span>
                  </div>

                  <div className="col-span-2 flex items-center gap-2">
                    {draft ? (
                      <>
                        <button
                          onClick={() => setPreviewEmployee({ uploadId: uploadId!, employeeId: s.employeeId, name: s.employeeName, email: s.employeeEmail })}
                          className="text-xs font-semibold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 px-3 py-1.5 rounded-xl transition-colors border border-transparent hover:border-indigo-200"
                        >
                          Preview
                        </button>
                        {draft.status === 'pending' && (
                          <button
                            onClick={async () => {
                              try {
                                await api.sendEmail(draft.id);
                                qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
                                qc.invalidateQueries({ queryKey: ['summary', uploadId] });
                                showToast(`Email sent to ${s.employeeName}`);
                              } catch { showToast('Send failed', 'err'); }
                            }}
                            className="text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-xl transition-colors border border-emerald-200"
                          >
                            Send
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-300">No draft</span>
                    )}
                  </div>

                  <div className="col-span-2">
                    {draft ? <StatusBadge label={draft.status} small /> : <span className="text-xs text-slate-300">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold z-50 flex items-center gap-2',
          toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
        )}>
          <span className="material-icons text-base">{toast.type === 'ok' ? 'check_circle' : 'error'}</span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
