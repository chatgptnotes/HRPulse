interface SalaryStatCardProps {
  label: string;
  value: number;
  color: string;
  bgColor: string;
  textColor: string;
  icon: string;
}

export default function SalaryStatCard({
  label,
  value,
  color,
  bgColor,
  textColor,
  icon,
}: SalaryStatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 transition-all duration-300">
      <div className={`absolute top-0 right-0 h-12 w-12 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-to-br ${bgColor} opacity-50 transition-all group-hover:scale-150`}></div>
      <div className="relative flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br ${color} text-white shadow-md shadow-indigo-500/30`}>
          <span className="material-icons text-sm">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate">{label}</p>
          <p className={`text-sm font-bold ${textColor} tabular-nums`}>{value}</p>
        </div>
      </div>
    </div>
  );
}
