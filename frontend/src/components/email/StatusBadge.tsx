import clsx from 'clsx';

const STATUS_COLORS: Record<string, string> = {
  'Absent': 'bg-red-100 text-red-700 border-red-200',
  'Missed Swipe': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Late Coming': 'bg-blue-100 text-blue-700 border-blue-200',
  'Early Leaving': 'bg-amber-100 text-amber-700 border-amber-200',
  'Normal': 'bg-green-50 text-green-600 border-green-100',
  'Weekend': 'bg-slate-100 text-slate-500 border-slate-200',
  'Holiday': 'bg-purple-50 text-purple-600 border-purple-100',
  'half_day': 'bg-orange-100 text-orange-700 border-orange-200',
  'paid weekly off': 'bg-sky-50 text-sky-700 border-sky-100',
  'worked weekly off': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  'paid leave': 'bg-teal-50 text-teal-700 border-teal-100',
  'official': 'bg-indigo-50 text-indigo-600 border-indigo-100',
  'pending': 'bg-slate-100 text-slate-500 border-slate-200',
  'sent': 'bg-green-100 text-green-700 border-green-200',
  'failed': 'bg-red-100 text-red-700 border-red-200',
};

export default function StatusBadge({ label, small, compact }: { label: string; small?: boolean; compact?: boolean }) {
  // Status casing is not guaranteed by older imports, so match on a folded key.
  const key = String(label ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  const entry = Object.entries(STATUS_COLORS).find(([k]) => k.toLowerCase().replace(/[_-]+/g, ' ').trim() === key);
  const cls = entry?.[1] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={clsx('inline-flex shrink-0 items-center rounded-full border font-medium', compact ? 'px-1.5 py-0 text-[10px] leading-4' : small ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs', cls)}>
      {label}
    </span>
  );
}
