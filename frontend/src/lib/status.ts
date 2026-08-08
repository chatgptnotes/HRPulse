// The attendance status vocabulary.
//
// Attendance exports spell a status however they like — ABSENT, "Absent (LOP)",
// half day, HALF_DAY, WEEKEND/OFF, "LATE COMING". Everything is folded to one
// vocabulary at the point of parsing, so that nothing downstream has to guess at
// casing or punctuation. Order matters: "early leave" must be settled before the
// general leave rule, and "weekly off" before anything else.
//
// This lives in lib rather than api because the salary attribution needs it too,
// and a pure string helper should not drag the database client along with it.

const STATUS_PATTERNS: Array<[RegExp, string]> = [
  [/\bweek\s*end\b|\bweak\s*end\b|\bweekly\s*off\b|\bweek\s*off\b/, 'Weekend'],
  [/\bholiday\b/, 'Holiday'],
  [/\bhalf\s*day\b|\bhalf\b/, 'HALF_DAY'],
  [/\bmissed?\s*swipe\b|\bincomplete\b|\bmissing\s*punch\b/, 'Missed Swipe'],
  [/\bearly\s*(leaving|leave|going|out)\b/, 'Early Leaving'],
  [/\blate\b/, 'Late Coming'],
  [/\b(casual|sick|paid|earned|privilege)\s*leave\b|\bleave\b|\bcl\b|\bsl\b|\bpl\b/, 'Paid Leave'],
  [/\babsent\b|\babsence\b/, 'Absent'],
  [/\bofficial\b|\bon\s*duty\b|\bod\b/, 'Official'],
  [/\bnormal\b|\bpresent\b/, 'Normal'],
];

/** Fold a spreadsheet status to the canonical vocabulary. Unrecognised text is
 *  returned trimmed rather than discarded, so nothing is silently lost. */
export const canonicalStatus = (value: unknown): string => {
  const text = String(value ?? '').toLowerCase().replace(/[_\-/(),.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  for (const [pattern, canonical] of STATUS_PATTERNS) if (pattern.test(text)) return canonical;
  return String(value ?? '').trim();
};

/** Case-insensitive membership test for statuses that may predate canonicalisation. */
export const statusIsOneOf = (value: unknown, list: string[]) => {
  const canonical = canonicalStatus(value).toLowerCase();
  const raw = String(value ?? '').trim().toLowerCase();
  return list.some(item => { const l = item.toLowerCase(); return canonical === l || raw === l; });
};
