/// Helpers for the `@db.Date` columns (AttendanceRecord.recordDate,
/// EmployeeShift.effectiveFrom/To).
///
/// Prisma reads a DATE column back as a JS Date pinned to UTC midnight. Passing
/// that through a local-time formatter shifts the day backwards for any machine
/// west of UTC — 2026-07-01T00:00:00Z formatted in UTC-4 is "2026-06-30". These
/// two functions stay in UTC on both sides so a date survives the round trip.

/// Date -> "yyyy-MM-dd"
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/// "yyyy-MM-dd" -> Date at UTC midnight
export function fromDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
