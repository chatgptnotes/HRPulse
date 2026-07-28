// Preset shift suggestions shared across the app. Custom employee shift values
// are still allowed and merged into filters at runtime.
export const SHIFTS = [
  'General Shift',
  'Morning Shift',
  'Afternoon Shift',
  'Evening Shift',
  'Night Shift',
  'Day Shift',
  'Weekend Shift',
  'Split Shift',
  'Rotational Shift',
  'On Call',
  '12 Hour Day',
  '12 Hour Night',
];

const SHIFT_ALIASES: Record<string, string> = {
  general: 'General Shift',
  morning: 'Morning Shift',
  afternoon: 'Afternoon Shift',
  evening: 'Evening Shift',
  night: 'Night Shift',
  day: 'Day Shift',
  weekend: 'Weekend Shift',
  split: 'Split Shift',
  rotational: 'Rotational Shift',
  'on-call': 'On Call',
  oncall: 'On Call',
};

export function normalizeShiftLabel(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const key = trimmed.toLowerCase().replace(/\s+shift$/, '').replace(/\s+/g, '-');
  return SHIFT_ALIASES[key] || trimmed;
}

export function mergeShiftOptions(values: Array<string | null | undefined>) {
  return [...new Set([...SHIFTS, ...values.map(v => normalizeShiftLabel(v || '')).filter(Boolean)])].sort();
}
