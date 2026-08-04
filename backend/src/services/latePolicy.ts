export const DEFAULT_SHIFT_START = '09:00';
export const LATE_GRACE_MINUTES = 30;
export const LATE_DAYS_PER_DEDUCTION = 3;

export function attendanceTimeToMinutes(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value > 0 && value < 1) return Math.round(value * 24 * 60);
    if (value >= 1 && value < 100000) {
      const whole = Math.floor(value);
      const fraction = value - whole;
      const hour = whole < 24 ? whole : Math.floor(whole / 100);
      const minute = whole < 24 ? Math.round(fraction * 60) : whole % 100;
      if (hour < 24 && minute < 60) return hour * 60 + minute;
    }
  }

  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour < 24 && minute < 60) return hour * 60 + minute;
  }

  if (/^\d{3,4}$/.test(raw)) {
    const numeric = Number(raw);
    const hour = Math.floor(numeric / 100);
    const minute = numeric % 100;
    if (hour < 24 && minute < 60) return hour * 60 + minute;
  }
  return null;
}

export function isLateExcludedStatus(status: unknown) {
  return /^(absent|absence|awol|weekend|weak end|weekly[ _]off|holiday|leave|paid[ _]leave|annual[ _]leave|sick[ _]leave)$/i
    .test(String(status || '').trim());
}

export function isLateArrival(
  status: unknown,
  timeIn: unknown,
  shiftStart: unknown = DEFAULT_SHIFT_START,
  graceMinutes = LATE_GRACE_MINUTES,
) {
  if (isLateExcludedStatus(status)) return false;
  const punchInMinutes = attendanceTimeToMinutes(timeIn);
  if (punchInMinutes == null) return false;
  const shiftStartMinutes = attendanceTimeToMinutes(shiftStart)
    ?? attendanceTimeToMinutes(DEFAULT_SHIFT_START)!;
  return punchInMinutes > shiftStartMinutes + Math.max(0, graceMinutes);
}

export function classifyLateAttendanceStatus(
  status: string,
  timeIn: unknown,
  shiftStart: unknown = DEFAULT_SHIFT_START,
  graceMinutes = LATE_GRACE_MINUTES,
) {
  if (isLateExcludedStatus(status)) return status;
  if (isLateArrival(status, timeIn, shiftStart, graceMinutes)) return 'Late Coming';
  if (/^(late|late coming)$/i.test(String(status || '').trim())) {
    return attendanceTimeToMinutes(timeIn) == null ? 'Missed Swipe' : 'Normal';
  }
  return status;
}

/**
 * Late-coming salary deduction days.
 * @param lateDays   total late days in the period
 * @param perDeduction  number of late days required for one salary-day deduction
 *                      (defaults to the hardcoded LATE_DAYS_PER_DEDUCTION = 3)
 */
export function lateDeductionDays(lateDays: number, perDeduction = LATE_DAYS_PER_DEDUCTION) {
  const denom = Math.max(1, Number(perDeduction) || LATE_DAYS_PER_DEDUCTION);
  return Math.floor(Math.max(0, Number(lateDays) || 0) / denom);
}
