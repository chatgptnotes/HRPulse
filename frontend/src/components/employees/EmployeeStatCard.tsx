import clsx from 'clsx';

type Tone = 'indigo' | 'emerald' | 'slate' | 'sky' | 'amber';

const TONE_BG: Record<Tone, string> = {
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  slate: 'bg-slate-400',
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
};

interface Props {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
}

// Summary card used at the top of the Employee Master page.
export default function EmployeeStatCard({ icon, label, value, sub, tone = 'indigo' }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm', TONE_BG[tone])}>
          <span className="material-icons text-white text-xl">{icon}</span>
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-slate-800 leading-none">{value}</p>
          <p className="text-xs text-slate-500 mt-1.5 truncate">{label}</p>
          {sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
