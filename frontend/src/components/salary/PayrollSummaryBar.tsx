import { formatINR } from '../../lib/dayWiseSalary';

interface PayrollSummaryBarProps {
  totalPayroll: number;
  netPayable: number;
  totalExtraPay: number;
  totalLopAmount: number;
}

export default function PayrollSummaryBar({
  totalPayroll,
  netPayable,
  totalExtraPay,
  totalLopAmount,
}: PayrollSummaryBarProps) {
  const cards = [
    {
      label: 'Total Payroll',
      value: totalPayroll,
      color: 'from-purple-500 to-indigo-600',
      bgColor: 'from-purple-50 to-indigo-50',
      textColor: 'text-purple-700',
      icon: 'account_balance_wallet',
    },
    {
      label: 'Net Payable',
      value: netPayable,
      color: 'from-emerald-500 to-green-600',
      bgColor: 'from-emerald-50 to-green-50',
      textColor: 'text-emerald-700',
      icon: 'payments',
    },
    {
      label: 'Extra Pay',
      value: totalExtraPay,
      color: 'from-teal-500 to-cyan-600',
      bgColor: 'from-teal-50 to-cyan-50',
      textColor: 'text-teal-700',
      icon: 'trending_up',
    },
    {
      label: 'Loss Of Pay',
      value: totalLopAmount,
      color: 'from-red-500 to-rose-600',
      bgColor: 'from-red-50 to-rose-50',
      textColor: 'text-red-700',
      icon: 'money_off',
    },
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:mb-6 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white px-2 py-2 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md sm:rounded-xl sm:px-5 sm:py-4"
        >
          <div className="absolute top-0 right-0 h-20 w-20 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-to-br opacity-30 transition-all group-hover:scale-125 from-slate-100 to-slate-200" />
          <div className="relative">
            <div className="mb-1 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
              <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${card.color} text-white shadow-md sm:h-8 sm:w-8 sm:rounded-lg`}>
                <span className="material-icons text-sm sm:text-lg">{card.icon}</span>
              </div>
              <p className="truncate text-[9px] font-semibold uppercase leading-tight tracking-wider text-slate-500 sm:text-xs">{card.label}</p>
            </div>
            <p className={`text-lg font-bold leading-tight ${card.textColor} tabular-nums sm:text-2xl`}>
              {formatINR(card.value)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
