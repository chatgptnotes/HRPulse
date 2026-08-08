import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api';
import StatusBadge from './StatusBadge';
import { buildDayWiseSalary, formatINR } from '../../lib/dayWiseSalary';

interface Props {
  uploadId: number;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  onClose: () => void;
  onSent: () => void;
  initialTab?: 'draft' | 'records';
  recordsOnly?: boolean;
  /** Show only records whose status matches one of these (case-insensitive). */
  filterStatuses?: string[];
  /** Heading shown in place of "Attendance Details" when filtering. */
  filterLabel?: string;
  /** Also list Sundays, which Rafttar staff are paid for even though nobody
   *  punched and the stored status is therefore Absent. */
  includeSundays?: boolean;
  /** Optional line under the heading explaining what the list represents. */
  filterNote?: string;
  /** Pass all three to show what each day earned and cost. The Dashboard opens
   *  this modal without them and keeps the plain attendance table. */
  deduction?: any;
  employee?: any;
  monthlySalary?: number;
}

export default function EmailDraftModal({ uploadId, employeeId, employeeName, employeeEmail, onClose, onSent, initialTab = 'draft', recordsOnly = false, filterStatuses, filterLabel, includeSundays = false, filterNote, deduction, employee, monthlySalary }: Props) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [draftId, setDraftId] = useState<number | null>(null);
  const [tab, setTab] = useState<'draft' | 'records'>(initialTab);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

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

  const flaggedRecords = records.filter((r: any) => !['normal', 'weekend', 'holiday'].includes(String(r.status || '').trim().toLowerCase()));
  const baseRecords = recordsOnly ? records : flaggedRecords;
  // When a specific column is clicked (e.g. Absent Days) show only the dates
  // behind that number, so the count and the listed dates always agree.
  const wanted = filterStatuses?.map(s => s.toLowerCase());
  const isSunday = (value: unknown) => {
    const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.getUTCDay() === 0;
  };
  const visibleRecords = wanted
    ? baseRecords.filter((r: any) =>
        wanted.includes(String(r.status || '').trim().toLowerCase())
        || (includeSundays && isSunday(r.recordDate)))
    : baseRecords;

  // What each day was worth. Attributed over the whole month — the totals below
  // then cover only the rows actually on screen, so a filtered list (Absent
  // Dates, say) adds up to what it shows rather than to the month.
  // Nothing to attribute without a salary on record — every column would read
  // ₹0 and imply the month was worth nothing, rather than unknown.
  const salaryData = useMemo(
    () => (deduction && employee && Number(deduction.dailySalary || 0) > 0 ? buildDayWiseSalary(records, deduction, employee) : null),
    [records, deduction, employee],
  );
  const showMoney = !!salaryData && salaryData.reconciles;
  const lineByDate = useMemo(
    () => new Map((salaryData?.lines || []).map(l => [l.date, l])),
    [salaryData],
  );
  const lineFor = (r: any) => lineByDate.get(String(r.recordDate).slice(0, 10));
  const visibleEarned = visibleRecords.reduce((sum: number, r: any) => sum + (lineFor(r)?.earned || 0), 0);
  const visibleDeducted = visibleRecords.reduce((sum: number, r: any) => sum + (lineFor(r)?.deducted || 0), 0);
  const money = (value: number) => formatINR(Math.round(value * 100) / 100);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${showMoney ? 'max-w-3xl' : 'max-w-2xl'} max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">{tab === 'records' ? (filterLabel || 'Attendance Details') : 'Email Draft Preview'}</h3>
            <p className="text-sm text-slate-500 mt-0.5">{employeeName} · {employeeEmail}</p>
            {tab === 'records' && filterNote && <p className="mt-1 text-xs text-slate-400">{filterNote}</p>}
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
              {t === 'draft' ? 'Email Draft' : `${filterLabel || 'Attendance Records'} (${visibleRecords.length})`}
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
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 rounded-l">Date</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Status</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Time In</th>
                    <th className={`text-left px-3 py-2 text-xs font-semibold text-slate-500 ${showMoney ? '' : 'rounded-r'}`}>Time Out</th>
                    {showMoney && <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Earned</th>}
                    {showMoney && <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 rounded-r">Deducted</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((r: any, i: number) => {
                    const line = lineFor(r);
                    return (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700">{r.recordDate}</td>
                        <td className="px-3 py-2">{includeSundays && isSunday(r.recordDate) && String(r.status || '').trim().toLowerCase() === 'absent'
                          ? <StatusBadge label="Paid weekly off" small />
                          : <StatusBadge label={r.status} small />}</td>
                        <td className="px-3 py-2 text-slate-500">{r.timeIn || '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{r.timeOut || '—'}</td>
                        {showMoney && (
                          <td className="px-3 py-2 text-right text-slate-700" title={line?.why || undefined}>
                            {line?.earned ? money(line.earned) : '—'}
                          </td>
                        )}
                        {showMoney && (
                          <td className="px-3 py-2 text-right font-medium text-red-600" title={line?.why || undefined}>
                            {line?.deducted ? money(line.deducted) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {showMoney && visibleRecords.length > 0 && (
                    <tr className="border-t border-slate-200">
                      <td className="px-3 pt-2 font-semibold text-slate-700" colSpan={4}>
                        Total for the {visibleRecords.length} {visibleRecords.length === 1 ? 'date' : 'dates'} listed
                      </td>
                      <td className="px-3 pt-2 text-right font-semibold text-slate-800">{money(visibleEarned)}</td>
                      <td className="px-3 pt-2 text-right font-semibold text-red-600">{money(visibleDeducted)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {visibleRecords.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-400">No matching attendance dates for this employee.</p>
              )}
              {showMoney && (
                <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px]">
                  <div className="flex justify-between py-0.5"><span className="text-slate-500">Monthly salary</span><span className="font-medium text-slate-800">{money(Number(monthlySalary || deduction.basicSalary || 0))}</span></div>
                  <div className="flex justify-between py-0.5"><span className="text-slate-500">Total deducted this month</span><span className="font-medium text-red-600">{money(Number(deduction.lopAmount || 0))}</span></div>
                  <div className="flex justify-between border-t border-slate-200 py-0.5 pt-1.5"><span className="font-semibold text-slate-700">Net payable</span><span className="font-semibold text-emerald-700">{money(Math.max(0, Number(monthlySalary || deduction.basicSalary || 0) - Number(deduction.lopAmount || 0)))}</span></div>
                  <p className="mt-2 text-[12px] leading-snug text-slate-400">
                    A day's pay is salary ÷ 30, so the daily column need not add up to the monthly salary. Net payable above is authoritative.
                  </p>
                </div>
              )}
              {salaryData && !salaryData.reconciles && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                  Day-by-day pay is not shown here because it did not add up to this month's total — the salary sheet is authoritative.
                </p>
              )}
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
              {recordsOnly ? 'Close' : 'Cancel'}
            </button>
            {!recordsOnly && <>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 font-medium">
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button onClick={handleSend} disabled={sending || !draftId} className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg font-medium">
                {sending ? 'Sending...' : 'Send Email'}
              </button>
            </>}
          </div>
        </div>
      </div>
    </div>
  );
}
