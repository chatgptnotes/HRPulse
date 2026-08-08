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

// Drafts are stored with status 'draft'; the dispatcher previously looked for
// 'pending', so the counter sat at zero and nothing could ever be sent.
// Folded, because status casing is not guaranteed by older records.
const isUnsent = (status: unknown) => ['draft', 'pending'].includes(String(status ?? '').trim().toLowerCase());

export default function Dashboard() {
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
  const [previewEmployee, setPreviewEmployee] = useState<{ uploadId: number; employeeId: number; name: string; email: string } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applyingRules, setApplyingRules] = useState(false);
  const [ruleResult, setRuleResult] = useState<{ draftsCreated: number; evaluated: number } | null>(null);
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

  const uniqueEntities = summary.length;
  const flaggedRecords = summary.reduce((acc, s) => acc + s.flaggedTotal, 0);
  const pendingEmails = (drafts as any[]).filter(d => isUnsent(d.status)).length;
  const sentEmails = (drafts as any[]).filter(d => d.status === 'sent').length;

  const getDraftForEmployee = (empId: number) => (drafts as any[]).find((d: any) => d.employeeId === empId);

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-slate-100 lg:flex-row">
      {/* Left Panel */}
      <div className="flex max-h-[46vh] w-full flex-shrink-0 flex-col overflow-y-auto border-b border-slate-200/70 bg-white shadow-sm lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r">
        <div className="px-5 py-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800 text-sm">Attendance Dispatcher</h2>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Template-based email drafting
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
                <p className="text-xs text-slate-400 mt-0.5">Drop one or more files to import</p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-2">
                  <span className="material-icons text-slate-400 text-xl">upload_file</span>
                </div>
                <p className="text-xs font-semibold text-slate-600">Upload Attendance File</p>
                <p className="text-xs text-slate-400 mt-0.5">Drop one or more Excel files (.xls/.xlsx) here</p>
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
            disabled
            title={`Pending reminders ${api.NOT_MIGRATED}`}
            className="w-full mt-2 text-rose-800 bg-rose-50 border border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <span className="material-icons text-base">alarm</span> Check 7-Day Reminders
          </button>
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
              disabled
              title={`Sending email ${api.NOT_MIGRATED}`}
              className="w-full bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-900/20"
            >
              <span className="material-icons text-base">send</span> Dispatch Emails{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            <p className="mt-2 text-[11px] leading-snug text-slate-400 text-center">
              Drafts are saved and editable. Delivery is being rebuilt on Supabase.
            </p>
          </div>
        )}
      </div>

      {/* Right Panel */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-slate-200/70 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h3 className="font-bold text-slate-800 text-base">Records Preview</h3>
            {uploadId && (
              <p className="text-xs text-slate-400 mt-0.5">
                {periodMonth} · <span className="text-indigo-500 font-medium">{summary.length} employees</span> with flagged records
              </p>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative">
              <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">search</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employee..."
                className="w-full min-w-0 border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 sm:w-52"
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
