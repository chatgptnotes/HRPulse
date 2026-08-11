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
  const days = (value: number) => value.toFixed(value % 1 ? 1 : 0);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['records', uploadId, emp.id],
    queryFn: () => api.getAttendanceRecords(uploadId!, emp.id).then(r => r.data as any[]),
    enabled: !!uploadId,
  });

  const daywise = buildDayWiseSalary(records, ded, emp);
  const charges = daywise.lines
    .filter(line => (line.deducted > 0 || line.why.startsWith('Absent')) && !line.why.toLowerCase().includes('missed'))
    .map(line => ({ date: line.date, day: line.day, why: line.why, amount: line.deducted }));

  const headline = Number(ded.lopAmount || 0);

  // Essential values only
  const basicSalary = Number(salary || 0);
  const presentDays = Number(ded.presentDays || 0);
  const halfDays = Number(ded.halfDays || 0);
  const totalAbsentDays = Number(ded.totalAbsentDays || 0);
  const paidLeaveUsed = Number(ded.paidLeaveUsed || 0);
  const leaveLimit = Number(ded.leaveLimit || 0);
  const chargeableAbsentDays = Number(ded.chargeableAbsentDays || 0);
  const lateOccurrences = Number(ded.lateOccurrences || 0);
  const missedSwipeDays = Number(ded.missedSwipeDays || 0);
  const workedWeeklyOffs = Number(ded.workedWeeklyOffs || 0);
  const unusedLeaveDays = Number(ded.unusedLeaveDays || 0);
  const netPayable = Number(ded.netPayable || 0);
  const extraPayment = Number(ded.extraPayment || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="font-semibold text-slate-800 text-lg">
              Payment Summary
            </h3>
            <p className="text-sm text-slate-500">{emp.name} · {month}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-6 py-4 text-sm space-y-4">

          {/* Payment Summary */}
          <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
              <h4 className="font-semibold text-slate-800 text-base">📊 Payment Summary</h4>
            </div>
            <div className="p-4">
              <table className="w-full">
                <tbody>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 text-slate-600">Monthly Salary</td>
                    <td className="py-3 text-right font-semibold text-slate-800">{money(basicSalary)}</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 text-slate-600">Days Worked</td>
                    <td className="py-3 text-right text-slate-800">{days(presentDays)} days</td>
                  </tr>
                  {halfDays > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="py-3 text-slate-600">Half Days</td>
                      <td className="py-3 text-right text-slate-800">{halfDays} day{halfDays === 1 ? '' : 's'}</td>
                    </tr>
                  )}
                  {totalAbsentDays > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="py-3 text-slate-600">Absent Days</td>
                      <td className="py-3 text-right text-slate-800">{totalAbsentDays} day{totalAbsentDays === 1 ? '' : 's'}</td>
                    </tr>
                  )}
                  {paidLeaveUsed > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="py-3 text-slate-600">Paid Leave Used</td>
                      <td className="py-3 text-right text-slate-800">{paidLeaveUsed} day{paidLeaveUsed === 1 ? '' : 's'}</td>
                    </tr>
                  )}
                  <tr className="border-b border-slate-100">
                    <td className="py-3 text-slate-600">Leave Balance</td>
                    <td className="py-3 text-right text-slate-800">{paidLeaveUsed} of {leaveLimit} days used</td>
                  </tr>
                  {lateOccurrences > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="py-3 text-slate-600">Late Coming</td>
                      <td className="py-3 text-right text-slate-800">{lateOccurrences} day{lateOccurrences === 1 ? '' : 's'}</td>
                    </tr>
                  )}
                  {missedSwipeDays > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="py-3 text-slate-600">Missed Swipe</td>
                      <td className="py-3 text-right text-slate-800">{missedSwipeDays} day{missedSwipeDays === 1 ? '' : 's'}</td>
                    </tr>
                  )}
                  {workedWeeklyOffs > 0 && (
                    <tr className="border-b border-slate-100">
                      <td className="py-3 text-slate-600">Weekly Offs Worked</td>
                      <td className="py-3 text-right text-emerald-600">{workedWeeklyOffs} day{workedWeeklyOffs === 1 ? '' : 's'}</td>
                    </tr>
                  )}
                  {/* Separator */}
                  <tr>
                    <td colSpan={2} className="py-2"></td>
                  </tr>
                  {headline > 0 && (
                    <tr className="border-b-2 border-slate-200 bg-red-50">
                      <td className="py-3 font-semibold text-slate-700">LOP Deduction</td>
                      <td className="py-3 text-right font-bold text-red-600 text-base">- {money(headline)}</td>
                    </tr>
                  )}
                  {extraPayment > 0 && (
                    <tr className="border-b border-slate-200 bg-emerald-50">
                      <td className="py-3 font-semibold text-slate-700">Extra Pay</td>
                      <td className="py-3 text-right font-bold text-emerald-600 text-base">+ {money(extraPayment)}</td>
                    </tr>
                  )}
                  <tr className="bg-slate-50">
                    <td className="py-4 font-semibold text-slate-800 text-base">Net Payable</td>
                    <td className="py-4 text-right font-bold text-emerald-700 text-lg">{money(netPayable)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Extra Pay Details */}
          {extraPayment > 0 && (
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-emerald-200">
                <h4 className="font-semibold text-emerald-800 text-base">💰 Extra Pay Breakdown</h4>
                <span className="text-sm font-bold text-emerald-600 bg-emerald-100 px-3 py-1 rounded-lg">+{money(extraPayment)}</span>
              </div>

              {workedWeeklyOffs > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-emerald-700 mb-2">
                    <span className="font-medium">Weekly Offs Worked</span>
                    <span className="font-semibold">{workedWeeklyOffs} × {money(rate)}</span>
                  </div>
                  <div className="ml-4 space-y-1">
                    {daywise.lines
                      .filter(line => line.why.includes('Worked on weekly off'))
                      .map(line => (
                        <div key={line.date} className="flex items-center text-xs text-emerald-600 bg-emerald-100/50 px-3 py-2 rounded-lg">
                          <span className="w-24 font-medium">{line.date}</span>
                          <span className="text-emerald-500">({line.day})</span>
                          <span className="ml-auto font-bold">+{money(line.earned)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {unusedLeaveDays > 0 && (
                <div className="bg-emerald-100/50 rounded-lg p-3">
                  <div className="flex justify-between text-sm text-emerald-700 mb-1">
                    <span className="font-medium">Unused Leave</span>
                    <span className="font-semibold">{unusedLeaveDays} × {money(rate)}</span>
                  </div>
                  <p className="text-xs text-emerald-500 mt-1">Leave not availed, paid at month end</p>
                </div>
              )}
            </div>
          )}

          {/* Deduction Details */}
          {headline > 0 && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-red-200">
                <h4 className="font-semibold text-red-800 text-base">❌ Deduction Breakdown</h4>
                <span className="text-sm font-bold text-red-600 bg-red-100 px-3 py-1 rounded-lg">-{money(headline)}</span>
              </div>

              {halfDays > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-red-700 mb-2">
                    <span className="font-medium">Half Days</span>
                    <span className="font-semibold">{halfDays} × {money(rate / 2)}</span>
                  </div>
                  <div className="ml-4 space-y-1">
                    {daywise.lines
                      .filter(line => line.why.toLowerCase().includes('half') && line.deducted > 0)
                      .map(line => (
                        <div key={line.date} className="flex items-center text-xs text-red-600 bg-red-100/50 px-3 py-2 rounded-lg">
                          <span className="w-24 font-medium">{line.date}</span>
                          <span className="text-red-400">({line.day})</span>
                          <span className="ml-auto font-bold">-{money(line.deducted)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {chargeableAbsentDays > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-red-700 mb-2">
                    <span className="font-medium">Absent Days</span>
                    <span className="font-semibold">{chargeableAbsentDays} × {money(rate)}</span>
                  </div>
                  <div className="ml-4 space-y-1">
                    {daywise.lines
                      .filter(line => line.why.includes('allowance already used') && line.deducted > 0)
                      .map(line => (
                        <div key={line.date} className="flex items-center text-xs text-red-600 bg-red-100/50 px-3 py-2 rounded-lg">
                          <span className="w-24 font-medium">{line.date}</span>
                          <span className="text-red-400">({line.day})</span>
                          <span className="ml-auto font-bold">-{money(line.deducted)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}


              {Number(ded.excessPaidLeave || 0) > 0 && (
                <div className="bg-red-100/50 rounded-lg p-3">
                  <div className="flex justify-between text-sm text-red-700 mb-1">
                    <span className="font-medium">Leave Beyond Limit</span>
                    <span className="font-semibold">{Number(ded.excessPaidLeave || 0)} × {money(rate)}</span>
                  </div>
                  <p className="text-xs text-red-500 mt-1">Leave taken beyond monthly allowance</p>
                </div>
              )}
            </div>
          )}

          {/* Overtime Details */}
          {daywise.totalOvertimePay > 0 && (
            <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-blue-200">
                <h4 className="font-semibold text-blue-800 text-base">⏱️ Overtime Details</h4>
                <span className="text-sm font-bold text-blue-600 bg-blue-100 px-3 py-1 rounded-lg">{daywise.totalOvertimeHours.toFixed(1)} hrs</span>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm text-blue-700">
                  <span className="font-medium">Total Overtime Payment</span>
                  <span className="font-bold text-emerald-600">{money(daywise.totalOvertimePay)}</span>
                </div>

                {/* Individual overtime dates */}
                {daywise.lines.filter(line => line.overtimeHours && line.overtimeHours > 0).length > 0 && (
                  <div className="border-t border-blue-200 pt-3 mt-3">
                    <div className="text-xs text-slate-500 mb-2">Overtime Breakdown by Date</div>
                    <div className="space-y-1">
                      {daywise.lines
                        .filter(line => line.overtimeHours && line.overtimeHours > 0)
                        .map(line => (
                          <div key={line.date} className="flex items-center text-xs text-blue-600 bg-blue-100/50 px-3 py-2 rounded-lg">
                            <span className="w-24 font-medium">{line.date}</span>
                            <span className="text-blue-400">({line.day})</span>
                            <span className="ml-auto font-bold">{line.overtimeHours!.toFixed(1)} hrs = {money(line.overtimePay!)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* How It Works */}
          <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4">
            <h4 className="font-semibold text-slate-800 text-base mb-3">ℹ️ How Payment Calculation Works</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">•</span>
                <span><strong>Daily Rate:</strong> {money(rate)} per day (calculated as Monthly Salary ÷ 30)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">•</span>
                <span><strong>Half Days:</strong> 50% of daily rate is deducted ({money(rate / 2)} per half day)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">•</span>
                <span><strong>Absent Days:</strong> Full daily rate deducted, but protected by leave allowance ({leaveLimit} days/month)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-500 mt-0.5">•</span>
                <span><strong>Weekly Offs Worked:</strong> Full daily rate added as extra pay ({money(rate)} per day)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-500 mt-0.5">•</span>
                <span><strong>Unused Leave:</strong> Encashment of unused leave at month end ({money(rate)} per day)</span>
              </li>
            </ul>
          </div>

          {/* Day-by-Day Breakdown */}
          {!isLoading && charges.length > 0 && (
            <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                <h4 className="font-semibold text-slate-800 text-base">📅 Day-by-Day Breakdown</h4>
                <p className="text-xs text-slate-500 mt-0.5">{charges.length} days with changes</p>
              </div>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 px-4 text-left font-semibold">Date</th>
                      <th className="py-2 px-4 text-left font-semibold">Day</th>
                      <th className="py-2 px-4 text-left font-semibold">Reason</th>
                      <th className="py-2 px-4 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map(c => (
                      <tr key={c.date + c.why} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-4 text-slate-700">{c.date}</td>
                        <td className="py-2 px-4 text-slate-500">{c.day}</td>
                        <td className="py-2 px-4 text-slate-600">{c.why}</td>
                        <td className={`py-2 px-4 text-right font-semibold ${c.amount ? 'text-red-600' : 'text-emerald-600'}`}>
                          {c.amount ? money(c.amount) : '₹0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex justify-between items-center border-t border-slate-100 px-6 py-3">
          <button onClick={onSeeDates} className="rounded-xl border-2 border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            📆 See Full Calendar
          </button>
          <button onClick={onClose} className="rounded-xl bg-slate-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
