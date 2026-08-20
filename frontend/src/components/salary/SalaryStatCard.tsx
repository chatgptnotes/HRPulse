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
    <div className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white px-2 py-2 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-200/50 sm:rounded-xl sm:px-3 sm:py-2.5">
      <div className={`absolute top-0 right-0 h-12 w-12 -translate-y-1/2 translate-x-1/2 rounded-full bg-gradient-to-br ${bgColor} opacity-50 transition-all group-hover:scale-150`}></div>
      <div className="relative flex items-center gap-1.5 sm:gap-2">
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-gradient-to-br ${color} text-white shadow-md shadow-indigo-500/30 sm:h-8 sm:w-8`}>
          <span className="material-icons text-[13px] sm:text-sm">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-[9px] font-semibold uppercase leading-tight tracking-wider text-slate-400 sm:text-[10px]">{label}</p>
          <p className={`text-[13px] font-bold leading-tight ${textColor} tabular-nums sm:text-sm`}>{value}</p>
        </div>
      </div>
    </div>
  );
}
