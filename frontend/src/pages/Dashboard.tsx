import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import clsx from 'clsx';
import * as api from '../api';
import StatusBadge from '../components/email/StatusBadge';
import EmailDraftModal from '../components/email/EmailDraftModal';
import useIsPhone from '../lib/useIsPhone';

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

// Drafts are stored with status 'draft'; the dispatcher previously looked for
// 'pending', so the counter sat at zero and nothing could ever be sent.
// Folded, because status casing is not guaranteed by older records.
const isUnsent = (status: unknown) => ['draft', 'pending'].includes(String(status ?? '').trim().toLowerCase());

export default function Dashboard() {
  const isPhone = useIsPhone();
  const qc = useQueryClient();
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [periodMonth, setPeriodMonth] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [staged, setStaged] = useState<Array<{ file: File; company: string }>>([]);
  const [customGuide, setCustomGuide] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ completed: number; total: number; current: string } | null>(null);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(10);
  const [previewEmployee, setPreviewEmployee] = useState<{ uploadId: number; employeeId: number; name: string; email: string } | null>(null);
  const [recordsEmployee, setRecordsEmployee] = useState<{ uploadId: number; employeeId: number; name: string; email: string } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applyingRules, setApplyingRules] = useState(false);
  const [ruleResult, setRuleResult] = useState<{ draftsCreated: number; evaluated: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [removingDrafts, setRemovingDrafts] = useState(false);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const removeUnsentDrafts = async () => {
    if (!uploadId || removingDrafts) return;
    const confirmed = window.confirm('Remove all unsent auto-generated drafts for this upload? Sent emails will not be removed.');
    if (!confirmed) return;
    setRemovingDrafts(true);
    try {
      const { data } = await api.deleteUnsentDraftsForUpload(uploadId);
      const removed = (data as any[]).length;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['drafts', uploadId] }),
        qc.invalidateQueries({ queryKey: ['summary', uploadId] }),
      ]);
      setSelected(new Set());
      showToast(removed ? `Removed ${removed} unsent draft${removed === 1 ? '' : 's'}` : 'No unsent drafts found');
    } catch (err: any) {
      showToast(err?.message || 'Could not remove drafts', 'err');
    } finally {
      setRemovingDrafts(false);
    }
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

  // Files are staged rather than sent straight away: biometric devices number
  // their users independently, so each file must say which company it came
  // from before #15 can be resolved to a person.
  const onDrop = useCallback((files: File[]) => {
    if (!files[0]) return;
    setStaged(files.map(file => ({ file, company: api.guessCompany(file.name) })));
    setUploadWarnings([]);
  }, []);

  const startUpload = useCallback(async () => {
    if (!staged.length) return;
    setUploading(true);
    setUploadWarnings([]);
    try {
      const { data } = await api.uploadAttendance(staged);
      setUploadId(data.uploadId);
      setPeriodMonth(data.periodMonth);
      // Every file reports its own outcome, so a multi-file drop cannot hide a
      // failure or a batch of skipped rows behind the last file's result.
      const perFile = ((data as any).files || []) as Array<{ filename: string; periodMonth: string | null; rowCount: number; ok: boolean; error?: string }>;
      const fileLines = perFile.map(f => f.ok ? `${f.filename}: ${f.rowCount} records for ${f.periodMonth}` : `${f.filename}: FAILED — ${f.error}`);
      setUploadWarnings([...fileLines, ...(data.warnings || [])]);
      qc.invalidateQueries({ queryKey: ['uploads'] });
      const failed = perFile.filter(f => !f.ok).length;
      showToast(failed
        ? `Imported ${data.rowCount} records; ${failed} of ${perFile.length} files failed`
        : `Uploaded: ${data.rowCount} records for ${data.periodMonth}`, failed ? 'err' : undefined);
    } catch (err: any) {
      showToast(err?.response?.data?.error || err?.message || 'Upload failed', 'err');
    } finally {
      setUploading(false);
      setStaged([]);
    }
  }, [qc, staged]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] },
    multiple: true,
  });

  const handleGenerate = async () => {
    if (!uploadId) return;
    setGenerating(true);
    setGenProgress({ completed: 0, total: 0, current: 'Starting...' });
    try {
      setGenProgress({ completed: 0, total: 1, current: 'Creating attendance drafts...' });
      const { data } = await api.evaluateRules(uploadId, true);
      showToast(`Created ${data.draftsCreated} email draft${data.draftsCreated !== 1 ? 's' : ''}`);
    } catch (err: any) {
      showToast('Generation failed: ' + String(err), 'err');
    } finally {
      setGenerating(false);
      setGenProgress(null);
      qc.invalidateQueries({ queryKey: ['summary', uploadId] });
      qc.invalidateQueries({ queryKey: ['drafts', uploadId] });
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

  const filtered = summary.filter(s =>
    s.employeeName.toLowerCase().includes(search.toLowerCase()) ||
    s.employeeEmail.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    setVisibleCount(10);
  }, [search, uploadId]);

  const visibleFiltered = isPhone ? filtered.slice(0, visibleCount) : filtered;

  const uniqueEntities = summary.length;
  const flaggedRecords = summary.reduce((acc, s) => acc + s.flaggedTotal, 0);
  const pendingEmails = (drafts as any[]).filter(d => isUnsent(d.status)).length;
  const sentEmails = (drafts as any[]).filter(d => d.status === 'sent').length;

  const getDraftForEmployee = (empId: number) => (drafts as any[]).find((d: any) => d.employeeId === empId);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0 flex-col overflow-visible bg-slate-100 lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Left Panel */}
      <div className="flex w-full flex-shrink-0 flex-col border-b border-slate-200/70 bg-white shadow-sm lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r lg:overflow-y-auto">
        <div className="border-b border-slate-100 px-3 py-1 sm:px-5 sm:py-5">
          <div className="flex items-center justify-between gap-2 sm:block">
            <h2 className="text-[13px] font-bold text-slate-800 sm:text-sm">Attendance Dispatcher</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400 sm:text-xs">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Template-based email drafting
            </p>
          </div>
        </div>

        {/* Upload Zone */}
        <div className="border-b border-slate-100 px-2 py-1.5 sm:px-4 sm:py-4">
          <div
            {...getRootProps()}
            className={clsx(
              'cursor-pointer rounded-xl border-2 border-dashed p-1.5 text-center transition-all sm:rounded-2xl sm:p-5',
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
                <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-md bg-indigo-100 sm:mb-2 sm:h-10 sm:w-10 sm:rounded-xl">
                  <span className="material-icons text-sm text-indigo-500 animate-spin sm:text-xl">sync</span>
                </div>
                <p className="text-[11px] font-medium text-slate-600 sm:text-xs">Processing...</p>
              </>
            ) : uploadId ? (
              <>
                <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 sm:mb-2 sm:h-10 sm:w-10 sm:rounded-xl">
                  <span className="material-icons text-sm text-emerald-600 sm:text-xl">check_circle</span>
                </div>
                <p className="text-[11px] font-semibold text-emerald-700 sm:text-xs">{periodMonth}</p>
                <p className="mt-0.5 text-[10px] text-slate-400 sm:text-xs">Drop one or more files to import</p>
              </>
            ) : (
              <>
                <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 sm:mb-2 sm:h-10 sm:w-10 sm:rounded-xl">
                  <span className="material-icons text-sm text-slate-400 sm:text-xl">upload_file</span>
                </div>
                <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">Upload Attendance File</p>
                <p className="mt-0.5 text-[10px] text-slate-400 sm:text-xs">Drop one or more Excel files (.xls/.xlsx) here</p>
              </>
            )}
          </div>

          {staged.length > 0 && (
            <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-2.5">
              <p className="text-[11px] font-semibold text-indigo-900">Which company is each file from?</p>
              <p className="mt-0.5 text-[10px] leading-4 text-indigo-700">
                Attendance devices number their staff separately — #15 is a different person at each site — so the company decides who each punch belongs to.
              </p>
              <div className="mt-2 space-y-1.5">
                {staged.map((item, i) => (
                  <div key={item.file.name + i} className="flex items-center gap-2">
                    <span className="material-icons text-sm text-indigo-400">description</span>
                    <span className="flex-1 truncate text-[11px] text-slate-700" title={item.file.name}>{item.file.name}</span>
                    <select
                      value={item.company}
                      onChange={e => setStaged(list => list.map((x, xi) => xi === i ? { ...x, company: e.target.value } : x))}
                      className={`rounded-lg border px-2 py-1 text-[11px] ${item.company ? 'border-slate-200 bg-white text-slate-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}
                    >
                      <option value="">Select company…</option>
                      <option value="Hope">Hope</option>
                      <option value="Ayushman">Ayushman</option>
                      <option value="Rafttar">Rafttar</option>
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={startUpload}
                  disabled={uploading || staged.some(item => !item.company)}
                  className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                >{uploading ? 'Importing…' : `Import ${staged.length} file${staged.length === 1 ? '' : 's'}`}</button>
                <button onClick={() => setStaged([])} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600">Cancel</button>
              </div>
              {staged.some(item => !item.company) && (
                <p className="mt-1.5 text-[10px] text-amber-700">Choose a company for every file before importing.</p>
              )}
            </div>
          )}

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
        <div className="border-b border-slate-100 px-2 py-1 sm:px-4 sm:py-3">
          <label className="mb-1 block text-[11px] font-semibold text-slate-500 sm:text-xs sm:mb-1.5">AI Draft Instructions</label>
          <textarea
            value={customGuide}
            onChange={e => setCustomGuide(e.target.value)}
            placeholder="Optional: add specific tone or context for the AI..."
            className="h-8 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:h-auto sm:px-3 sm:py-2 sm:text-xs"
            rows={2}
          />
        </div>

        {/* Generate Button */}
        <div className="border-b border-slate-100 px-2 py-1 sm:px-4 sm:py-3">
          <button
            onClick={handleGenerate}
            disabled={!uploadId || generating}
            className="flex min-h-8 w-full items-center justify-center gap-2 rounded-xl py-0.5 text-[12px] font-semibold text-white shadow-md shadow-indigo-900/20 transition-all disabled:opacity-50 sm:min-h-0 sm:py-2.5 sm:text-sm"
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
            className="mt-0.5 flex min-h-8 w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 py-0.5 text-[12px] font-semibold text-amber-800 transition-all hover:bg-amber-100 disabled:opacity-50 sm:mt-2 sm:min-h-0 sm:py-2.5 sm:text-sm"
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
            disabled
            title={`Pending reminders ${api.NOT_MIGRATED}`}
            className="mt-0.5 flex min-h-8 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 py-0.5 text-[12px] font-semibold text-rose-800 transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:mt-2 sm:min-h-0 sm:py-2.5 sm:text-sm"
          >
            <span className="material-icons text-base">alarm</span> Check 7-Day Reminders
          </button>
        </div>

        {/* Stats */}
        {uploadId && (
          <div className="border-b border-slate-100 bg-slate-50/30 px-2.5 py-2 sm:bg-white sm:px-4 sm:py-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:mb-3 sm:text-xs">Summary</p>
            <div className="space-y-1 sm:space-y-2">
              {[
                { label: 'Employees', value: uniqueEntities, color: 'text-slate-700', bg: 'bg-slate-100' },
                { label: 'Flagged Records', value: flaggedRecords, color: 'text-red-600', bg: 'bg-red-50' },
                { label: 'Pending Emails', value: pendingEmails, color: 'text-amber-600', bg: 'bg-amber-50' },
                ...(sentEmails > 0 ? [{ label: 'Sent', value: sentEmails, color: 'text-emerald-600', bg: 'bg-emerald-50' }] : []),
              ].map(s => (
                <div key={s.label} className={clsx('flex min-h-8 items-center justify-between gap-2 rounded-lg px-2.5 py-1 sm:min-h-0 sm:rounded-xl sm:px-3 sm:py-2', s.bg)}>
                  <span className="text-[11px] leading-tight text-slate-600 sm:text-xs">{s.label}</span>
                  <span className={clsx('shrink-0 text-sm font-bold leading-none sm:text-sm', s.color)}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dispatch Button */}
        {uploadId && (
          <div className="mt-auto px-2.5 py-2 sm:px-4 sm:py-4">
            <button
              disabled
              title={`Sending email ${api.NOT_MIGRATED}`}
              className="flex min-h-8 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-1 text-[12px] font-semibold text-white shadow-md shadow-emerald-900/20 transition-all disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:py-2.5 sm:text-sm"
            >
              <span className="material-icons text-base">send</span> Dispatch Emails{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            <p className="mt-1 text-center text-[9px] leading-snug text-slate-400 sm:mt-2 sm:text-[11px]">
              Drafts are saved and editable. Delivery is being rebuilt on Supabase.
            </p>
            {pendingEmails > 0 && (
              <button
                type="button"
                onClick={removeUnsentDrafts}
                disabled={removingDrafts}
                className="mt-2 w-full rounded-lg border border-rose-200 bg-rose-50 py-1.5 text-[10px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60 sm:mt-3 sm:py-2 sm:text-xs"
              >
                <span className="material-icons mr-1 align-middle text-[13px]">delete_outline</span>
                {removingDrafts ? 'Removing drafts...' : 'Remove unsent drafts'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right Panel */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible lg:overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-2 border-b border-slate-200/70 bg-white px-3 py-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 sm:py-4">
          <div>
            <h3 className="font-bold text-slate-800 text-base">Records Preview</h3>
            {uploadId && (
              <p className="text-xs text-slate-400 mt-0.5">
                {periodMonth} · <span className="text-indigo-500 font-medium">{summary.length} employees</span> with flagged records
              </p>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative w-full max-w-[180px] sm:w-auto sm:max-w-none">
              <span className="material-icons pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[13px] text-slate-400 sm:left-3 sm:text-base">search</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employee..."
                className="!min-h-0 h-7 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 py-0.5 pl-7 pr-2 text-[10px] focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:h-auto sm:rounded-xl sm:py-2 sm:pl-9 sm:pr-4 sm:text-sm sm:w-52"
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
          <div className="flex-1 space-y-1 overflow-y-auto p-2.5 sm:space-y-2 sm:p-4">
            {/* Table header */}
            <div className="hidden grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider sm:grid">
              <div className="col-span-1 flex items-center">
                <input
                  type="checkbox"
                  checked={selected.size === visibleFiltered.length && visibleFiltered.length > 0}
                  onChange={e => {
                    if (e.target.checked) {
                      const ids = visibleFiltered.map(s => getDraftForEmployee(s.employeeId)?.id).filter(Boolean);
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
            {visibleFiltered.map(s => {
              const draft = getDraftForEmployee(s.employeeId);
              const isSelected = draft && selected.has(draft.id);
              return (
                <div
                  key={s.employeeId}
                    onClick={isPhone ? () => setRecordsEmployee({ uploadId: uploadId!, employeeId: s.employeeId, name: s.employeeName, email: s.employeeEmail }) : undefined}
                    className={clsx(
                    'flex flex-col gap-1 rounded-lg border bg-white px-1.5 py-1.5 shadow-sm transition-all hover:shadow-md sm:cursor-default sm:grid sm:grid-cols-12 sm:items-center sm:gap-4 sm:rounded-2xl sm:px-4 sm:py-3.5',
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
                          e.stopPropagation();
                          const next = new Set(selected);
                          if (e.target.checked) next.add(draft.id);
                          else next.delete(draft.id);
                          setSelected(next);
                        }}
                        className="rounded"
                      />
                    )}
                  </div>

                  <div className="col-span-3 flex min-w-0 items-center gap-2 sm:gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 sm:h-8 sm:w-8 sm:rounded-xl">
                      <span className="text-[11px] font-bold text-white sm:text-xs">{s.employeeName.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold leading-tight text-slate-800 sm:text-sm">{s.employeeName}</p>
                      <p className="hidden truncate text-xs text-slate-400 sm:block">{s.employeeEmail}</p>
                    </div>
                  </div>

                  <div className="hr-scroll-x col-span-4 flex flex-nowrap items-center gap-1 sm:gap-1.5">
                    {s.absentDays > 0 && <StatusBadge label="Absent" small compact={isPhone} />}
                    {s.missedSwipeDays > 0 && <StatusBadge label="Missed Swipe" small compact={isPhone} />}
                    {s.lateComingDays > 0 && <StatusBadge label="Late Coming" small compact={isPhone} />}
                    {s.earlyLeavingDays > 0 && <StatusBadge label="Early Leaving" small compact={isPhone} />}
                    <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">{s.flaggedTotal}</span>
                  </div>

                  <div className="col-span-2 flex items-center gap-2">
                    {draft ? (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); setPreviewEmployee({ uploadId: uploadId!, employeeId: s.employeeId, name: s.employeeName, email: s.employeeEmail }); }}
                          className="text-xs font-semibold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 px-3 py-1.5 rounded-xl transition-colors border border-transparent hover:border-indigo-200"
                        >
                          Preview
                        </button>
                        {isUnsent(draft.status) && (
                          <button
                            disabled
                            title={`Sending email ${api.NOT_MIGRATED}`}
                            className="text-xs font-semibold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl border border-emerald-200 opacity-40 cursor-not-allowed"
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
            {isPhone && visibleFiltered.length < filtered.length && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setVisibleCount(count => Math.min(count + 10, filtered.length))}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                >
                  Load more · {filtered.length - visibleFiltered.length} remaining
                </button>
              </div>
            )}
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

      {recordsEmployee && (
        <EmailDraftModal
          uploadId={recordsEmployee.uploadId}
          employeeId={recordsEmployee.employeeId}
          employeeName={recordsEmployee.name}
          employeeEmail={recordsEmployee.email}
          initialTab="records"
          recordsOnly
          onClose={() => setRecordsEmployee(null)}
          onSent={() => setRecordsEmployee(null)}
        />
      )}

      {toast && (
        <div className={clsx(
          'fixed bottom-24 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold z-50 flex items-center gap-2',
          toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
        )}>
          <span className="material-icons text-base">{toast.type === 'ok' ? 'check_circle' : 'error'}</span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
