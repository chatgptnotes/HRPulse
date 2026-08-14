import { useMemo } from 'react';

interface DepartmentPillFiltersProps {
  selected: string;
  onSelect: (department: string) => void;
  departments?: string[];
}

const DEFAULT_DEPARTMENTS = ['All', 'Doctors', 'Nursing', 'Administration', 'Accounts', 'Marketing', 'HR', 'IT'];

export default function DepartmentPillFilters({
  selected,
  onSelect,
  departments = DEFAULT_DEPARTMENTS,
}: DepartmentPillFiltersProps) {
  // Filter out the selected department from the regular list for styling
  const isSelected = (dept: string) => dept === selected;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
      {departments.map((department) => (
        <button
          key={department}
          onClick={() => onSelect(department)}
          className={`
            relative flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200
            ${isSelected(department)
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30'
              : 'bg-white text-slate-600 border border-slate-300 hover:border-purple-400 hover:bg-gradient-to-r hover:from-purple-50 hover:to-indigo-50 hover:text-purple-700'
            }
          `}
        >
          {department}
        </button>
      ))}
    </div>
  );
}
