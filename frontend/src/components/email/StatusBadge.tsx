import clsx from 'clsx';

const STATUS_COLORS: Record<string, string> = {
  'Absent': 'bg-red-100 text-red-700 border-red-200',
  'Missed Swipe': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Late Coming': 'bg-blue-100 text-blue-700 border-blue-200',
  'Early Leaving': 'bg-amber-100 text-amber-700 border-amber-200',
  'Normal': 'bg-green-50 text-green-600 border-green-100',
  'Weekend': 'bg-slate-100 text-slate-500 border-slate-200',
  'Holiday': 'bg-purple-50 text-purple-600 border-purple-100',
  'pending': 'bg-slate-100 text-slate-500 border-slate-200',
  'sent': 'bg-green-100 text-green-700 border-green-200',
  'failed': 'bg-red-100 text-red-700 border-red-200',
};

export default function StatusBadge({ label, small }: { label: string; small?: boolean }) {
  const cls = STATUS_COLORS[label] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={clsx('inline-flex items-center rounded-full border font-medium', small ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs', cls)}>
      {label}
    </span>
  );
}
