/**
 * Read-only diagnostic: finds employees in the latest attendance month for whom
 * the active Rules Engine rules would fire during salary calculation
 * (frontend/src/lib/payrollRuleBridge.ts), using the same logic.
 */
const fs = require('fs');
const path = require('path');

function readEnv() {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (p) => (await fetch(`${url}/rest/v1/${p}`, { headers: H })).json();

  const imports = await get('attendance_imports?select=id,period_month,status&order=period_month.desc&limit=1');
  const month = imports[0]?.period_month;
  console.log('Latest attendance month:', month, '(import id', imports[0]?.id + ')');

  const start = `${month}-01`;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const end = d.toISOString().slice(0, 10);

  // Fetch only the rows the late/absence logic needs (smaller payload).
  const lateRows = await get(
    `attendance_records?select=employee_id,status,time_in&record_date=gte.${start}&record_date=lt.${end}&status=ilike.*late*`,
  );
  const absentRows = await get(
    `attendance_records?select=employee_id,status,time_in&record_date=gte.${start}&record_date=lt.${end}&status=ilike.*absent*`,
  );

  const lateByStatus = new Map();
  for (const r of lateRows) lateByStatus.set(r.employee_id, (lateByStatus.get(r.employee_id) || 0) + 1);
  const absentBy = new Map();
  for (const r of absentRows) absentBy.set(r.employee_id, (absentBy.get(r.employee_id) || 0) + 1);

  // Late count also counts check-ins after 09:30 on non-late statuses.
  const lateAfter = 570;
  const lateAll = new Map(lateByStatus);
  for (const r of absentRows) {
    const t = String(r.time_in || '');
    const m = t.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
    const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
    if (mins !== null && mins > lateAfter) lateAll.set(r.employee_id, (lateAll.get(r.employee_id) || 0) + 1);
  }

  const ids = [...new Set([...lateAll.keys(), ...absentBy.keys()])];
  if (!ids.length) { console.log('No lates or absences found at all.'); return; }
  const emps = await get(`employees?select=id,name,department,organisation,monthly_salary&id=in.(${ids.join(',')})`);
  const byId = new Map(emps.map((e) => [e.id, e]));

  console.log('\nRule 2 "Late Arrival - Rs500 Salary Deduction" (lateCount > 3):');
  const lateHits = [...lateAll.entries()].filter(([, c]) => c > 3);
  if (!lateHits.length) console.log('  No employee exceeds 3 lates this month.');
  for (const [id, c] of lateHits) {
    const e = byId.get(id);
    console.log(`  MATCH ${e?.name} (${e?.organisation || e?.department || '?'}) - lateCount=${c} => -Rs500`);
  }

  console.log('\nRule 5 "Repeated Absence - Escalate" (absentDays >= 3, notification only, no pay effect):');
  const absHits = [...absentBy.entries()].filter(([, c]) => c >= 3);
  if (!absHits.length) console.log('  No employee has >=3 raw absences.');
  for (const [id, c] of absHits.slice(0, 10)) {
    const e = byId.get(id);
    console.log(`  MATCH ${e?.name} (${e?.organisation || '?'}) - raw absences=${c} (chargeable after leave allowance may be lower)`);
  }

  console.log('\nTop late counts overall:');
  for (const [id, c] of [...lateAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`  ${byId.get(id)?.name || id}: ${c}`);
  }
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });