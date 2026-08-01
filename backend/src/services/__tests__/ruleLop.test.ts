import { describe, it, expect } from 'vitest';
import { computeRuleLop } from '../ruleEngine';
import { calculateLOP } from '../lopService';

type Triggered = Parameters<typeof computeRuleLop>[0];

function rule(name: string, ruleType: string, actions: Record<string, unknown>): Triggered[number] {
  return {
    id: 1,
    name,
    ruleType,
    severity: 'warning',
    actions: { templateType: 'reminder', severity: 'warning', ...actions } as Triggered[number]['actions'],
  };
}

describe('computeRuleLop — tiers within a rule type do not stack', () => {
  it('takes the largest tier when several late-coming tiers match', () => {
    // Contrived: both tiers matching at once must not charge 1.5 days.
    const r = computeRuleLop([
      rule('Late 4-6 (0.5 day)', 'late_coming', { lopDays: 0.5 }),
      rule('Late 7+ (1 day)', 'late_coming', { lopDays: 1 }),
    ]);
    expect(r.additionalLopDays).toBe(1);
    expect(r.byRuleType.late_coming.ruleName).toBe('Late 7+ (1 day)');
  });

  it('is order-independent', () => {
    const forward = computeRuleLop([
      rule('Late 7+', 'late_coming', { lopDays: 1 }),
      rule('Late 4-6', 'late_coming', { lopDays: 0.5 }),
    ]);
    expect(forward.additionalLopDays).toBe(1);
  });
});

describe('computeRuleLop — different rule types add', () => {
  it('sums penalties for distinct offences', () => {
    const r = computeRuleLop([
      rule('Late 7+', 'late_coming', { lopDays: 1 }),
      rule('Early leaving', 'early_leaving', { lopDays: 0.5 }),
    ]);
    expect(r.additionalLopDays).toBe(1.5);
    expect(Object.keys(r.byRuleType).sort()).toEqual(['early_leaving', 'late_coming']);
  });
});

describe('computeRuleLop — rules with no lopDays', () => {
  it('contributes nothing for notice-only rules', () => {
    const r = computeRuleLop([
      rule('First notice', 'absence_threshold', {}),
      rule('Escalation', 'escalation', { notifyHRDirector: true }),
    ]);
    expect(r.additionalLopDays).toBe(0);
    expect(r.byRuleType).toEqual({});
  });

  it('ignores zero and negative values', () => {
    const r = computeRuleLop([
      rule('Zero', 'late_coming', { lopDays: 0 }),
      rule('Negative', 'early_leaving', { lopDays: -2 }),
    ]);
    expect(r.additionalLopDays).toBe(0);
  });

  it('handles an empty match list', () => {
    expect(computeRuleLop([]).additionalLopDays).toBe(0);
  });
});

describe('computeRuleLop — lopMultiplier is reported, not applied', () => {
  it('does not let a 0.5 multiplier reduce the penalty', () => {
    const r = computeRuleLop([
      rule('Missed Biometric', 'missed_swipe', { lopMultiplier: 0.5 }),
      rule('Late 7+', 'late_coming', { lopDays: 1 }),
    ]);
    expect(r.additionalLopDays).toBe(1);
    expect(r.ignoredMultipliers).toEqual([{ ruleName: 'Missed Biometric', lopMultiplier: 0.5 }]);
  });

  it('reports every occurrence so the redundancy stays visible', () => {
    const r = computeRuleLop([
      rule('Absence first notice', 'absence_threshold', { lopMultiplier: 1 }),
      rule('Missed Biometric', 'missed_swipe', { lopMultiplier: 0.5 }),
    ]);
    expect(r.ignoredMultipliers).toHaveLength(2);
    expect(r.additionalLopDays).toBe(0);
  });
});

describe('calculateLOP with ruleLopDays', () => {
  const base = { basicSalary: 26_000, workingDays: 26, missedSwipeWeight: 0.5 };

  it('separates the base figure from the rule penalty', () => {
    const r = calculateLOP({ ...base, absentDays: 2, missedSwipeDays: 0, ruleLopDays: 1 });
    expect(r.baseLopDays).toBe(2);
    expect(r.ruleLopDays).toBe(1);
    expect(r.lopDays).toBe(3);
    expect(r.lopAmount).toBe(3000);
  });

  it('implements the seeded policy: 7+ lates costs a day even with no absences', () => {
    // This is the case that produced 0 before rule LOP was wired in.
    const r = calculateLOP({ ...base, absentDays: 0, missedSwipeDays: 0, ruleLopDays: 1 });
    expect(r.baseLopDays).toBe(0);
    expect(r.lopDays).toBe(1);
    expect(r.lopAmount).toBe(1000);
  });

  it('defaults to no rule penalty when none is supplied', () => {
    const r = calculateLOP({ ...base, absentDays: 1, missedSwipeDays: 0 });
    expect(r.ruleLopDays).toBe(0);
    expect(r.lopDays).toBe(r.baseLopDays);
  });

  it('still reports the base figure when workingDays is zero', () => {
    const r = calculateLOP({ ...base, workingDays: 0, absentDays: 3, missedSwipeDays: 0, ruleLopDays: 1 });
    expect(r.baseLopDays).toBe(3);
    expect(r.lopAmount).toBe(0);
  });
});

describe('end-to-end: late-coming policy now reaches pay', () => {
  it('charges 1 day for 8 late arrivals and no other exception', () => {
    const triggered = [
      rule('Late Coming — Reminder (1-3)', 'late_coming', {}),
      rule('Late Coming — Full-Day LOP (7+)', 'late_coming', { lopDays: 1 }),
    ];
    const ruleLop = computeRuleLop(triggered);

    const r = calculateLOP({
      basicSalary: 26_000,
      absentDays: 0,
      missedSwipeDays: 0,
      halfDays: 0,
      workingDays: 26,
      missedSwipeWeight: 0.5,
      ruleLopDays: ruleLop.additionalLopDays,
    });

    expect(ruleLop.additionalLopDays).toBe(1);
    expect(r.lopAmount).toBe(1000);
  });
});
