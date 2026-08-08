import { useQuery } from '@tanstack/react-query';
import * as api from '../../api';
import { buildDayWiseSalary, formatINR } from '../../lib/dayWiseSalary';

interface Props {
  ded: any;
  emp: any;
  salary: number;
  month: string;
  uploadId: number | null;
  onClose: () => void;
  onSeeDates: () => void;
}

export default function LopBreakdown({ ded, emp, salary, month, uploadId, onClose, onSeeDates }: Props) {
  const rate = Number(ded.dailySalary || 0);
  const money = (value: number) => formatINR(Math.round(value * 100) / 100);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['records', uploadId, emp.id],
    queryFn: () => api.getAttendanceRecords(uploadId!, emp.id).then(r => r.data as any[]),
    enabled: !!uploadId,
  });

  // Which day each rupee came off. Shared with the attendance details modal so
  // the two screens can never tell different stories about the same month.
  const daywise = buildDayWiseSalary(records, ded, emp);
  // Days the employee was paid in full are the uninteresting majority here —
  // keep the ones that cost something, plus the absences the allowance covered,
  // because "this absence was free" is worth saying.
  const charges = daywise.lines
    .filter(line => line.deducted > 0 || line.why.startsWith('Absent'))
    .map(line => ({ date: line.date, day: line.day, why: line.why, amount: line.deducted }));

  // A per-date list that disagrees with the headline would be worse than none,
  // so it is only shown when it reconciles.
  const headline = Number(ded.lopAmount || 0);
  const reconciles = daywise.reconciles;

  const summary: Array<{ label: string; detail: string; amount: number }> = [];
  if (Number(ded.chargeableAbsentDays || 0) > 0) summary.push({ label: 'Absent days charged', amount: Number(ded.absenceDeduction || 0), detail: `${ded.chargeableAbsentDays} × ${money(rate)}` });
  if (Number(ded.halfDays || 0) > 0) summary.push({ label: 'Half days', amount: Number(ded.halfDayDeduction || 0), detail: `${ded.halfDays} × ${money(rate / 2)}` });
  if (Number(ded.excessPaidLeave || 0) > 0) summary.push({ label: 'Leave beyond the allowance', amount: Number(ded.excessLeaveDeduction || 0), detail: `${ded.excessPaidLeave} × ${money(rate)}` });

  // An entitled off that was worked rather than taken is paid for. Stated as its
  // own section because it is the only thing that ever adds to the pay.
  const additions: Array<{ label: string; detail: string; amount: number }> = [];
  if (Number(ded.workedWeeklyOffs || 0) > 0) additions.push({ label: 'Weekly offs worked', amount: Number(ded.workedWeeklyOffPay || 0), detail: `${ded.workedWeeklyOffs} × ${money(rate)}` });
  if (Number(ded.unusedLeaveDays || 0) > 0) additions.push({ label: 'Leave not availed', amount: Number(ded.unusedLeavePay || 0), detail: `${ded.unusedLeaveDays} of ${ded.leaveLimit} × ${money(rate)}` });
  const extraPayment = Number(ded.extraPayment || 0);
  // The engine counts the payable days and owns the formula; this modal explains
  // it rather than working it out again.
  const netPayable = Number(ded.netPayable || 0);
  const payableDays = Number(ded.payableDays || 0);
  const attendedDays = Number(ded.attendedDays || 0);
  const paidOffDays = Number(ded.paidOffDays || 0);
  const basePay = Number(ded.basePay || 0);
  const days = (value: number) => value.toFixed(value % 1 ? 1 : 0);
  // Thirty days of pay cannot cover a thirty-one day month, so in a long month
  // the base pay is less than the days would suggest and saying so is better
  // than leaving the arithmetic looking wrong.
  const cappedByCeiling = payableDays * rate > Number(salary || 0) + 0.005;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="font-semibold text-slate-800">
              How {money(netPayable)} was worked out
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">{emp.name} · {month}</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        <div className="overflow-y-auto px-6 py-4 text-sm">
          <div className="flex justify-between py-1"><span className="text-slate-500">Monthly salary</span><span className="font-medium text-slate-800">{money(Number(salary || 0))}</span></div>
          <div className="flex justify-between border-b border-slate-100 py-1 pb-2"><span className="text-slate-500">A day's pay — salary ÷ 30</span><span className="font-medium text-slate-800">{money(rate)}</span></div>

          {/* Pay is counted up from the days owed, so the days come first and the
              charges below explain which dates did not make the count. */}
          <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2.5">
            <div className="flex justify-between text-[13px]">
              <span className="text-slate-600">Days attended</span>
              <span className="font-medium text-slate-800">{days(attendedDays)}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-slate-600">Paid offs within the allowance</span>
              <span className="font-medium text-slate-800">{days(paidOffDays)} of {ded.leaveLimit}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-emerald-200 pt-1.5 text-[13px]">
              <span className="font-semibold text-slate-700">Payable days — {days(payableDays)} of {ded.daysInMonth} × {money(rate)}</span>
              <span className="font-semibold text-emerald-700">{money(basePay)}</span>
            </div>
            {cappedByCeiling && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Capped at the monthly salary — {days(payableDays)} days at a day's pay comes to {money(payableDays * rate)}, but a month never pays more than the salary unless an off was worked.
              </p>
            )}
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            {ded.rafttarStaff
              ? <>Rafttar: every Sunday is a paid weekly off, plus <b>{ded.leaveLimit}</b> paid leaves.</>
              : <>Hospital: Sundays are working days, but <b>{ded.leaveLimit}</b> paid leaves a month — a Sunday taken off counts as one of them.</>}
            {' '}Under <b>4 hours</b> worked is half a day, and a long shift is still
            one day's pay. Lateness is recorded but never costs anything. An off that
            was worked rather than taken — a weekly off come in on, or leave still
            unspent at month end — is paid at a day's pay each, on top of the salary.
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
                  <td className="pt-2 font-semibold text-slate-700" colSpan={2}>Days the month did not pay for — {days(Number(ded.lopDays || 0))}</td>
                  <td className="pt-2 text-right font-semibold text-red-600">{money(headline)}</td>
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
                    <td className="pt-2 font-semibold text-slate-700">Days the month did not pay for — {days(Number(ded.lopDays || 0))}</td>
                    <td className="pt-2 text-right font-semibold text-red-600">{money(headline)}</td>
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

          {!isLoading && (
            <table className="mt-4 w-full border-t border-slate-200 pt-2 text-[13px] tabular-nums">
              <tbody>
                {additions.map(l => (
                  <tr key={l.label}>
                    <td className="py-1.5 pr-2 align-top"><div className="font-medium text-slate-700">{l.label}</div><div className="text-[12px] text-slate-400">{l.detail}</div></td>
                    <td className="py-1.5 text-right align-top font-medium text-emerald-600">+{money(l.amount)}</td>
                  </tr>
                ))}
                {additions.length > 0 && (
                  <tr>
                    <td className="pt-2 font-semibold text-slate-700">Total added for offs worked</td>
                    <td className="pt-2 text-right font-semibold text-emerald-600">+{money(extraPayment)}</td>
                  </tr>
                )}
                <tr className="border-t border-slate-200">
                  <td className="pt-2 font-semibold text-slate-700">Net payable</td>
                  <td className="pt-2 text-right font-semibold text-emerald-700">{money(netPayable)}</td>
                </tr>
              </tbody>
            </table>
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
