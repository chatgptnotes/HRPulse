import { describe, it, expect } from 'vitest';
import { evaluateDay, LEGACY_STATUS_EQUIVALENT } from '../attendanceEngine';
import { fromDateOnly } from '../../utils/date';

const NURSE_MORNING = { startTime: '08:00', endTime: '14:00', graceMinutes: 15, isOvernight: false };
const NURSE_EVENING = { startTime: '14:00', endTime: '20:00', graceMinutes: 15, isOvernight: false };
const NURSE_DOUBLE = { startTime: '08:00', endTime: '20:00', graceMinutes: 15, isOvernight: false };
const GENERAL = { startTime: '09:00', endTime: '18:00', graceMinutes: 15, isOvernight: false };

const DAY = fromDateOnly('2026-07-15');

/** Punch at a wall-clock time on the test day. */
function punch(hhmm: string, punchType: 'IN' | 'OUT') {
  return { punchTime: new Date(`2026-07-15T${hhmm}:00.000Z`), punchType };
}

describe('evaluateDay — general staff 09:00-18:00', () => {
  it('marks a full on-time day PRESENT', () => {
    const r = evaluateDay(GENERAL, [punch('08:57', 'IN'), punch('18:02', 'OUT')], DAY);
    expect(r.status).toBe('PRESENT');
    expect(r.lateMinutes).toBe(0);
    expect(r.earlyMinutes).toBe(0);
    expect(r.workedMinutes).toBe(545);
  });

  it('does not penalise arrival inside the 15-minute grace', () => {
    const r = evaluateDay(GENERAL, [punch('09:14', 'IN'), punch('18:00', 'OUT')], DAY);
    expect(r.status).toBe('PRESENT');
    expect(r.lateMinutes).toBe(0);
  });

  it('treats the grace boundary itself as on time', () => {
    const r = evaluateDay(GENERAL, [punch('09:15', 'IN'), punch('18:00', 'OUT')], DAY);
    expect(r.lateMinutes).toBe(0);
    expect(r.status).toBe('PRESENT');
  });

  it('counts lateness from the end of grace, not from the start time', () => {
    const r = evaluateDay(GENERAL, [punch('09:45', 'IN'), punch('18:00', 'OUT')], DAY);
    expect(r.status).toBe('LATE');
    expect(r.lateMinutes).toBe(30);
  });

  it('records early departure in minutes', () => {
    const r = evaluateDay(GENERAL, [punch('09:00', 'IN'), punch('17:20', 'OUT')], DAY);
    expect(r.earlyMinutes).toBe(40);
    expect(r.status).toBe('PRESENT');
  });

  it('flags a short day as HALF_DAY ahead of LATE', () => {
    // 10:00-13:00 = 180 worked vs 540 scheduled, and also late.
    const r = evaluateDay(GENERAL, [punch('10:00', 'IN'), punch('13:00', 'OUT')], DAY);
    expect(r.status).toBe('HALF_DAY');
    expect(r.lateMinutes).toBe(45);
  });

  it('marks a day with no punches ABSENT', () => {
    const r = evaluateDay(GENERAL, [], DAY);
    expect(r.status).toBe('ABSENT');
    expect(r.timeIn).toBeNull();
    expect(r.timeOut).toBeNull();
    expect(r.missingPunch).toBe(false);
  });
});

describe('evaluateDay — nurse rotational shifts', () => {
  it('morning shift on time', () => {
    const r = evaluateDay(NURSE_MORNING, [punch('07:58', 'IN'), punch('14:05', 'OUT')], DAY);
    expect(r.status).toBe('PRESENT');
    expect(r.lateMinutes).toBe(0);
  });

  it('morning shift late by 20 minutes past grace', () => {
    const r = evaluateDay(NURSE_MORNING, [punch('08:35', 'IN'), punch('14:00', 'OUT')], DAY);
    expect(r.status).toBe('LATE');
    expect(r.lateMinutes).toBe(20);
  });

  it('evening shift is judged against 14:00, not 08:00', () => {
    // 14:10 is late for the morning shift but on time for the evening one.
    const onTime = evaluateDay(NURSE_EVENING, [punch('14:10', 'IN'), punch('20:00', 'OUT')], DAY);
    expect(onTime.status).toBe('PRESENT');
    expect(onTime.lateMinutes).toBe(0);

    const late = evaluateDay(NURSE_MORNING, [punch('14:10', 'IN'), punch('20:00', 'OUT')], DAY);
    expect(late.lateMinutes).toBe(355);
  });

  it('double shift measures against the full 12 hours', () => {
    const r = evaluateDay(NURSE_DOUBLE, [punch('08:05', 'IN'), punch('20:00', 'OUT')], DAY);
    expect(r.status).toBe('PRESENT');
    expect(r.workedMinutes).toBe(715);
    expect(r.earlyMinutes).toBe(0);
  });

  it('a 6-hour day on the 12-hour double shift is a half day', () => {
    // Exactly the morning-shift hours, but rostered onto the double shift.
    const r = evaluateDay(NURSE_DOUBLE, [punch('08:00', 'IN'), punch('13:30', 'OUT')], DAY);
    expect(r.status).toBe('HALF_DAY');
    expect(r.workedMinutes).toBe(330);
    expect(r.earlyMinutes).toBe(390);
  });

  it('the same hours on the morning shift are a full day', () => {
    const r = evaluateDay(NURSE_MORNING, [punch('08:00', 'IN'), punch('14:00', 'OUT')], DAY);
    expect(r.status).toBe('PRESENT');
    expect(r.workedMinutes).toBe(360);
  });
});

describe('evaluateDay — punch pairing edge cases', () => {
  it('uses earliest IN and latest OUT across multiple pairs', () => {
    const r = evaluateDay(GENERAL, [
      punch('09:00', 'IN'), punch('12:00', 'OUT'),
      punch('13:00', 'IN'), punch('18:00', 'OUT'),
    ], DAY);
    expect(r.timeIn?.toISOString()).toBe('2026-07-15T09:00:00.000Z');
    expect(r.timeOut?.toISOString()).toBe('2026-07-15T18:00:00.000Z');
    expect(r.workedMinutes).toBe(540);
    expect(r.status).toBe('PRESENT');
  });

  it('handles a missing OUT punch without inventing one', () => {
    const r = evaluateDay(GENERAL, [punch('09:00', 'IN')], DAY);
    expect(r.timeOut).toBeNull();
    expect(r.workedMinutes).toBeNull();
    expect(r.missingPunch).toBe(true);
    expect(r.earlyMinutes).toBe(0);
    expect(r.status).toBe('PRESENT');
  });

  it('ignores an OUT that precedes the first IN', () => {
    const r = evaluateDay(GENERAL, [punch('08:30', 'OUT'), punch('09:00', 'IN')], DAY);
    expect(r.timeIn?.toISOString()).toBe('2026-07-15T09:00:00.000Z');
    expect(r.timeOut).toBeNull();
    expect(r.missingPunch).toBe(true);
  });

  it('falls back to chronological order when the device omits IN labels', () => {
    const r = evaluateDay(GENERAL, [punch('09:05', 'OUT'), punch('17:55', 'OUT')], DAY);
    expect(r.timeIn?.toISOString()).toBe('2026-07-15T09:05:00.000Z');
    expect(r.timeOut?.toISOString()).toBe('2026-07-15T17:55:00.000Z');
  });

  it('is order-independent', () => {
    const forward = evaluateDay(GENERAL, [punch('09:00', 'IN'), punch('18:00', 'OUT')], DAY);
    const reversed = evaluateDay(GENERAL, [punch('18:00', 'OUT'), punch('09:00', 'IN')], DAY);
    expect(reversed).toEqual(forward);
  });

  it('respects a custom half-day ratio', () => {
    const punches = [punch('09:00', 'IN'), punch('15:00', 'OUT')]; // 360 of 540
    expect(evaluateDay(GENERAL, punches, DAY, 0.5).status).toBe('PRESENT');
    expect(evaluateDay(GENERAL, punches, DAY, 0.8).status).toBe('HALF_DAY');
  });
});

describe('status vocabulary', () => {
  it('documents that HALF_DAY has no legacy equivalent', () => {
    expect(LEGACY_STATUS_EQUIVALENT.PRESENT).toBe('Normal');
    expect(LEGACY_STATUS_EQUIVALENT.LATE).toBe('Late Coming');
    expect(LEGACY_STATUS_EQUIVALENT.ABSENT).toBe('Absent');
    expect(LEGACY_STATUS_EQUIVALENT.HALF_DAY).toBeNull();
  });
});

describe('host timezone independence', () => {
  it('produces identical results regardless of process TZ', () => {
    const original = process.env.TZ;
    const run = () => evaluateDay(GENERAL, [punch('09:45', 'IN'), punch('18:00', 'OUT')], DAY);

    process.env.TZ = 'UTC';
    const utc = run();
    process.env.TZ = 'America/New_York';
    const newYork = run();
    process.env.TZ = 'Asia/Kolkata';
    const kolkata = run();
    process.env.TZ = original;

    expect(newYork.lateMinutes).toBe(utc.lateMinutes);
    expect(kolkata.lateMinutes).toBe(utc.lateMinutes);
    expect(utc.lateMinutes).toBe(30);
  });
});
