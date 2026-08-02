import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  label: string;
  value: string | number;
  detail: string;
  detailTone?: 'neutral' | 'positive' | 'warning';
}

export default function EmployeeStatCard({
  icon: Icon,
  label,
  value,
  detail,
  detailTone = 'neutral',
}: Props) {
  const detailClass = detailTone === 'positive'
    ? 'text-emerald-600'
    : detailTone === 'warning'
      ? 'text-amber-600'
      : 'text-slate-500';

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.03em] text-slate-950">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
        </div>
      </div>
      <p className={`mt-4 text-xs font-medium ${detailClass}`}>{detail}</p>
    </article>
  );
}
