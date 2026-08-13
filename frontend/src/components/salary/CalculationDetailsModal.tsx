import { formatINR } from '../../lib/dayWiseSalary';

interface CalculationDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeName: string;
  employeeId: string;
  designation?: string;
  basicSalary: number;
  extraPayableDays?: number | null;
  extraPaymentAmount?: number | null;
  lopAmount?: number | null;
  managementAdjustment?: number | null;
  managementAdjustmentRemarks?: string | null;
  netPayable: number;
  perDaySalary?: number;
  daysPresent?: number;
  totalDays?: number;
}

export default function CalculationDetailsModal({
  isOpen,
  onClose,
  employeeName,
  employeeId,
  designation,
  basicSalary,
  extraPayableDays,
  extraPaymentAmount,
  lopAmount,
  managementAdjustment,
  managementAdjustmentRemarks,
  netPayable,
  perDaySalary,
  daysPresent,
  totalDays,
}: CalculationDetailsModalProps) {
  if (!isOpen) return null;

  const grossSalary = basicSalary + (extraPaymentAmount || 0);

  const hasExtraDays = (extraPayableDays ?? 0) > 0;
  const hasLOP = (lopAmount ?? 0) > 0;
  const hasManagementAdjustment = (managementAdjustment ?? 0) !== 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Salary Calculation Details</h2>
            <p className="text-sm text-slate-600 mt-0.5">Complete breakdown of payable amount</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-600 hover:text-slate-800"
            aria-label="Close"
          >
            <span className="material-icons text-2xl">close</span>
          </button>
        </div>

        {/* Employee Info */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Employee:</span>
              <p className="font-semibold text-slate-800 mt-0.5">{employeeName}</p>
            </div>
            <div>
              <span className="text-slate-500">Employee ID:</span>
              <p className="font-semibold text-slate-800 mt-0.5">{employeeId}</p>
            </div>
            {designation && (
              <div className="col-span-2">
                <span className="text-slate-500">Designation:</span>
                <p className="font-semibold text-slate-800 mt-0.5">{designation}</p>
              </div>
            )}
          </div>
        </div>

        {/* Calculation Breakdown */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {/* Basic Salary */}
            <div className="flex justify-between items-center py-3 border-b border-dashed border-slate-300">
              <div>
                <p className="font-semibold text-slate-800">Basic Monthly Salary</p>
                {perDaySalary && (
                  <p className="text-xs text-slate-500 mt-0.5">₹{perDaySalary.toFixed(2)}/day × {totalDays || 30} days</p>
                )}
              </div>
              <span className="font-bold text-lg text-slate-800">{formatINR(basicSalary)}</span>
            </div>

            {/* Extra Days Bonus */}
            {hasExtraDays && (
              <div className="flex justify-between items-center py-3 border-b border-dashed border-slate-300">
                <div>
                  <p className="font-semibold text-emerald-700">Extra Days Bonus</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {extraPayableDays} extra day{extraPayableDays === 1 ? '' : 's'} worked
                    {daysPresent && ` (Total present: ${daysPresent} days)`}
                  </p>
                </div>
                <div className="text-right">
                  <span className="font-bold text-lg text-emerald-600">+{formatINR(extraPaymentAmount || 0)}</span>
                  {perDaySalary && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      ₹{perDaySalary.toFixed(2)} × {extraPayableDays}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Gross Salary */}
            <div className="flex justify-between items-center py-3 bg-blue-50 px-4 rounded-lg border border-blue-200">
              <p className="font-bold text-blue-800">Gross Salary</p>
              <span className="font-bold text-lg text-blue-700">{formatINR(grossSalary)}</span>
            </div>

            {/* Loss of Pay Deduction */}
            {hasLOP && (
              <div className="flex justify-between items-center py-3 border-b border-dashed border-slate-300">
                <div>
                  <p className="font-semibold text-red-600">Loss of Pay Deduction</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {perDaySalary && lopAmount && perDaySalary > 0
                      ? `${Math.abs(Math.round(lopAmount / perDaySalary))} day(s) absent`
                      : 'Unpaid absence'}
                  </p>
                </div>
                <span className="font-bold text-lg text-red-600">-{formatINR(lopAmount || 0)}</span>
              </div>
            )}

            {/* Management Adjustment */}
            {hasManagementAdjustment && (
              <div className={`flex justify-between items-start py-3 border-b border-dashed border-slate-300`}>
                <div className="flex-1">
                  <p className={`font-semibold ${managementAdjustment! > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    Management Adjustment
                  </p>
                  {managementAdjustmentRemarks && (
                    <p className="text-xs text-slate-600 mt-0.5 italic bg-slate-50 px-2 py-1 rounded max-w-xs">
                      "{managementAdjustmentRemarks}"
                    </p>
                  )}
                </div>
                <span className={`font-bold text-lg ${managementAdjustment! > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {managementAdjustment! > 0 ? '+' : ''}{formatINR(managementAdjustment || 0)}
                </span>
              </div>
            )}

            {/* Net Payable - Final */}
            <div className="flex justify-between items-center py-4 bg-emerald-50 px-4 rounded-lg border-2 border-emerald-300 mt-4">
              <p className="font-bold text-emerald-800 text-lg">Net Payable</p>
              <span className="font-black text-2xl text-emerald-700">{formatINR(netPayable)}</span>
            </div>

            {/* Formula Summary */}
            <div className="mt-6 p-4 bg-slate-100 rounded-lg">
              <p className="text-xs text-slate-500 mb-2 font-semibold">CALCULATION FORMULA:</p>
              <code className="text-xs text-slate-700 block">
                Gross Salary = Basic Salary + Extra Days Bonus
                <br />
                Net Payable = Gross Salary - Loss of Pay {hasManagementAdjustment && '+ Management Adjustment'}
              </code>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
