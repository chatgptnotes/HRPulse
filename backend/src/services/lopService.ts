export function calculateLOP(
  basicSalary: number,
  absentDays: number,
  missedSwipeDays: number,
  workingDays: number,
  missedSwipeWeight: number
): { lopDays: number; lopAmount: number } {
  const effectiveDays = absentDays + missedSwipeDays * missedSwipeWeight;
  const dailyRate = basicSalary / workingDays;
  const lopAmount = Math.round(dailyRate * effectiveDays);
  return { lopDays: effectiveDays, lopAmount };
}
