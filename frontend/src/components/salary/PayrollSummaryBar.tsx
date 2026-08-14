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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group"
        >
          <div className="absolute top-0 right-0 h-20 w-20 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-to-br opacity-30 transition-all group-hover:scale-125 from-slate-100 to-slate-200" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${card.color} text-white shadow-md`}>
                <span className="material-icons text-lg">{card.icon}</span>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{card.label}</p>
            </div>
            <p className={`text-2xl font-bold ${card.textColor} tabular-nums`}>
              {formatINR(card.value)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
