import { describe, it, expect } from 'vitest';
import {
  parseHHmm,
  shiftWindow,
  selectAssignmentForDate,
  eachDateInRange,
  monthBounds,
  type AssignmentWithShift,
} from '../shiftService';
import { fromDateOnly, toDateOnly } from '../../utils/date';

const NURSE_MORNING = { startTime: '08:00', endTime: '14:00', graceMinutes: 15, isOvernight: false };
const NURSE_EVENING = { startTime: '14:00', endTime: '20:00', graceMinutes: 15, isOvernight: false };
const NURSE_DOUBLE = { startTime: '08:00', endTime: '20:00', graceMinutes: 15, isOvernight: false };
const GENERAL = { startTime: '09:00', endTime: '18:00', graceMinutes: 15, isOvernight: false };

const DAY = fromDateOnly('2026-07-15');

describe('parseHHmm', () => {
  it('converts wall-clock strings to minutes since midnight', () => {
    expect(parseHHmm('00:00')).toBe(0);
    expect(parseHHmm('08:00')).toBe(480);
    expect(parseHHmm('14:00')).toBe(840);
    expect(parseHHmm('20:00')).toBe(1200);
    expect(parseHHmm('23:59')).toBe(1439);
  });

  it('rejects malformed and out-of-range values', () => {
    expect(() => parseHHmm('8:00')).toThrow();
    expect(() => parseHHmm('24:00')).toThrow();
    expect(() => parseHHmm('08:60')).toThrow();
    expect(() => parseHHmm('')).toThrow();
  });
});

describe('shiftWindow — the four configured shifts', () => {
  it('nurse morning 08:00-14:00 spans 6 hours', () => {
    const w = shiftWindow(NURSE_MORNING, DAY);
    expect(w.start.toISOString()).toBe('2026-07-15T08:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-15T14:00:00.000Z');
    expect(w.durationMinutes).toBe(360);
    expect(w.graceCutoff.toISOString()).toBe('2026-07-15T08:15:00.000Z');
  });

  it('nurse evening 14:00-20:00 spans 6 hours', () => {
    const w = shiftWindow(NURSE_EVENING, DAY);
    expect(w.start.toISOString()).toBe('2026-07-15T14:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-15T20:00:00.000Z');
    expect(w.durationMinutes).toBe(360);
  });

  it('nurse double 08:00-20:00 spans 12 hours', () => {
    const w = shiftWindow(NURSE_DOUBLE, DAY);
    expect(w.durationMinutes).toBe(720);
    expect(w.end.toISOString()).toBe('2026-07-15T20:00:00.000Z');
  });

  it('general 09:00-18:00 spans 9 hours', () => {
    const w = shiftWindow(GENERAL, DAY);
    expect(w.start.toISOString()).toBe('2026-07-15T09:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-15T18:00:00.000Z');
    expect(w.durationMinutes).toBe(540);
    expect(w.graceCutoff.toISOString()).toBe('2026-07-15T09:15:00.000Z');
  });

  it('rolls a wrapped end time onto the next day', () => {
    const night = { startTime: '20:00', endTime: '08:00', graceMinutes: 15, isOvernight: true };
    const w = shiftWindow(night, DAY);
    expect(w.start.toISOString()).toBe('2026-07-15T20:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-16T08:00:00.000Z');
    expect(w.durationMinutes).toBe(720);
  });

  it('treats a wrapped clock as overnight even when the flag is not set', () => {
    const w = shiftWindow({ startTime: '22:00', endTime: '06:00', graceMinutes: 15, isOvernight: false }, DAY);
    expect(w.durationMinutes).toBe(480);
    expect(w.end.toISOString()).toBe('2026-07-16T06:00:00.000Z');
  });
});

// Minimal shape satisfying selectAssignmentForDate.
function assignment(id: string, shiftName: string, from: string, to: string | null, isActive = true): AssignmentWithShift {
  return {
    id,
    employeeId: 1,
    shiftId: shiftName,
    effectiveFrom: fromDateOnly(from),
    effectiveTo: to ? fromDateOnly(to) : null,
    createdAt: new Date(0),
    shift: {
      id: shiftName,
      name: shiftName,
      roleTarget: 'NURSE',
      startTime: '08:00',
      endTime: '14:00',
      graceMinutes: 15,
      isOvernight: false,
      isActive,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  } as AssignmentWithShift;
}

describe('selectAssignmentForDate — nurse rotation', () => {
  const rotation = [
    assignment('a', 'morning', '2026-07-01', '2026-07-10'),
    assignment('b', 'evening', '2026-07-11', '2026-07-20'),
    assignment('c', 'double', '2026-07-21', null),
  ];

  it('picks the block covering the date', () => {
    expect(selectAssignmentForDate(rotation, fromDateOnly('2026-07-05'))?.shiftId).toBe('morning');
    expect(selectAssignmentForDate(rotation, fromDateOnly('2026-07-15'))?.shiftId).toBe('evening');
    expect(selectAssignmentForDate(rotation, fromDateOnly('2026-07-25'))?.shiftId).toBe('double');
  });

  it('treats both range bounds as inclusive', () => {
    expect(selectAssignmentForDate(rotation, fromDateOnly('2026-07-01'))?.shiftId).toBe('morning');
    expect(selectAssignmentForDate(rotation, fromDateOnly('2026-07-10'))?.shiftId).toBe('morning');
    expect(selectAssignmentForDate(rotation, fromDateOnly('2026-07-11'))?.shiftId).toBe('evening');
  });

  it('follows an open-ended assignment indefinitely', () => {
    expect(selectAssignmentForDate(rotation, fromDateOnly('2027-03-01'))?.shiftId).toBe('double');
  });

  it('returns null before any assignment starts', () => {
    expect(selectAssignmentForDate(rotation, fromDateOnly('2026-06-30'))).toBeNull();
  });

  it('returns null when nothing is assigned', () => {
    expect(selectAssignmentForDate([], DAY)).toBeNull();
  });

  it('ignores assignments pointing at a deactivated shift', () => {
    const inactive = [assignment('x', 'retired', '2026-07-01', null, false)];
    expect(selectAssignmentForDate(inactive, DAY)).toBeNull();
  });

  it('breaks overlaps by taking the most recent effectiveFrom', () => {
    const overlapping = [
      assignment('old', 'morning', '2026-07-01', null),
      assignment('new', 'evening', '2026-07-10', null),
    ];
    expect(selectAssignmentForDate(overlapping, fromDateOnly('2026-07-15'))?.shiftId).toBe('evening');
  });

  it('prefers a bounded override over an open-ended one starting the same day', () => {
    const sameDay = [
      assignment('open', 'morning', '2026-07-15', null),
      assignment('override', 'double', '2026-07-15', '2026-07-15'),
    ];
    expect(selectAssignmentForDate(sameDay, DAY)?.shiftId).toBe('double');
  });
});

describe('date range helpers', () => {
  it('produces an inclusive list of days', () => {
    const dates = eachDateInRange('2026-07-01', '2026-07-05').map(toDateOnly);
    expect(dates).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
  });

  it('handles a single-day range', () => {
    expect(eachDateInRange('2026-07-15', '2026-07-15')).toHaveLength(1);
  });

  it('crosses a month boundary without drift', () => {
    const dates = eachDateInRange('2026-07-30', '2026-08-02').map(toDateOnly);
    expect(dates).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
  });

  it('rejects an inverted range', () => {
    expect(() => eachDateInRange('2026-07-10', '2026-07-01')).toThrow();
  });

  it('derives month bounds, including leap February', () => {
    expect(monthBounds('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('rejects a malformed period', () => {
    expect(() => monthBounds('2026-13')).toThrow();
    expect(() => monthBounds('202607')).toThrow();
  });
});
