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
  find: (r: MatchableRecord) => { id: number; shift_start_time?: string | null } | null;
  warnings: string[];
  matched: number;
  skipped: number;
}

export async function matchEmployees(records: MatchableRecord[]): Promise<MatchResult> {
  const employees: Array<{ id: number; employee_number: string | null; name: string; biometric_name?: string | null; shift_start_time?: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('employees')
      .select('id, employee_number, name, biometric_name, shift_start_time')
      .range(offset, offset + 999);
    // Fallback: if biometric_name column doesn't exist yet, retry without it
    if (error && /biometric_name|does not exist|schema cache/i.test(error.message)) {
      const { data: data2, error: err2 } = await supabase
        .from('employees')
        .select('id, employee_number, name, shift_start_time')
        .range(offset, offset + 999);
      if (err2) throw new Error(err2.message);
      employees.push(...((data2 || []) as any[]));
      if (!data2 || data2.length < 1000) break;
      offset += 1000;
      continue;
    }
    if (error) throw new Error(error.message);
    employees.push(...((data || []) as any[]));
    if (!data || data.length < 1000) break;
    offset += 1000;
  }

  const byNumber = new Map<string, { id: number; shift_start_time?: string | null }>();
  const byName = new Map<string, { id: number; shift_start_time?: string | null }>();
  const byBiometric = new Map<string, { id: number; shift_start_time?: string | null }>();
  for (const e of employees) {
    const match = { id: e.id, shift_start_time: e.shift_start_time || null };
    if (e.employee_number) byNumber.set(String(e.employee_number).trim(), match);
    if (e.name) byName.set(String(e.name).trim().toLowerCase(), match);
    // Also index by biometric_name (old GDHR SmartTime name) so attendance
    // files using the old naming convention still match after a rename.
    if (e.biometric_name) byBiometric.set(String(e.biometric_name).trim().toLowerCase(), match);
  }

  const seenMissing = new Set<string>();
  const warnings: string[] = [];
  let matched = 0;
  let skipped = 0;

  function find(r: MatchableRecord): { id: number; shift_start_time?: string | null } | null {
    const num = r.employeeNumber ? String(r.employeeNumber).trim() : '';
    if (num && byNumber.has(num)) { matched++; return byNumber.get(num)!; }
    const name = (r.employeeName || '').trim().toLowerCase();
    if (name && byName.has(name)) { matched++; return byName.get(name)!; }
    // Fallback: try biometric_name (old GDHR SmartTime name alias)
    if (name && byBiometric.has(name)) { matched++; return byBiometric.get(name)!; }

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
