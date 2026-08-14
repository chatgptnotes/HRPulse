import { formatINR } from '../../lib/dayWiseSalary';

interface EmployeeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  employee: {
    emp: any;
    config: any;
    deduction: any;
    hasAttendance: boolean;
    hasSalary: boolean;
    hasLop: boolean;
  } | null;
  month?: string;
}

export default function EmployeeDrawer({ isOpen, onClose, employee, month }: EmployeeDrawerProps) {
  if (!isOpen || !employee) return null;

  const { emp, config, deduction, hasAttendance, hasSalary, hasLop } = employee;

  const basicSalary = Number(config?.basicSalary || 0);
  const dailySalary = basicSalary > 0 && deduction?.daysInMonth ? basicSalary / Number(deduction.daysInMonth) : 0;
  const extraPayment = Number(deduction?.extraPayment || 0);
  const lopAmount = Number(deduction?.lopAmount || 0);
  const managementAdjustment = Number(deduction?.managementAdjustment || 0);
  const netPayable = Number(deduction?.netPayable || 0);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  };

  const summaryCards = [
    {
      label: 'Basic Salary',
      value: basicSalary > 0 ? formatINR(basicSalary) : '—',
      color: 'from-purple-500 to-indigo-600',
      bgColor: 'from-purple-50 to-indigo-50',
      textColor: 'text-purple-700',
    },
    {
      label: 'Net Payable',
      value: netPayable > 0 ? formatINR(netPayable) : '—',
      color: 'from-emerald-500 to-green-600',
      bgColor: 'from-emerald-50 to-green-50',
      textColor: 'text-emerald-700',
      highlight: true,
    },
    {
      label: 'Extra Pay',
      value: extraPayment > 0 ? formatINR(extraPayment) : '₹0',
      color: 'from-teal-500 to-cyan-600',
      bgColor: 'from-teal-50 to-cyan-50',
      textColor: 'text-teal-700',
    },
    {
      label: 'Loss of Pay',
      value: lopAmount > 0 ? formatINR(lopAmount) : '₹0',
      color: 'from-red-500 to-rose-600',
      bgColor: 'from-red-50 to-rose-50',
      textColor: 'text-red-700',
    },
  ];

  const attendanceData = [
    { label: 'Present Days', value: deduction?.presentDays ?? '—', color: 'text-emerald-600' },
    { label: 'Payable Days', value: deduction?.payableDays ?? '—', color: 'text-emerald-600' },
    { label: 'Absent Days', value: deduction?.absentDays ?? '—', color: 'text-red-600' },
    { label: 'Half Days', value: deduction?.halfDays ?? '—', color: 'text-orange-600' },
    { label: 'Late Count', value: deduction?.lateOccurrences ?? '—', color: 'text-slate-600' },
    { label: 'Paid Leave', value: `${deduction?.protectedAbsentDays ?? 0}/${deduction?.leaveLimit ?? 0}`, color: 'text-blue-600' },
  ];

  const extraPayBreakdown = [
    ...(deduction?.workedWeeklyOffs > 0 ? [{ label: 'Weekly Offs Worked', value: `${deduction.workedWeeklyOffs} days`, amount: deduction.workedWeeklyOffs * dailySalary }] : []),
    ...(deduction?.unusedLeaveDays > 0 ? [{ label: 'Unused Leave Days', value: `${deduction.unusedLeaveDays} days`, amount: deduction.unusedLeaveDays * dailySalary }] : []),
    ...(deduction?.overtimePayment > 0 ? [{ label: 'Overtime Payment', value: `Extra ${deduction.overtimePayableDays?.toFixed(1) || 0} days`, amount: deduction.overtimePayment }] : []),
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[480px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Employee Details</h2>
            <p className="text-sm text-slate-500 mt-0.5">{month ? `Payroll for ${month}` : 'Payroll Information'}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-600 hover:text-slate-800"
            aria-label="Close"
          >
            <span className="material-icons text-2xl">close</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Employee Profile */}
          <div className="flex items-start gap-4 mb-6">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white text-xl font-bold shadow-lg shadow-purple-500/30">
              {emp.name ? getInitials(emp.name) : 'NA'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-slate-800 truncate">{emp.name || 'Unknown Employee'}</h3>
              <p className="text-sm text-slate-500 truncate">{emp.email || 'No email'}</p>
              <p className="text-sm text-slate-600 mt-1">{emp.designation || 'No designation'}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  !hasAttendance ? 'bg-slate-100 text-slate-500' :
                  hasLop ? 'bg-gradient-to-r from-red-50 to-rose-50 text-red-600 ring-1 ring-red-100' :
                  extraPayment > 0 ? 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 ring-1 ring-blue-100' :
                  hasSalary ? 'bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-600 ring-1 ring-emerald-100' :
                  'bg-gradient-to-r from-amber-50 to-orange-50 text-amber-600 ring-1 ring-amber-100'
                }`}>
                  {!hasAttendance ? 'No attendance' :
                   extraPayment > 0 ? 'Extra pay added' :
                   hasLop ? 'Loss of pay calculated' :
                   hasSalary ? 'Attendance loaded' : 'Salary pending'}
                </span>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {summaryCards.map((card) => (
              <div
                key={card.label}
                className={`relative overflow-hidden rounded-xl border ${card.highlight ? 'border-emerald-300 ring-2 ring-emerald-200' : 'border-slate-200'} bg-gradient-to-br ${card.bgColor} px-4 py-3`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{card.label}</p>
                <p className={`text-lg font-bold ${card.textColor} tabular-nums mt-1`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Salary Structure */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="material-icons text-lg text-purple-600">account_balance</span>
              Salary Structure
            </h4>
            <div className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">Monthly Salary</span>
                <span className="text-sm font-bold text-slate-800 tabular-nums">{basicSalary > 0 ? formatINR(basicSalary) : '—'}</span>
              </div>
              {dailySalary > 0 && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Days in Month</span>
                    <span className="text-sm font-semibold text-slate-700">{deduction?.daysInMonth || 30}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Per Day Rate</span>
                    <span className="text-sm font-bold text-slate-800 tabular-nums">{formatINR(dailySalary)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Attendance Summary */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="material-icons text-lg text-emerald-600">event_available</span>
              Attendance Summary
            </h4>
            <div className="grid grid-cols-3 gap-3">
              {attendanceData.map((item) => (
                <div key={item.label} className="bg-white rounded-xl border border-slate-200 px-3 py-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{item.label}</p>
                  <p className={`text-base font-bold ${item.color} tabular-nums`}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Extra Pay Breakdown */}
          {extraPayment > 0 && extraPayBreakdown.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <span className="material-icons text-lg text-teal-600">trending_up</span>
                Extra Pay Breakdown
              </h4>
              <div className="bg-teal-50 rounded-xl border border-teal-200 px-4 py-3 space-y-2">
                {extraPayBreakdown.map((item, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-semibold text-teal-800">{item.label}</p>
                      <p className="text-xs text-teal-600">{item.value}</p>
                    </div>
                    <span className="text-sm font-bold text-teal-700 tabular-nums">{formatINR(item.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 border-t border-teal-200">
                  <span className="text-sm font-bold text-teal-800">Total Extra Pay</span>
                  <span className="text-base font-bold text-teal-700 tabular-nums">{formatINR(extraPayment)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Loss of Pay Breakdown */}
          {lopAmount > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <span className="material-icons text-lg text-red-600">money_off</span>
                Loss of Pay Breakdown
              </h4>
              <div className="bg-red-50 rounded-xl border border-red-200 px-4 py-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">LOP Days</span>
                  <span className="text-sm font-bold text-red-600">{deduction?.lopDays?.toFixed(1) || '0'} days</span>
                </div>
                {dailySalary > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Per Day Rate</span>
                    <span className="text-sm font-semibold text-slate-700">{formatINR(dailySalary)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-red-200">
                  <span className="text-sm font-bold text-red-700">Total Loss of Pay</span>
                  <span className="text-base font-bold text-red-600 tabular-nums">{formatINR(lopAmount)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Management Adjustment */}
          {managementAdjustment !== 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <span className="material-icons text-lg text-blue-600">tune</span>
                Management Adjustment
              </h4>
              <div className={`rounded-xl border px-4 py-3 space-y-2 ${
                managementAdjustment > 0
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Amount</span>
                  <span className={`text-sm font-bold tabular-nums ${
                    managementAdjustment > 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {managementAdjustment > 0 ? '+' : ''}{formatINR(managementAdjustment)}
                  </span>
                </div>
                {deduction?.managementAdjustmentRemarks && (
                  <div className="pt-2 border-t border-slate-200/50">
                    <p className="text-xs text-slate-600 italic">"{deduction.managementAdjustmentRemarks}"</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Calculation Formula */}
          {basicSalary > 0 && (
            <div className="bg-slate-100 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-slate-700 mb-2">CALCULATION FORMULA:</p>
              <code className="text-xs text-slate-600 block">
                Gross Salary = Basic Salary + Extra Pay<br />
                Net Payable = Gross Salary - Loss of Pay {managementAdjustment !== 0 ? '+ Management Adjustment' : ''}
              </code>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
