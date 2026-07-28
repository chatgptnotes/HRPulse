// Time helpers shared by punch-timing features.

// Parse an attendance time value to minutes since midnight.
// Handles "H:MM", "HH:MM", "HH:MM:SS", pure digits like "930", and Excel
// fractional-day numbers (0..1) exported by some biometric tools.
export function parseTimeToMinutes(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (h < 24 && mi < 60) return h * 60 + mi;
    return null;
  }

  const n = Number(s);
  if (!isNaN(n)) {
    if (n > 0 && n < 1) return Math.round(n * 24 * 60); // Excel fraction of a day
    if (n >= 1 && n < 100000) {
      const whole = Math.floor(n);
      const frac = n - whole;
      const h = whole < 24 ? whole : Math.floor(whole / 100);
      const mi = whole < 24 ? Math.round(frac * 60) : whole % 100;
      if (h < 24 && mi < 60) return h * 60 + mi;
    }
  }
  return null;
}

export function minutesToHHMM(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
