/**
 * Verification: replicates getSalaryDeductions() rule evaluation for the
 * latest month (now that the July waiver is lifted) and prints, per employee,
 * the rule effects that will appear in the Salary page and payslip breakdown.
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
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (p) => (await fetch(`${url}/rest/v1/${p}`, { headers: H })).json();

  const imports = await get('attendance_imports?select=id,period_month&order=period_month.desc&limit=1');
  const month = imports[0].period_month;
  console.log('Month:', month, '(import', imports[0].id + ')');

  // Active Rules Engine rules (same shape the bridge fetches).
  const rules = await get('rules?select=id,name,rule_type,priority,rule_conditions(field,operator,value,value_type),rule_actions(action_type,target_field,amount,percent,value)&is_active=eq.true');
  console.log('Active rules:', rules.length);

  const start = `${month}-01`;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const end = d.toISOString().slice(0, 10);

  // Only what the late rule needs: late status counts + punch-in times for
  // the >9:30 heuristic, mirroring line ~880 of api/index.ts.
  const lateRows = await get(`attendance_records?select=employee_id,status,time_in&record_date=gte.${start}&record_date=lt.${end}&status=ilike.*late*`);
  const otherRows = await get(`attendance_records?select=employee_id,status,time_in&record_date=gte.${start}&record_date=lt.${end}&time_in=not.is.null&status=not.ilike.*late*&limit=10000`);

  const lateAfter = 570;
  const lateCount = new Map();
  for (const r of lateRows) lateCount.set(r.employee_id, (lateCount.get(r.employee_id) || 0) + 1);
  for (const r of otherRows) {
    const t = String(r.time_in || '');
    const m = t.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
    const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
    if (mins !== null && mins > lateAfter) lateCount.set(r.employee_id, (lateCount.get(r.employee_id) || 0) + 1);
  }

  const hits = [...lateCount.entries()].filter(([, c]) => c > 3);
  const emps = hits.length ? await get(`employees?select=id,name,organisation,monthly_salary&id=in.(${hits.map(([id]) => id).join(',')})`) : [];
  const byId = new Map(emps.map((e) => [e.id, e]));

  console.log('\nEmployees where "Late Arrival - Rs500 Salary Deduction" WILL APPLY (lateCount > 3):');
  if (!hits.length) console.log('  (none)');
  for (const [id, c] of hits) {
    const e = byId.get(id);
    console.log(`  ${e?.name} (${e?.organisation || '?'}) | lateCount=${c} | ruleDeduction=-500 | netPayable reduced by 500`);
  }
  console.log('\nSalary page will show a "Rules" badge and Calculation Details a "Rules Engine - Applied" section for these employees.');
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });