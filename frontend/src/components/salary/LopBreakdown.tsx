import { useQuery } from '@tanstack/react-query';
import * as api from '../../api';

const formatINR = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

interface Props {
  ded: any;
  emp: any;
  salary: number;
  month: string;
  uploadId: number | null;
  onClose: () => void;
  onSeeDates: () => void;
}

type Charge = { date: string; day: string; why: string; amount: number };

const isSunday = (value: unknown) => {
  const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 0;
};
const dayName = (value: unknown) =>
  new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

export default function LopBreakdown({ ded, emp, salary, month, uploadId, onClose, onSeeDates }: Props) {
  const rate = Number(ded.dailySalary || 0);
  const money = (value: number) => formatINR(Math.round(value * 100) / 100);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['records', uploadId, emp.id],
    queryFn: () => api.getAttendanceRecords(uploadId!, emp.id).then(r => r.data as any[]),
    enabled: !!uploadId,
  });

  // Walk the month in order and attribute each deduction to the day that caused
  // it. The engine only counts these, so which particular absences used the
  // allowance is a presentation choice — chronological, and the label says
  // which one each consumed.
  const allowance = Number(ded.protectedAbsentDays || 0);
  const contracted = emp.contracted_hours == null ? null : Number(emp.contracted_hours);
  const halfBelow = contracted ? contracted / 2 : (ded.rafttarStaff ? Number(ded.halfDayHours || 4) : 7);
  const charges: Charge[] = [];
  let covered = 0;
  for (const row of [...records].sort((a, b) => String(a.recordDate).localeCompare(String(b.recordDate)))) {
    const status = String(row.status || '').trim().toLowerCase();
    const sunday = isSunday(row.recordDate);
    const base = { date: String(row.recordDate).slice(0, 10), day: dayName(row.recordDate) };
    if (status === 'absent') {
      // A Rafttar Sunday is a paid weekly off and costs nothing. Every other
      // absence, a hospital Sunday included, draws on the monthly allowance.
      if (sunday && ded.rafttarStaff) continue;
      if (covered < allowance) {
        covered++;
        charges.push({ ...base, why: `Absent — covered by paid leave (${covered} of ${allowance})`, amount: 0 });
      } else {
        charges.push({ ...base, why: 'Absent — allowance already used', amount: rate });
      }
      continue;
    }
    const hours = row.work_hours == null ? null : Number(row.work_hours);
    if (hours !== null && hours < halfBelow && !['weekend', 'holiday', 'paid leave'].includes(status)) {
      charges.push({ ...base, why: `Half day — worked ${hours.toFixed(1)}h`, amount: rate * 0.5 });
    }
  }

  // A per-date list that disagrees with the headline would be worse than none,
  // so it is only shown when it reconciles.
  const attributed = charges.reduce((sum, c) => sum + c.amount, 0);
  const headline = Number(ded.lopAmount || 0);
  const reconciles = Math.abs(attributed - headline) <= 1;

  const summary: Array<{ label: string; detail: string; amount: number }> = [];
  if (Number(ded.chargeableAbsentDays || 0) > 0) summary.push({ label: 'Absent days charged', amount: Number(ded.absenceDeduction || 0), detail: `${ded.chargeableAbsentDays} × ${money(rate)}` });
  if (Number(ded.halfDays || 0) > 0) summary.push({ label: 'Half days', amount: Number(ded.halfDayDeduction || 0), detail: `${ded.halfDays} × ${money(rate / 2)}` });
  if (Number(ded.lateDeductionCount || 0) > 0) summary.push({ label: 'Late arrivals', amount: Number(ded.lateDeduction || 0), detail: `${ded.lateOccurrences} late ÷ ${ded.lateEvery}` });
  if (Number(ded.excessPaidLeave || 0) > 0) summary.push({ label: 'Leave beyond the allowance', amount: Number(ded.excessLeaveDeduction || 0), detail: `${ded.excessPaidLeave} × ${money(rate)}` });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="font-semibold text-slate-800">Why {money(headline)} was deducted</h3>
            <p className="mt-0.5 text-sm text-slate-500">{emp.name} · {month}</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-4 text-sm">
          <div className="flex justify-between py-1"><span className="text-slate-500">Monthly salary</span><span className="font-medium text-slate-800">{money(Number(salary || 0))}</span></div>
          <div className="flex justify-between border-b border-slate-100 py-1 pb-2"><span className="text-slate-500">A day's pay — salary ÷ 30</span><span className="font-medium text-slate-800">{money(rate)}</span></div>

          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            {ded.rafttarStaff
              ? <>Rafttar: every Sunday is a paid weekly off, plus <b>2</b> paid leaves.</>
              : <>Hospital: Sundays are working days, but <b>{ded.leaveLimit}</b> paid leaves a month — a Sunday taken off counts as one of them.</>}
          </div>

          {isLoading && <p className="mt-4 text-center text-[13px] text-slate-400">Loading the dates…</p>}

          {!isLoading && reconciles && charges.length > 0 && (
            <table className="mt-4 w-full text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 text-left font-semibold">Date</th>
                  <th className="py-1.5 text-left font-semibold">Why</th>
                  <th className="py-1.5 text-right font-semibold">Deducted</th>
                </tr>
              </thead>
              <tbody>
                {charges.map(c => (
                  <tr key={c.date + c.why} className="border-b border-slate-50">
                    <td className="whitespace-nowrap py-1.5 pr-2 text-slate-700">{c.date} <span className="text-slate-400">{c.day}</span></td>
                    <td className="py-1.5 pr-2 text-slate-500">{c.why}</td>
                    <td className={`py-1.5 text-right font-medium ${c.amount ? 'text-red-600' : 'text-emerald-600'}`}>{c.amount ? money(c.amount) : '₹0'}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-2 font-semibold text-slate-700" colSpan={2}>Total deducted</td>
                  <td className="pt-2 text-right font-semibold text-red-600">{money(headline)}</td>
                </tr>
                <tr>
                  <td className="pt-1 font-semibold text-slate-700" colSpan={2}>Net payable</td>
                  <td className="pt-1 text-right font-semibold text-emerald-700">{money(Math.max(0, Number(salary || 0) - headline))}</td>
                </tr>
              </tbody>
            </table>
          )}

          {!isLoading && (!reconciles || charges.length === 0) && (
            <>
              <table className="mt-4 w-full text-[13px] tabular-nums">
                <tbody>
                  {summary.map(l => (
                    <tr key={l.label}>
                      <td className="py-1.5 pr-2 align-top"><div className="font-medium text-slate-700">{l.label}</div><div className="text-[12px] text-slate-400">{l.detail}</div></td>
                      <td className="py-1.5 text-right align-top font-medium text-red-600">{money(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200">
                    <td className="pt-2 font-semibold text-slate-700">Total deducted</td>
                    <td className="pt-2 text-right font-semibold text-red-600">{money(headline)}</td>
                  </tr>
                  <tr>
                    <td className="pt-1 font-semibold text-slate-700">Net payable</td>
                    <td className="pt-1 text-right font-semibold text-emerald-700">{money(Math.max(0, Number(salary || 0) - headline))}</td>
                  </tr>
                </tbody>
              </table>
              {!reconciles && charges.length > 0 && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                  A day-by-day breakdown is not shown here because it did not add up to the total — the summary above is authoritative.
                </p>
              )}
            </>
          )}

          {Number(ded.missedSwipeDays || 0) > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              {ded.missedSwipeDays} missed swipe {Number(ded.missedSwipeDays) === 1 ? 'day is' : 'days are'} counted as full duty — nothing deducted, but the punch out was not recorded.
            </p>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-slate-100 px-6 py-3">
          <button onClick={onSeeDates} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">See the absent dates</button>
          <button onClick={onClose} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Close</button>
        </div>
      </div>
    </div>
  );
}
