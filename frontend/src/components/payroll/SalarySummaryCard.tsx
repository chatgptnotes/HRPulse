import clsx from 'clsx';
import { fmtINR } from './format';

interface Props {
  gross: number;
  deductions: number;
  net: number;
}

function Item({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: 'emerald' | 'red' | 'indigo' }) {
  const tones: Record<string, string> = {
    emerald: 'from-emerald-500 to-teal-500',
    red: 'from-rose-500 to-red-500',
    indigo: 'from-indigo-500 to-purple-500',
  };
  return (
    <div className="flex-1 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className={clsx('w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3 shadow-sm', tones[tone])}>
        <span className="material-icons text-white text-lg">{icon}</span>
      </div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className={clsx('text-xl font-bold mt-0.5', tone === 'red' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-700' : 'text-indigo-700')}>
        ₹ {value}
      </p>
    </div>
  );
}

// Salary summary trio: Gross / Deductions / Net payable for the loaded run.
export default function SalarySummaryCard({ gross, deductions, net }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">Salary Summary</h3>
        <span className="material-icons text-slate-300 text-base">account_balance_wallet</span>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Item icon="payments" label="Gross Salary" value={fmtINR(gross)} tone="emerald" />
        <Item icon="remove_circle" label="Total Deductions" value={fmtINR(deductions)} tone="red" />
        <Item icon="account_balance" label="Net Payable" value={fmtINR(net)} tone="indigo" />
      </div>
    </div>
  );
}
