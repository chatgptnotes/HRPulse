import prisma from '../db/prisma';
import type { Shift, BiometricPunch } from '@prisma/client';
import { toDateOnly, fromDateOnly } from '../utils/date';
import {
  shiftWindow,
  loadAssignments,
  selectAssignmentForDate,
  eachDateInRange,
  type AssignmentWithShift,
} from './shiftService';

/// ── STATUS VOCABULARY ───────────────────────────────────────────────────────
///
/// This engine writes PRESENT / LATE / HALF_DAY / ABSENT, while the Excel
/// pipeline writes 'Normal' / 'Late Coming' / 'Absent' / 'Missed Swipe' /
/// 'Early Leaving'. Both are permanent — historic rows keep the legacy values.
///
/// Every consumer now counts through `attendanceStatus.ts`, which folds the two
/// vocabularies onto the same buckets, so a day evaluated here reaches LOP and
/// the rule engine exactly like an imported one. Do NOT compare
/// `AttendanceRecord.status` to a bare string literal anywhere; use
/// `countStatuses` / `isFlagged` / the exported status lists instead.
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT';

/**
 * Nearest legacy equivalent of each engine status, for display and reporting.
 * HALF_DAY has none — it is a concept the Excel vocabulary cannot express, which
 * is why it is carried as its own bucket and its own LOP weight
 * (`half_day_lop_weight`) rather than being folded into an existing status.
 */
export const LEGACY_STATUS_EQUIVALENT: Record<AttendanceStatus, string | null> = {
  PRESENT: 'Normal',
  LATE: 'Late Coming',
  ABSENT: 'Absent',
  HALF_DAY: null,
};

/** Fraction of the scheduled shift below which a day counts as a half day. */
export const DEFAULT_HALF_DAY_RATIO = 0.5;

export interface DayEvaluation {
  status: AttendanceStatus;
  timeIn: Date | null;
  timeOut: Date | null;
  lateMinutes: number;
  earlyMinutes: number;
  /** Minutes actually worked, or null when the OUT punch is missing. */
  workedMinutes: number | null;
  /** True when punches exist but no OUT was recorded — the old "Missed Swipe". */
  missingPunch: boolean;
}

type PunchLike = Pick<BiometricPunch, 'punchTime' | 'punchType'>;
type ShiftLike = Pick<Shift, 'startTime' | 'endTime' | 'graceMinutes' | 'isOvernight'>;

/**
 * Evaluate one employee-day. Pure — no database, no clock, no timezone lookup —
 * so it is directly unit-testable.
 *
 * Pairing rule: earliest IN and latest OUT of the day. Multiple in/out pairs
 * (breaks, stepping out) collapse into one span; the time between them counts as
 * worked. A stricter sum-of-pairs model would need a policy decision on breaks.
 */
export function evaluateDay(shift: ShiftLike, punches: PunchLike[], recordDate: Date, halfDayRatio: number = DEFAULT_HALF_DAY_RATIO): DayEvaluation {
  const window = shiftWindow(shift, recordDate);

  if (punches.length === 0) {
    return {
      status: 'ABSENT',
      timeIn: null,
      timeOut: null,
      lateMinutes: 0,
      earlyMinutes: 0,
      workedMinutes: null,
      missingPunch: false,
    };
  }

  const sorted = [...punches].sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
  const ins = sorted.filter(p => p.punchType === 'IN');
  const outs = sorted.filter(p => p.punchType === 'OUT');

  // Fall back to raw ordering when the device does not label punch direction.
  const timeIn = (ins[0] ?? sorted[0]).punchTime;
  const lastOut = outs.length ? outs[outs.length - 1].punchTime : null;
  const timeOut = lastOut && lastOut.getTime() > timeIn.getTime() ? lastOut : null;

  const lateMinutes = Math.max(0, Math.round((timeIn.getTime() - window.graceCutoff.getTime()) / 60_000));

  const earlyMinutes = timeOut
    ? Math.max(0, Math.round((window.end.getTime() - timeOut.getTime()) / 60_000))
    : 0;

  const workedMinutes = timeOut
    ? Math.round((timeOut.getTime() - timeIn.getTime()) / 60_000)
    : null;

  let status: AttendanceStatus;
  if (workedMinutes !== null && workedMinutes < window.durationMinutes * halfDayRatio) {
    status = 'HALF_DAY';
  } else if (lateMinutes > 0) {
    status = 'LATE';
  } else {
    status = 'PRESENT';
  }

  return {
    status,
    timeIn,
    timeOut,
    lateMinutes,
    earlyMinutes,
    workedMinutes,
    missingPunch: timeOut === null,
  };
}

export interface ProcessOptions {
  /** Inclusive "yyyy-MM-dd". */
  from: string;
  /** Inclusive "yyyy-MM-dd". */
  to: string;
  /** Restrict to these employees; omit for everyone with a shift assignment. */
  employeeIds?: number[];
  /**
   * Write ABSENT rows for assigned days with no punches at all.
   *
   * OFF by default and it must stay that way until there is a working-calendar
   * model. HR Pulse has no weekday mask, no holiday table and no leave table
   * (`working_days` is a single count, not a calendar), so enabling this marks
   * every weekend and public holiday as an absence — which becomes an unearned
   * salary deduction the moment these rows reach payroll.
   */
  markAbsent?: boolean;
  halfDayRatio?: number;
}

export interface ProcessResult {
  from: string;
  to: string;
  employeesProcessed: number;
  daysEvaluated: number;
  recordsWritten: number;
  absentDaysMarked: number;
  skippedNoShift: Array<{ employeeId: number; date: string }>;
  statusCounts: Record<AttendanceStatus, number>;
}

/**
 * Derive AttendanceRecord rows from BiometricPunch for a date range.
 *
 * Idempotent: every write is an upsert on the (employeeId, recordDate) unique
 * key, so replaying the same punch stream corrects rows rather than duplicating
 * them.
 */
export async function processPunchesForRange(options: ProcessOptions): Promise<ProcessResult> {
  const { from, to, employeeIds, markAbsent = false, halfDayRatio = DEFAULT_HALF_DAY_RATIO } = options;

  const dates = eachDateInRange(from, to);
  const rangeStart = fromDateOnly(from);
  const rangeEnd = new Date(fromDateOnly(to).getTime() + 24 * 60 * 60 * 1000);

  // Everyone with a shift assignment is in scope; punches alone are not enough,
  // because an absent day has no punch to find.
  const assignmentRows = await prisma.employeeShift.findMany({
    where: employeeIds?.length ? { employeeId: { in: employeeIds } } : undefined,
    select: { employeeId: true },
    distinct: ['employeeId'],
  });
  const scopedIds = assignmentRows.map(r => r.employeeId);

  const result: ProcessResult = {
    from,
    to,
    employeesProcessed: scopedIds.length,
    daysEvaluated: 0,
    recordsWritten: 0,
    absentDaysMarked: 0,
    skippedNoShift: [],
    statusCounts: { PRESENT: 0, LATE: 0, HALF_DAY: 0, ABSENT: 0 },
  };

  if (scopedIds.length === 0) return result;

  const assignments = await loadAssignments(scopedIds);

  const punches = await prisma.biometricPunch.findMany({
    where: { employeeId: { in: scopedIds }, punchTime: { gte: rangeStart, lt: rangeEnd } },
    orderBy: { punchTime: 'asc' },
  });

  // Bucket punches by employee + calendar day of the punch itself.
  const buckets = new Map<string, BiometricPunch[]>();
  for (const punch of punches) {
    const key = `${punch.employeeId}|${toDateOnly(punch.punchTime)}`;
    const list = buckets.get(key) ?? [];
    list.push(punch);
    buckets.set(key, list);
  }

  const uploadCache = new Map<string, number>();

  for (const employeeId of scopedIds) {
    const employeeAssignments: AssignmentWithShift[] = assignments.get(employeeId) ?? [];

    for (const date of dates) {
      const dateKey = toDateOnly(date);
      const assignment = selectAssignmentForDate(employeeAssignments, date);

      if (!assignment) {
        result.skippedNoShift.push({ employeeId, date: dateKey });
        continue;
      }

      const dayPunches = buckets.get(`${employeeId}|${dateKey}`) ?? [];
      if (dayPunches.length === 0 && !markAbsent) continue;

      result.daysEvaluated++;

      const evaluation = evaluateDay(assignment.shift, dayPunches, date, halfDayRatio);
      result.statusCounts[evaluation.status]++;
      if (evaluation.status === 'ABSENT') result.absentDaysMarked++;

      const uploadId = await resolveSyntheticUpload(dateKey.slice(0, 7), uploadCache);

      await prisma.attendanceRecord.upsert({
        where: { employeeId_recordDate: { employeeId, recordDate: date } },
        update: {
          status: evaluation.status,
          timeIn: evaluation.timeIn,
          timeOut: evaluation.timeOut,
          lateMinutes: evaluation.lateMinutes,
          earlyMinutes: evaluation.earlyMinutes,
        },
        create: {
          uploadId,
          employeeId,
          recordDate: date,
          status: evaluation.status,
          timeIn: evaluation.timeIn,
          timeOut: evaluation.timeOut,
          lateMinutes: evaluation.lateMinutes,
          earlyMinutes: evaluation.earlyMinutes,
        },
      });
      result.recordsWritten++;
    }
  }

  return result;
}

/**
 * AttendanceRecord.uploadId is a required FK, so a biometric-derived row still
 * needs an AttendanceUpload to hang off. One synthetic batch per period month
 * stands in for the Excel file — which also keeps these rows visible to the
 * existing uploadId-scoped endpoints (summary, rule evaluation, deductions).
 */
async function resolveSyntheticUpload(periodMonth: string, cache: Map<string, number>): Promise<number> {
  const cached = cache.get(periodMonth);
  if (cached !== undefined) return cached;

  const filename = `biometric-${periodMonth}`;
  const existing = await prisma.attendanceUpload.findFirst({ where: { filename, periodMonth } });

  const id = existing
    ? existing.id
    : (await prisma.attendanceUpload.create({ data: { filename, periodMonth, status: 'biometric' } })).id;

  cache.set(periodMonth, id);
  return id;
}
