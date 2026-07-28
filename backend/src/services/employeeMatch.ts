import { supabase } from '../db/supabase';

// The attendance Excel must only import ATTENDANCE. It must not create or mutate
// Employee Master rows. This helper loads the master once and resolves each
// parsed record to an existing employee (by Employee ID, then by name). Records
// that don't match a master row are skipped with a warning.

export interface MatchableRecord {
  employeeNumber?: string | null;
  employeeName: string;
}

export interface MatchResult {
  find: (r: MatchableRecord) => { id: number } | null;
  warnings: string[];
  matched: number;
  skipped: number;
}

export async function matchEmployees(records: MatchableRecord[]): Promise<MatchResult> {
  const employees: Array<{ id: number; employee_number: string | null; name: string }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, employee_number, name')
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    employees.push(...((data || []) as any[]));
    if (!data || data.length < 1000) break;
    offset += 1000;
  }

  const byNumber = new Map<string, { id: number }>();
  const byName = new Map<string, { id: number }>();
  for (const e of employees) {
    if (e.employee_number) byNumber.set(String(e.employee_number).trim(), { id: e.id });
    if (e.name) byName.set(String(e.name).trim().toLowerCase(), { id: e.id });
  }

  const seenMissing = new Set<string>();
  const warnings: string[] = [];
  let matched = 0;
  let skipped = 0;

  function find(r: MatchableRecord): { id: number } | null {
    const num = r.employeeNumber ? String(r.employeeNumber).trim() : '';
    if (num && byNumber.has(num)) { matched++; return byNumber.get(num)!; }
    const name = (r.employeeName || '').trim().toLowerCase();
    if (name && byName.has(name)) { matched++; return byName.get(name)!; }

    skipped++;
    const key = `${num}|${name}`;
    if (name && !seenMissing.has(key)) {
      seenMissing.add(key);
      warnings.push(`Employee "${r.employeeName}" not found in Employee Master — skipped`);
    }
    return null;
  }

  return { find, warnings, matched, skipped };
}
