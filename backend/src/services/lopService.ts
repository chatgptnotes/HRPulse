export interface LopInput {
  basicSalary: number;
  absentDays: number;
  missedSwipeDays: number;
  /**
   * Biometric-engine half days. A day where the employee worked less than the
   * half-day threshold for their shift, so part of the day is unpaid.
   */
  halfDays?: number;
  workingDays: number;
  /** Fraction of a day's pay lost per missed swipe. Setting `missed_swipe_weight`. */
  missedSwipeWeight: number;
  /** Fraction of a day's pay lost per half day. Setting `half_day_lop_weight`. */
  halfDayWeight?: number;
  /**
   * Extra LOP days imposed by matched attendance rules, from `computeRuleLop`.
   * This is what implements policies like "7+ late arrivals = 1 day LOP", which
   * the attendance counts alone do not express.
   */
  ruleLopDays?: number;
}

export interface LopResult {
  /** Days derived purely from attendance counts, before any rule penalty. */
  baseLopDays: number;
  /** Days added by matched rules. */
  ruleLopDays: number;
  /** baseLopDays + ruleLopDays — the figure the deduction is computed from. */
  lopDays: number;
  lopAmount: number;
}

export const DEFAULT_HALF_DAY_LOP_WEIGHT = 0.5;

/**
 * Loss of pay for a period.
 *
 * Takes an options object rather than positional arguments: there are now six
 * numeric inputs, and a silently transposed pair would be a wrong salary
 * deduction that nothing would catch.
 *
 * NOTE — late coming and early leaving still do NOT reduce pay here, which is
 * unchanged behaviour but contradicts the seeded policy rules (seed.ts:213,222
 * describe 0.5-day and 1-day deductions for repeated lateness). Those rules
 * currently affect only email wording. Wiring rule-declared `lopDays` /
 * `lopMultiplier` into this calculation is a separate piece of work.
 */
export function calculateLOP(input: LopInput): LopResult {
  const {
    basicSalary,
    absentDays,
    missedSwipeDays,
    halfDays = 0,
    workingDays,
    missedSwipeWeight,
    halfDayWeight = DEFAULT_HALF_DAY_LOP_WEIGHT,
    ruleLopDays = 0,
  } = input;

  // Missed swipes are for tracking/display only and never result in salary deduction.
  // The missed_swipe_weight setting must remain 0 to prevent unintended deductions.
  const baseLopDays =
    absentDays +
    missedSwipeDays * missedSwipeWeight +
    halfDays * halfDayWeight;

  if (!workingDays) return { baseLopDays, ruleLopDays, lopDays: 0, lopAmount: 0 };

  const lopDays = baseLopDays + ruleLopDays;
  const dailyRate = basicSalary / workingDays;
  const lopAmount = Math.round(dailyRate * lopDays);

  return { baseLopDays, ruleLopDays, lopDays, lopAmount };
}
