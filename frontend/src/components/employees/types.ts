// Shared types + helpers for the Employee Master feature.

export interface Employee {
  id: number;
  employeeNumber: string;
  name: string;
  email: string;
  mobile: string;
  department: string;
  designation: string;
  shift: string;
  shiftStartTime: string;
  shiftEndTime: string;
  monthlySalary: number;
  status: string;
  paidLeavesEligible: boolean;
  overtimeEligible: boolean;
  photoUrl: string | null;
  createdAt: string;
}

export type DrawerTab = 'overview' | 'salary' | 'attendance' | 'leave' | 'documents';

// Deterministic gradient pick so the same person always gets the same colour.
export const AVATAR_GRADIENTS = [
  'from-indigo-400 to-purple-500',
  'from-emerald-400 to-teal-500',
  'from-rose-400 to-pink-500',
  'from-amber-400 to-orange-500',
  'from-sky-400 to-blue-500',
  'from-violet-400 to-fuchsia-500',
];

export function avatarGradient(name: string): string {
  const code = (name || '?').charCodeAt(0) || 0;
  return AVATAR_GRADIENTS[code % AVATAR_GRADIENTS.length];
}

export const fmtINR = (n: number) =>
  (n == null || isNaN(n)) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
