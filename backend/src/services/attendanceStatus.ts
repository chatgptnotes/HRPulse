/// Single source of truth for attendance status strings.
///
/// Two vocabularies coexist in `AttendanceRecord.status` and both are permanent:
///
///   * Legacy / Excel import — 'Normal', 'Late Coming', 'Early Leaving',
///     'Absent', 'Missed Swipe', 'Weekend', 'Holiday', 'Official'
///     (excelParser.ts STATUS_MAP)
///   * Biometric engine — 'PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'
///     (attendanceEngine.ts)
///
/// Historic rows keep the legacy values, so translating on write is not an
/// option; everything that reads a status must accept both. Counting lives here
/// rather than being re-derived in each route.

/** Statuses that are NOT an attendance exception. Use with Prisma `notIn`. */
export const NON_FLAGGED_STATUSES = ['Normal', 'Weekend', 'Holiday', 'PRESENT'];

export const ABSENT_STATUSES = ['Absent', 'ABSENT'];
export const MISSED_SWIPE_STATUSES = ['Missed Swipe'];
export const LATE_STATUSES = ['Late Coming', 'LATE'];
export const EARLY_LEAVING_STATUSES = ['Early Leaving'];
export const HALF_DAY_STATUSES = ['HALF_DAY'];
export const PAID_LEAVE_STATUSES = ['Paid Leave', 'Casual Leave', 'Sick Leave', 'CL', 'SL', 'PL'];

/**
 * Payroll uses a fixed 30-day month. The 31st remains in attendance history,
 * but is outside the payroll period and must not create LOP or rule penalties.
 */
export function isPayrollDeductibleDate(date: Date | string): boolean {
  const value = typeof date === 'string' ? new Date(date) : date;
  return !Number.isNaN(value.getTime()) && value.getUTCDate() !== 31;
}

/** Every exception status, for `in` filters and `includes` checks. */
export const FLAGGED_STATUSES = [
  ...ABSENT_STATUSES,
  ...PAID_LEAVE_STATUSES,
  ...MISSED_SWIPE_STATUSES,
  ...LATE_STATUSES,
  ...EARLY_LEAVING_STATUSES,
  ...HALF_DAY_STATUSES,
];

export interface AttendanceCounts {
  absentDays: number;
  paidLeaveDays: number;
  /** Absences covered by paid leave allowance (should NOT show in Absent Days column) */
  protectedAbsentDays: number;
  /** Unpaid absences beyond allowance (what "Absent Days" should show) */
  chargeableAbsentDays: number;
  missedSwipeDays: number;
  lateComingDays: number;
  earlyLeavingDays: number;
  /** Biometric-only: worked less than the half-day threshold for the shift. */
  halfDays: number;
  /** Sum of all five. Half days are included — they are an exception too. */
  flaggedTotal: number;
  /** Statuses matching no known bucket, surfaced rather than silently dropped. */
  unknownStatuses: string[];
}

/**
 * Fold a status string onto a bucket, tolerant of case and of the
 * space/underscore difference between the two vocabularies. 'HALF_DAY',
 * 'Half Day' and 'half day' all land on the same bucket.
 */
function bucketFor(status: string): keyof Omit<AttendanceCounts, 'flaggedTotal' | 'unknownStatuses'> | 'none' | 'unknown' {
  switch (status.toUpperCase().replace(/[\s_-]/g, '')) {
    case 'ABSENT':
      return 'absentDays';
    case 'PAIDLEAVE':
    case 'CASUALLEAVE':
    case 'SICKLEAVE':
    case 'CL':
    case 'SL':
    case 'PL':
      return 'paidLeaveDays';
    case 'MISSEDSWIPE':
    case 'INCOMPLETE':
      return 'missedSwipeDays';
    case 'LATECOMING':
    case 'LATE':
      return 'lateComingDays';
    case 'EARLYLEAVING':
    case 'EARLYLEAVE':
      return 'earlyLeavingDays';
    case 'HALFDAY':
      return 'halfDays';
    case 'NORMAL':
    case 'PRESENT':
    case 'WEEKEND':
    case 'HOLIDAY':
    case 'OFFICIAL':
      return 'none';
    default:
      return 'unknown';
  }
}

/** Count exception days across a set of records, in either vocabulary. */
export function countStatuses(records: Array<{ status: string }>): AttendanceCounts {
  const counts: AttendanceCounts = {
    absentDays: 0,
    paidLeaveDays: 0,
    protectedAbsentDays: 0,
    chargeableAbsentDays: 0,
    missedSwipeDays: 0,
    lateComingDays: 0,
    earlyLeavingDays: 0,
    halfDays: 0,
    flaggedTotal: 0,
    unknownStatuses: [],
  };

  const unknown = new Set<string>();

  for (const record of records) {
    const bucket = bucketFor(record.status);
    if (bucket === 'unknown') {
      unknown.add(record.status);
      continue;
    }
    if (bucket === 'none') continue;
    counts[bucket]++;
  }

  counts.flaggedTotal =
    counts.chargeableAbsentDays +
    counts.paidLeaveDays +
    counts.missedSwipeDays +
    counts.lateComingDays +
    counts.earlyLeavingDays +
    counts.halfDays;

  counts.unknownStatuses = [...unknown];
  return counts;
}

/** True when the status represents an attendance exception. */
export function isFlagged(status: string): boolean {
  const bucket = bucketFor(status);
  return bucket !== 'none' && bucket !== 'unknown';
}
