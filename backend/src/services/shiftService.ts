import prisma from '../db/prisma';
import type { Shift, EmployeeShift } from '@prisma/client';
import { fromDateOnly, toDateOnly } from '../utils/date';

/// ── TIMEZONE MODEL ──────────────────────────────────────────────────────────
///
/// `Shift.startTime` / `endTime` are wall-clock "HH:mm" with no date and no
/// timezone. `BiometricPunch.punchTime` is a naive TIMESTAMP. To compare them at
/// all, this module treats punch timestamps as **facility-local wall clock
/// stored naively**, and reads every component in UTC (getUTCHours, etc.).
///
/// That is self-consistent and immune to the host machine's TZ, but it means the
/// device feed MUST write local wall-clock time. If the device emits true UTC
/// instants from a facility that is not on UTC, every lateness figure here will
/// be wrong by the offset. Confirm this against the device export before trusting
/// production numbers.

/** Minutes since midnight for an "HH:mm" string. */
export function parseHHmm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid shift time "${value}" — expected "HH:mm"`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid shift time "${value}"`);
  return hours * 60 + minutes;
}

export interface ShiftWindow {
  /** Instant the shift starts on the given date. */
  start: Date;
  /** Instant it ends (may be on the following calendar day). */
  end: Date;
  /** Scheduled length in minutes. */
  durationMinutes: number;
  /** start + graceMinutes — arrivals after this are late. */
  graceCutoff: Date;
}

/**
 * Resolve a shift pattern into concrete instants for one date.
 *
 * `recordDate` must be a UTC-midnight Date (what `@db.Date` reads back, or what
 * `fromDateOnly` produces). The window is always anchored to the shift's START
 * date, so an overnight shift belongs to the day it began.
 */
export function shiftWindow(shift: Pick<Shift, 'startTime' | 'endTime' | 'graceMinutes' | 'isOvernight'>, recordDate: Date): ShiftWindow {
  const startMin = parseHHmm(shift.startTime);
  let endMin = parseHHmm(shift.endTime);

  // Either the flag says so, or the clock wrapped (e.g. 20:00 -> 08:00).
  if (shift.isOvernight || endMin <= startMin) endMin += 24 * 60;

  const base = recordDate.getTime();
  return {
    start: new Date(base + startMin * 60_000),
    end: new Date(base + endMin * 60_000),
    durationMinutes: endMin - startMin,
    graceCutoff: new Date(base + (startMin + shift.graceMinutes) * 60_000),
  };
}

export type AssignmentWithShift = EmployeeShift & { shift: Shift };

/**
 * Pure selection: which assignment covers `date`?
 *
 * `effectiveFrom` is inclusive; `effectiveTo` is inclusive, and NULL means open
 * ended. Overlapping ranges cannot be prevented by a database constraint (it
 * would need a Postgres exclusion constraint over a daterange), so ties are
 * broken deterministically: the assignment with the LATEST effectiveFrom wins,
 * i.e. the most recent instruction. A closed range beats an open-ended one
 * starting the same day, since the closed one is the more specific override.
 */
export function selectAssignmentForDate(assignments: AssignmentWithShift[], date: Date): AssignmentWithShift | null {
  const t = date.getTime();

  const covering = assignments.filter(a => {
    if (a.effectiveFrom.getTime() > t) return false;
    if (a.effectiveTo && a.effectiveTo.getTime() < t) return false;
    return a.shift.isActive;
  });

  if (covering.length === 0) return null;

  covering.sort((a, b) => {
    const byStart = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    if (byStart !== 0) return byStart;
    // Same start date: prefer the bounded (more specific) assignment.
    const aBounded = a.effectiveTo ? 0 : 1;
    const bBounded = b.effectiveTo ? 0 : 1;
    return aBounded - bBounded;
  });

  return covering[0];
}

/** DB-backed lookup for a single employee on a single date. */
export async function getShiftForEmployeeOnDate(employeeId: number, date: Date | string): Promise<Shift | null> {
  const d = typeof date === 'string' ? fromDateOnly(date) : date;
  const assignments = await prisma.employeeShift.findMany({
    where: { employeeId },
    include: { shift: true },
  });
  return selectAssignmentForDate(assignments, d)?.shift ?? null;
}

/**
 * Bulk variant for the engine: every assignment for the given employees, grouped
 * by employeeId. Fetching once and selecting in memory avoids a query per
 * employee per day.
 */
export async function loadAssignments(employeeIds: number[]): Promise<Map<number, AssignmentWithShift[]>> {
  const rows = await prisma.employeeShift.findMany({
    where: employeeIds.length ? { employeeId: { in: employeeIds } } : undefined,
    include: { shift: true },
  });

  const byEmployee = new Map<number, AssignmentWithShift[]>();
  for (const row of rows) {
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push(row);
    byEmployee.set(row.employeeId, list);
  }
  return byEmployee;
}

/** Inclusive list of UTC-midnight dates between two "yyyy-MM-dd" bounds. */
export function eachDateInRange(from: string, to: string): Date[] {
  const start = fromDateOnly(from);
  const end = fromDateOnly(to);
  if (start.getTime() > end.getTime()) throw new Error(`Range start ${from} is after end ${to}`);

  const dates: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t));
  }
  return dates;
}

/** "yyyy-MM" -> inclusive first/last day of that month. */
export function monthBounds(periodMonth: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!m) throw new Error(`Invalid period "${periodMonth}" — expected "yyyy-MM"`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid period "${periodMonth}"`);

  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last of this
  return { from: toDateOnly(first), to: toDateOnly(last) };
}
