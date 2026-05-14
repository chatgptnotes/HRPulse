import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api';
import StatusBadge from './StatusBadge';

interface Props {
  uploadId: number;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  onClose: () => void;
  onSent: () => void;
}

export default function EmailDraftModal({ uploadId, employeeId, employeeName, employeeEmail, onClose, onSent }: Props) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [draftId, setDraftId] = useState<number | null>(null);
  const [tab, setTab] = useState<'draft' | 'records'>('draft');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: draft } = useQuery({
    queryKey: ['draft', uploadId, employeeId],
    queryFn: () => api.getEmailDrafts(uploadId).then(r => {
      const d = (r.data as any[]).find(d => d.employeeId === employeeId);
      return d || null;
    }),
  });

  const { data: records = [] } = useQuery({
    queryKey: ['records', uploadId, employeeId],
    queryFn: () => api.getAttendanceRecords(uploadId, employeeId).then(r => r.data as any[]),
  });

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject || '');
      setBody(draft.body || '');
      setDraftId(draft.id);
    }
  }, [draft]);

  const handleSave = async () => {
    if (!draftId) return;
    setSaving(true);
    try {
      await api.updateDraft(draftId, { subject, body });
      qc.invalidateQueries({ queryKey: ['draft', uploadId, employeeId] });
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!draftId) return;
    // Auto-save first
    await api.updateDraft(draftId, { subject, body });
    setSending(true);
    try {
      await api.sendEmail(draftId);
      onSent();
    } catch (err) {
      alert('Send failed: ' + String(err));
    } finally {
      setSending(false);
    }
  };

  const flaggedRecords = records.filter((r: any) => !['Normal', 'Weekend', 'Holiday'].includes(r.status));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Email Draft Preview</h3>
            <p className="text-sm text-slate-500 mt-0.5">{employeeName} · {employeeEmail}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 flex gap-4 border-b border-slate-100">
          {['draft', 'records'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t as any)}
              className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              {t === 'draft' ? 'Email Draft' : `Attendance Records (${flaggedRecords.length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === 'draft' ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Email Body</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={14}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
            </div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 rounded-l">Date</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Status</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Time In</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 rounded-r">Time Out</th>
                  </tr>
                </thead>
                <tbody>
                  {flaggedRecords.map((r: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{r.recordDate}</td>
                      <td className="px-3 py-2"><StatusBadge label={r.status} small /></td>
                      <td className="px-3 py-2 text-slate-500">{r.timeIn || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{r.timeOut || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {draft?.templateType && <span className="capitalize">{draft.templateType} template</span>}
            {draft?.isEdited ? ' · Edited' : ''}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 font-medium">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 font-medium"
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !draftId}
              className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg font-medium"
            >
              {sending ? 'Sending...' : 'Send Email'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
