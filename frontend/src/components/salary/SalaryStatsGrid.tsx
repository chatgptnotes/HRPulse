import SalaryStatCard from './SalaryStatCard';

interface SalarySummary {
  total: number;
  attendance: number;
  lop: number;
  extraPay: number;
  missingSalary: number;
}

interface SalaryStatsGridProps {
  summary: SalarySummary;
}

export default function SalaryStatsGrid({ summary }: SalaryStatsGridProps) {
  return (
    <div className="mb-3 sm:mb-4 md:mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
      <SalaryStatCard
        label="Employees"
        value={summary.total}
        color="from-indigo-500 to-purple-600"
        bgColor="from-indigo-50 to-purple-50"
        textColor="text-slate-800"
        icon="groups"
      />
      <SalaryStatCard
        label="Attendance"
        value={summary.attendance}
        color="from-emerald-500 to-green-600"
        bgColor="from-emerald-50 to-green-50"
        textColor="text-emerald-600"
        icon="how_to_reg"
      />
      <SalaryStatCard
        label="Has LOP"
        value={summary.lop}
        color="from-red-500 to-rose-600"
        bgColor="from-red-50 to-rose-50"
        textColor="text-red-600"
        icon="money_off"
      />
      <SalaryStatCard
        label="Extra Pay"
        value={summary.extraPay}
        color="from-teal-500 to-cyan-600"
        bgColor="from-teal-50 to-cyan-50"
        textColor="text-teal-600"
        icon="payments"
      />
      <SalaryStatCard
        label="Missing Salary"
        value={summary.missingSalary}
        color="from-amber-500 to-orange-600"
        bgColor="from-amber-50 to-orange-50"
        textColor="text-amber-600"
        icon="error_outline"
      />
    </div>
  );
}
