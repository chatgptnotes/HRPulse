import { describe, it, expect } from 'vitest';
import { countStatuses, isFlagged, isPayrollDeductibleDate, NON_FLAGGED_STATUSES, FLAGGED_STATUSES } from '../attendanceStatus';
import { calculateLOP, DEFAULT_HALF_DAY_LOP_WEIGHT } from '../lopService';

const rec = (...statuses: string[]) => statuses.map(status => ({ status }));

describe('countStatuses — legacy Excel vocabulary', () => {
  it('counts the four legacy exception statuses', () => {
    const c = countStatuses(rec('Absent', 'Absent', 'Missed Swipe', 'Late Coming', 'Early Leaving'));
    expect(c).toMatchObject({
      absentDays: 2, missedSwipeDays: 1, lateComingDays: 1, earlyLeavingDays: 1, halfDays: 0, flaggedTotal: 5,
    });
  });

  it('does not count non-exception statuses', () => {
    const c = countStatuses(rec('Normal', 'Weekend', 'Holiday', 'Official'));
    expect(c.flaggedTotal).toBe(0);
    expect(c.unknownStatuses).toEqual([]);
  });
});

describe('countStatuses — biometric engine vocabulary', () => {
  it('counts engine statuses into the same buckets', () => {
    const c = countStatuses(rec('ABSENT', 'LATE', 'LATE', 'HALF_DAY', 'PRESENT'));
    expect(c).toMatchObject({
      absentDays: 1, lateComingDays: 2, halfDays: 1, missedSwipeDays: 0, earlyLeavingDays: 0, flaggedTotal: 4,
    });
  });

  it('is the fix for the vocabulary gap: ABSENT and Absent agree', () => {
    expect(countStatuses(rec('ABSENT')).absentDays).toBe(1);
    expect(countStatuses(rec('Absent')).absentDays).toBe(1);
    expect(countStatuses(rec('LATE')).lateComingDays).toBe(1);
    expect(countStatuses(rec('Late Coming')).lateComingDays).toBe(1);
  });

  it('mixes both vocabularies in one period', () => {
    // A month where Excel covered week 1 and the biometric feed covered week 2.
    const c = countStatuses(rec('Absent', 'ABSENT', 'Late Coming', 'LATE', 'HALF_DAY'));
    expect(c.absentDays).toBe(2);
    expect(c.lateComingDays).toBe(2);
    expect(c.halfDays).toBe(1);
    expect(c.flaggedTotal).toBe(5);
  });

  it('tolerates case and separator variants', () => {
    expect(countStatuses(rec('half_day', 'Half Day', 'HALF-DAY')).halfDays).toBe(3);
    expect(countStatuses(rec('absent', 'ABSENT')).absentDays).toBe(2);
  });
});

describe('countStatuses — unknown statuses', () => {
  it('surfaces unrecognised values instead of silently dropping them', () => {
    const c = countStatuses(rec('Sabbatical', 'Normal', 'Sabbatical'));
    expect(c.flaggedTotal).toBe(0);
    expect(c.unknownStatuses).toEqual(['Sabbatical']);
  });
});

describe('isFlagged', () => {
  it('agrees across both vocabularies', () => {
    for (const s of ['Absent', 'ABSENT', 'Late Coming', 'LATE', 'HALF_DAY', 'Missed Swipe', 'Early Leaving']) {
      expect(isFlagged(s)).toBe(true);
    }
    for (const s of ['Normal', 'PRESENT', 'Weekend', 'Holiday', 'Official']) {
      expect(isFlagged(s)).toBe(false);
    }
  });

  it('keeps the exported filter lists mutually exclusive', () => {
    for (const s of FLAGGED_STATUSES) expect(NON_FLAGGED_STATUSES).not.toContain(s);
    for (const s of NON_FLAGGED_STATUSES) expect(isFlagged(s)).toBe(false);
  });
});

describe('isPayrollDeductibleDate', () => {
  it('keeps the 31st in attendance history but excludes it from payroll', () => {
    expect(isPayrollDeductibleDate('2026-07-31')).toBe(false);
    expect(isPayrollDeductibleDate('2026-07-30')).toBe(true);
  });
});

describe('calculateLOP', () => {
  const base = { basicSalary: 26_000, workingDays: 26, missedSwipeWeight: 0.5 };

  it('charges a full day per absence', () => {
    expect(calculateLOP({ ...base, absentDays: 3, missedSwipeDays: 0 })).toMatchObject({ lopDays: 3, lopAmount: 3000 });
  });

  it('charges the configured weight per missed swipe', () => {
    expect(calculateLOP({ ...base, absentDays: 0, missedSwipeDays: 4 })).toMatchObject({ lopDays: 2, lopAmount: 2000 });
  });

  it('charges half a day per HALF_DAY by default', () => {
    const r = calculateLOP({ ...base, absentDays: 0, missedSwipeDays: 0, halfDays: 3 });
    expect(r.lopDays).toBe(1.5);
    expect(r.lopAmount).toBe(1500);
  });

  it('respects a custom half-day weight', () => {
    const r = calculateLOP({ ...base, absentDays: 0, missedSwipeDays: 0, halfDays: 2, halfDayWeight: 0.25 });
    expect(r.lopDays).toBe(0.5);
  });

  it('treats omitted halfDays as zero — Excel-only periods are unchanged', () => {
    const without = calculateLOP({ ...base, absentDays: 2, missedSwipeDays: 2 });
    const withZero = calculateLOP({ ...base, absentDays: 2, missedSwipeDays: 2, halfDays: 0 });
    expect(without).toEqual(withZero);
    expect(without.lopDays).toBe(3);
  });

  it('sums all three components', () => {
    const r = calculateLOP({ ...base, absentDays: 1, missedSwipeDays: 2, halfDays: 2 });
    expect(r.lopDays).toBe(1 + 1 + 1);
    expect(r.lopAmount).toBe(3000);
  });

  it('returns zero rather than dividing by zero working days', () => {
    expect(calculateLOP({ ...base, workingDays: 0, absentDays: 5, missedSwipeDays: 0 })).toMatchObject({ lopDays: 0, lopAmount: 0 });
  });

  it('exposes the default weight it applies', () => {
    expect(DEFAULT_HALF_DAY_LOP_WEIGHT).toBe(0.5);
  });
});

describe('end-to-end: a biometric month now produces a deduction', () => {
  it('was zero before the vocabulary fix, is non-zero now', () => {
    const records = rec('PRESENT', 'LATE', 'ABSENT', 'ABSENT', 'HALF_DAY');
    const counts = countStatuses(records);

    const { lopDays, lopAmount } = calculateLOP({
      basicSalary: 26_000,
      absentDays: counts.absentDays,
      missedSwipeDays: counts.missedSwipeDays,
      halfDays: counts.halfDays,
      workingDays: 26,
      missedSwipeWeight: 0.5,
    });

    expect(counts.flaggedTotal).toBe(4);
    expect(lopDays).toBe(2.5); // 2 absences + one half day
    expect(lopAmount).toBe(2500);
  });
});
