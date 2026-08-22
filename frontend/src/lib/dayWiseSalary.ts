// Day-by-day attribution of a month's pay.
//
// getSalaryDeductions (api/index.ts) only ever returns monthly totals — how many
// days were absent, how much was cut. This walks the same records the same way
// and says which date each rupee belongs to, so a salary screen can show the
// month line by line. The per-day rules below mirror the crediting ladder in
// getSalaryDeductions; if that engine changes, this has to change with it, and
// the reconcile flag is the safety net when it does not.

import { canonicalStatus } from './status';

export const formatINR = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const isSunday = (value: unknown) => {
  const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 0;
};

export const dayName = (value: unknown) =>
  new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

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
  /** Overtime hours worked on this date (hospital staff only). */
  overtimeHours?: number;
};

export type DayWiseSalary = {
  lines: DayLine[];
  totalEarned: number;
  totalDeducted: number;
  /** Leave allowance never taken, paid out at month end. Belongs to no one date. */
  unusedLeaveDays: number;
  unusedLeavePay: number;
  /** The per-date cuts add up to the engine's headline. False means do not show them. */
  reconciles: boolean;
  /** Total overtime hours for hospital staff. */
  totalOvertimeHours: number;
  /** Kept as a zero-valued compatibility field for existing callers. */
  totalOvertimePay: number;
};

export function buildDayWiseSalary(records: any[], ded: any, emp: any): DayWiseSalary {
  const rate = Number(ded?.dailySalary || 0);
  const rafttarStaff = ded?.rafttarStaff === true;
  // Under four hours is half a day for everyone.
  const halfBelow = Number(ded?.halfDayHours || 4);

  type Working = DayLine & { isAbsent: boolean; isHalf: boolean; isPaidLeave: boolean };

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
      isPaidLeave: false,
    };

    const hours = row.work_hours === null || row.work_hours === undefined ? null : Number(row.work_hours);

    // A Rafttar Sunday is a paid weekly off — credited whether or not anyone
    // punched, and it never reaches the absence rules below. Coming in anyway
    // means the off was worked rather than taken, and earns a second day's pay.
    if (rafttarStaff && isSunday(row.recordDate)) {
      const attended = (row.time_in != null || Number(row.work_hours || 0) > 0)
        && !['absent', 'holiday', 'paid leave'].includes(status);
      const extra = !attended ? 0 : hours !== null && hours < halfBelow ? 0.5 : 1;
      line.credit = 1 + extra;
      line.earned = line.credit * rate;
      line.why = extra ? 'Worked on weekly off — extra day paid' : 'Paid weekly off';
      lines.push(line);
      continue;
    }

    const workingDay = !['absent', 'weekend', 'holiday', 'paid leave'].includes(status);

    if (workingDay && hours !== null) {
      if (rafttarStaff) {
        line.credit = 1;
        if (hours < halfBelow) line.isHalf = true;
      } else {
        // Extra hours do not create an additional attendance or payable day.
        line.credit = hours < halfBelow ? 0.5 : 1;
        if (line.credit === 0.5) line.isHalf = true;
      }
    } else if (canonicalStatus(status) === 'Missed Swipe' || ['normal', 'present', 'late', 'late coming', 'early leaving'].includes(status)) {
      // Present, but with no usable punch span to measure. Full duty.
      line.credit = 1;
    } else if (['holiday', 'weekend'].includes(status) || canonicalStatus(status) === 'Official') {
      // Paid days nobody punches for — mirrors the engine, which has to credit
      // them explicitly now that pay is counted up from the days owed.
      line.credit = 1;
    }
    if (status === 'half_day' || status === 'half day') line.credit += 0.5;

    if (status === 'absent') line.isAbsent = true;
    if (status.includes('paid leave') || status.includes('casual leave') || status.includes('sick leave')) line.isPaidLeave = true;

    // The ladder still shows an extra shift as 1.5 or 2 days of duty, but a day
    // is only ever worth a day's pay — the engine caps it the same way.
    // For half-day, we credit full day and let deduction reduce it (not double-penalize)
    line.earned = line.credit < 1 ? rate : Math.min(line.credit, 1) * rate;
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

  // Lateness used to cost a day for every third occurrence. It no longer costs
  // anything in any month, so no date carries a late charge.

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

  const clean: DayLine[] = lines.map(({ isAbsent: _a, isHalf: _h, isPaidLeave: _p, ...line }) => line);
  const totalEarned = clean.reduce((sum, l) => sum + l.earned, 0);
  const totalDeducted = clean.reduce((sum, l) => sum + l.deducted, 0);
  const totalOvertimeHours = 0;
  const totalOvertimePay = 0;

  // A per-date list that disagrees with the headline would be worse than none.
  // It can happen legitimately: the engine walks every record in the calendar
  // month, while the modal only has the rows of one import.
  const reconciles = Math.abs(totalDeducted - Number(ded?.lopAmount || 0)) <= 1;

  // Unused leave has no date to sit on — it is the allowance that was never
  // drawn — so it travels beside the lines for the caller to show as a footer.
  const unusedLeaveDays = Number(ded?.unusedLeaveDays || 0);

  return { lines: clean, totalEarned, totalDeducted, unusedLeaveDays, unusedLeavePay: unusedLeaveDays * rate, reconciles, totalOvertimeHours, totalOvertimePay };
}
