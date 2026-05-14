import { useState, useRef, useCallback, useEffect } from 'react';
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

  // Auto-select latest upload on load
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

    const es = new EventSource(`/api/emails/generate/${uploadId}`);
    // EventSource doesn't support POST — use fetch with SSE manually
    es.close();

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
              if (ev.type === 'done') { showToast(`Generated ${ev.total} email drafts`); }
              if (ev.type === 'error') { showToast(ev.error, 'err'); }
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
    } catch (err: any) {
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
    <div className="flex h-screen overflow-hidden">
      {/* Left Panel */}
      <div className="w-64 border-r border-slate-200 bg-white flex flex-col overflow-y-auto">
        <div className="px-4 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-700 text-sm">Attendance Dispatcher AI</h2>
          <p className="text-xs text-slate-400 mt-0.5">Powered by local Ollama</p>
        </div>

        {/* Upload Zone */}
        <div className="px-4 py-4 border-b border-slate-100">
          <div
            {...getRootProps()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all',
              isDragActive ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-400 hover:bg-slate-50'
            )}
          >
            <input {...getInputProps()} />
            <div className="text-2xl mb-2">{uploading ? '⏳' : '📂'}</div>
            {uploading ? (
              <p className="text-xs text-slate-500">Processing...</p>
            ) : uploadId ? (
              <div>
                <p className="text-xs font-medium text-brand-600">Uploaded</p>
                <p className="text-xs text-slate-400 mt-0.5">{periodMonth}</p>
                <p className="text-xs text-slate-400 mt-0.5">Drop to replace</p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-slate-600">Upload Attendance File</p>
                <p className="text-xs text-slate-400 mt-0.5">Drop Excel (.xlsx) here</p>
              </div>
            )}
          </div>

          {uploadWarnings.length > 0 && (
            <div className="mt-2 text-xs text-amber-600 bg-amber-50 rounded p-2 space-y-0.5">
              {uploadWarnings.slice(0, 3).map((w, i) => <div key={i}>⚠ {w}</div>)}
              {uploadWarnings.length > 3 && <div>+{uploadWarnings.length - 3} more warnings</div>}
            </div>
          )}

          {/* Past uploads */}
          {uploads.length > 1 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-slate-400 font-medium">Past uploads</p>
              {(uploads as any[]).slice(0, 5).map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => { setUploadId(u.id); setPeriodMonth(u.periodMonth); }}
                  className={clsx('w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors', u.id === uploadId ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-500 hover:bg-slate-50')}
                >
                  {u.periodMonth} — {u.rowCount} rows
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom Guide */}
        <div className="px-4 py-3 border-b border-slate-100">
          <label className="text-xs font-medium text-slate-500 block mb-1.5">Custom Email Draft Guide</label>
          <textarea
            value={customGuide}
            onChange={e => setCustomGuide(e.target.value)}
            placeholder="Optional: add specific instructions for the AI draft..."
            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
            rows={3}
          />
        </div>

        {/* Generate Button */}
        <div className="px-4 py-3 border-b border-slate-100">
          <button
            onClick={handleGenerate}
            disabled={!uploadId || generating}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <span className="animate-spin">⏳</span>
                {genProgress ? `${genProgress.completed}/${genProgress.total}` : 'Starting...'}
              </>
            ) : (
              <><span>✨</span> Process with AI</>
            )}
          </button>
          {generating && genProgress && (
            <div className="mt-2">
              <div className="w-full bg-slate-100 rounded-full h-1.5">
                <div
                  className="bg-brand-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${genProgress.total ? (genProgress.completed / genProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1 truncate">{genProgress.current}</p>
            </div>
          )}
        </div>

        {/* Entity Summary */}
        {uploadId && (
          <div className="px-4 py-4 border-b border-slate-100 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Entity Summary</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Unique Entities</span>
              <span className="font-bold text-slate-800">{uniqueEntities}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Flagged Records</span>
              <span className="font-bold text-red-600">{flaggedRecords}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Pending Emails</span>
              <span className="font-bold text-amber-600">{pendingEmails}</span>
            </div>
            {sentEmails > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Sent Emails</span>
                <span className="font-bold text-green-600">{sentEmails}</span>
              </div>
            )}
          </div>
        )}

        {/* Dispatch Button */}
        {uploadId && (
          <div className="px-4 py-4 mt-auto">
            <button
              onClick={handleDispatch}
              disabled={sending || pendingEmails === 0}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {sending ? <span className="animate-spin">⏳</span> : <span>📤</span>}
              {sending ? 'Dispatching...' : `Dispatch Emails${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* Right Panel — Records Preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Records Preview</h3>
            {uploadId && <p className="text-xs text-slate-400 mt-0.5">{periodMonth} · {summary.length} employees with flagged records</p>}
          </div>
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employee..."
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:text-slate-700">
                Clear ({selected.size})
              </button>
            )}
          </div>
        </div>

        {!uploadId ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <div className="text-5xl mb-3">📂</div>
              <p className="font-medium">Upload an attendance Excel to get started</p>
              <p className="text-sm mt-1">SmartTime GDHR format supported</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <p>{summary.length === 0 ? 'No flagged records found' : 'No employees match search'}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Table Header */}
            <div className="sticky top-0 bg-slate-50 border-b border-slate-200 px-6 py-2.5 grid grid-cols-12 gap-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <div className="col-span-1">
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
              <div className="col-span-4">Status Flags</div>
              <div className="col-span-2">Action</div>
              <div className="col-span-2">Email Status</div>
            </div>

            {filtered.map(s => {
              const draft = getDraftForEmployee(s.employeeId);
              const isSelected = draft && selected.has(draft.id);
              return (
                <div
                  key={s.employeeId}
                  className={clsx(
                    'px-6 py-3.5 grid grid-cols-12 gap-4 border-b border-slate-100 hover:bg-slate-50 transition-colors items-center',
                    isSelected && 'bg-brand-50'
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
                  <div className="col-span-3">
                    <p className="text-sm font-medium text-slate-800 truncate">{s.employeeName}</p>
                    <p className="text-xs text-slate-400 truncate">{s.employeeEmail}</p>
                  </div>
                  <div className="col-span-4 flex flex-wrap gap-1">
                    {s.absentDays > 0 && <StatusBadge label="Absent" small />}
                    {s.missedSwipeDays > 0 && <StatusBadge label="Missed Swipe" small />}
                    {s.lateComingDays > 0 && <StatusBadge label="Late Coming" small />}
                    {s.earlyLeavingDays > 0 && <StatusBadge label="Early Leaving" small />}
                    <span className="text-xs text-slate-400 self-center">({s.flaggedTotal})</span>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5">
                    {draft ? (
                      <>
                        <button
                          onClick={() => setPreviewEmployee({ uploadId: uploadId!, employeeId: s.employeeId, name: s.employeeName, email: s.employeeEmail })}
                          className="text-xs bg-white border border-slate-200 hover:border-brand-400 hover:text-brand-600 text-slate-600 px-2.5 py-1 rounded-lg transition-colors font-medium"
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
                            className="text-xs bg-green-50 border border-green-200 hover:bg-green-100 text-green-700 px-2.5 py-1 rounded-lg transition-colors font-medium"
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

      {/* Email Draft Modal */}
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

      {/* Toast */}
      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all z-50',
          toast.type === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        )}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
