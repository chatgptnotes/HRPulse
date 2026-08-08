// Day-by-day attribution of a month's pay.
//
// getSalaryDeductions (api/index.ts) only ever returns monthly totals — how many
// days were absent, how much was cut. This walks the same records the same way
// and says which date each rupee belongs to, so a salary screen can show the
// month line by line. The per-day rules below mirror api/index.ts:749-830; if
// that engine changes, this has to change with it, and the reconcile flag is the
// safety net when it does not.

import { canonicalStatus } from './status';

export const formatINR = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const isSunday = (value: unknown) => {
  const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 0;
};

export const dayName = (value: unknown) =>
  new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

const timeInMinutes = (value: unknown) => {
  const text = String(value || '');
  const match = text.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getHours() * 60 + parsed.getMinutes();
};

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};

export type DayLine = {
  date: string;
  day: string;
  status: string;
  timeIn: string | null;
  timeOut: string | null;
  /** Days credited by the engine's shift ladder — 0, 0.5, 1, 1.5 or 2. */
  credit: number;
  /** Rupees credited for this date. */
  earned: number;
  /** Rupees cut on this date. */
  deducted: number;
  /** Why the cut happened, or why an absence cost nothing. '' when ordinary. */
  why: string;
};

export type DayWiseSalary = {
  lines: DayLine[];
  totalEarned: number;
  totalDeducted: number;
  /** The per-date cuts add up to the engine's headline. False means do not show them. */
  reconciles: boolean;
};

export function buildDayWiseSalary(records: any[], ded: any, emp: any): DayWiseSalary {
  const rate = Number(ded?.dailySalary || 0);
  const rafttarStaff = ded?.rafttarStaff === true;
  const contracted = emp?.contracted_hours == null ? null : Number(emp.contracted_hours);
  const halfBelow = contracted ? contracted / 2 : (rafttarStaff ? Number(ded?.halfDayHours || 4) : 7);
  const shift = contracted || 8;
  const lateAfterMinutes = Number(ded?.lateAfterMinutes || 570);

  type Working = DayLine & { isAbsent: boolean; isHalf: boolean; isLate: boolean; isPaidLeave: boolean };

  const lines: Working[] = [];
  const sorted = [...(records || [])].sort((a, b) => String(a.recordDate).localeCompare(String(b.recordDate)));

  // Pass 1 — what each day earned, following the engine's ladder.
  for (const row of sorted) {
    const status = String(row.status || '').trim().toLowerCase();
    const line: Working = {
      date: String(row.recordDate).slice(0, 10),
      day: dayName(row.recordDate),
      status: String(row.status || ''),
      timeIn: row.timeIn || null,
      timeOut: row.timeOut || null,
      credit: 0,
      earned: 0,
      deducted: 0,
      why: '',
      isAbsent: false,
      isHalf: false,
      isLate: false,
      isPaidLeave: false,
    };

    // A Rafttar Sunday is a paid weekly off — credited whether or not anyone
    // punched, and it never reaches the absence rules below.
    if (rafttarStaff && isSunday(row.recordDate)) {
      line.credit = 1;
      line.why = 'Paid weekly off';
      lines.push(line);
      continue;
    }

    const workingDay = !['absent', 'weekend', 'holiday', 'paid leave'].includes(status);
    const hours = row.work_hours === null || row.work_hours === undefined ? null : Number(row.work_hours);

    if (workingDay && hours !== null) {
      if (rafttarStaff) {
        line.credit = 1;
        if (hours < halfBelow) line.isHalf = true;
      } else {
        line.credit = hours >= shift * 2 ? 2
          : hours >= shift * 1.5 ? 1.5
          : hours < halfBelow ? 0.5
          : 1;
        if (line.credit === 0.5) line.isHalf = true;
      }
    } else if (canonicalStatus(status) === 'Missed Swipe' || ['normal', 'present', 'late', 'late coming', 'early leaving'].includes(status)) {
      // Present, but with no usable punch span to measure. Full duty.
      line.credit = 1;
    }
    if (status === 'half_day' || status === 'half day') line.credit += 0.5;

    if (status === 'absent') line.isAbsent = true;
    if (status.includes('late') || (() => { const m = timeInMinutes(row.time_in); return m !== null && m > lateAfterMinutes; })()) line.isLate = true;
    if (status.includes('paid leave') || status.includes('casual leave') || status.includes('sick leave')) line.isPaidLeave = true;

    line.earned = line.credit * rate;
    lines.push(line);
  }

  // Pass 2 — spread the four monthly charges over the dates that caused them.
  // The engine only counts these, so which particular day consumed the
  // allowance is a presentation choice: chronological, and the label says so.
  const allowance = Number(ded?.protectedAbsentDays || 0);
  let covered = 0;
  for (const line of lines) {
    if (!line.isAbsent) continue;
    if (covered < allowance) {
      covered++;
      line.earned = rate;
      line.why = `Absent — covered by paid leave (${covered} of ${allowance})`;
    } else {
      line.earned = 0;
      line.deducted = rate;
      line.why = 'Absent — allowance already used';
    }
  }

  for (const line of lines) {
    if (!line.isHalf) continue;
    line.deducted += rate * 0.5;
    line.why = line.why || 'Half day — short of half the shift';
  }

  // Every lateEvery-th late arrival costs a day. Charged on the date that
  // completed the set, so the count on screen matches lateDeductionCount.
  const lateEvery = Math.max(1, Number(ded?.lateEvery || 3));
  const lateBudget = Number(ded?.lateDeductionCount || 0);
  let lateSeen = 0;
  let lateCharged = 0;
  for (const line of lines) {
    if (!line.isLate) continue;
    lateSeen++;
    if (lateSeen % lateEvery !== 0 || lateCharged >= lateBudget) continue;
    lateCharged++;
    line.deducted += rate;
    line.why = `${ordinal(lateSeen)} late arrival — one day cut`;
  }

  // Paid leave past the monthly allowance is charged, oldest first.
  const excessBudget = Number(ded?.excessPaidLeave || 0);
  const leaveLimit = Number(ded?.leaveLimit || 0);
  let leaveSeen = 0;
  let leaveCharged = 0;
  for (const line of lines) {
    if (!line.isPaidLeave) continue;
    leaveSeen++;
    if (leaveSeen <= leaveLimit || leaveCharged >= excessBudget) continue;
    leaveCharged++;
    line.deducted += rate;
    line.why = 'Leave beyond the monthly allowance';
  }

  const clean: DayLine[] = lines.map(({ isAbsent: _a, isHalf: _h, isLate: _l, isPaidLeave: _p, ...line }) => line);
  const totalEarned = clean.reduce((sum, l) => sum + l.earned, 0);
  const totalDeducted = clean.reduce((sum, l) => sum + l.deducted, 0);

  // A per-date list that disagrees with the headline would be worse than none.
  // It can happen legitimately: the engine walks every record in the calendar
  // month, while the modal only has the rows of one import.
  const reconciles = Math.abs(totalDeducted - Number(ded?.lopAmount || 0)) <= 1;

  return { lines: clean, totalEarned, totalDeducted, reconciles };
}
