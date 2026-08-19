/**
 * Final verification: runs the NEW generic bridge logic (mirror of
 * payrollRuleBridge.ts) against real employees for the latest month and
 * prints, per employee, every rule effect that will now appear in the salary.
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

// Mirror of the evaluator's condition logic (ruleEvaluator.ts) — trimmed to
// what the seeded rules use (gt/gte/lt/lte/eq on numbers/strings).
function fieldValue(ctx, p) {
  let v = ctx;
  for (const part of String(p).split('.')) {
    if (v && typeof v === 'object' && part in v) v = v[part]; else return undefined;
  }
  return v;
}
function parseVal(raw, type) {
  const t = (type || 'string').toLowerCase();
  const s = String(raw).replace(/^"|"$/g, '');
  if (t === 'number' || t === 'boolean') return Number(s);
  return s;
}
function compare(actual, op, expected) {
  if (actual === undefined || actual === null) return false;
  switch (op) {
    case 'eq': return String(actual) === String(expected);
    case 'ne': return String(actual) !== String(expected);
    case 'gt': return Number(actual) > Number(expected);
    case 'lt': return Number(actual) < Number(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    case 'contains': return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default: return false;
  }
}
const PER_DAY = /^(?:attendance\.)?(dayofweek|isweekend|isholiday|timein|timeout|lateminutes|earlyminutes|status|shiftname)$/i;

async function main() {
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (p) => (await fetch(`${url}/rest/v1/${p}`, { headers: H })).json();

  const imports = await get('attendance_imports?select=id,period_month&order=period_month.desc&limit=1');
  const month = imports[0].period_month;
  const start = `${month}-01`;
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const end = d.toISOString().slice(0, 10);

  const rules = await get('rules?select=id,name,rule_type,priority,rule_conditions(field,operator,value,value_type,logical_operator),rule_actions(action_type,target_field,value,amount,percent,notification_template,notification_recipients,formula)&is_active=eq.true&order=priority.desc');
  console.log(`Month ${month} | ${rules.length} active rules evaluated generically\n`);

  // Aggregate per employee (late count, absences, leave, hours).
  const lateRows = await get(`attendance_records?select=employee_id,status,time_in&record_date=gte.${start}&record_date=lt.${end}&status=ilike.*late*`);
  const allRowsPaged = [];
  for (let from = 0; ; from += 1000) {
    const page = await get(`attendance_records?select=employee_id,status,time_in,work_hours&record_date=gte.${start}&record_date=lt.${end}&limit=1000&offset=${from}`);
    allRowsPaged.push(...page);
    if (page.length < 1000) break;
  }
  const lateAfter = 570;
  const agg = new Map();
  for (const r of allRowsPaged) {
    const a = agg.get(r.employee_id) || { late: 0, absent: 0, totalAbsent: 0, paidLeave: 0, hoursSum: 0, hoursDays: 0, missed: 0, half: 0 };
    const s = String(r.status || '').toLowerCase();
    const t = String(r.time_in || '');
    const m = t.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
    const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
    if (s.includes('late') || (mins !== null && mins > lateAfter)) a.late++;
    if (s.includes('absent')) a.totalAbsent++;
    if (s.includes('missed') || s.includes('incomplete')) a.missed++;
    if (s === 'half_day' || s === 'half day') a.half++;
    if (s.includes('paid leave') || s.includes('casual leave') || s.includes('sick leave')) a.paidLeave++;
    const wh = r.work_hours === null || r.work_hours === undefined ? null : Number(r.work_hours);
    if (wh !== null) { a.hoursSum += wh; a.hoursDays++; }
    agg.set(r.employee_id, a);
  }

  const ids = [...agg.keys()];
  const emps = await get(`employees?select=id,name,department,organisation,designation,monthly_salary&id=in.(${ids.slice(0, 60).join(',')})`);
  const byId = new Map(emps.map((e) => [e.id, e]));

  let shown = 0;
  for (const [id, a] of agg) {
    const e = byId.get(id);
    if (!e || !Number(e.monthly_salary)) continue;
    const basic = Number(e.monthly_salary);
    const daily = basic / 30;
    const isRafttar = /rafttar/i.test(`${e.organisation || ''} ${e.department || ''}`);
    const leaveLimit = isRafttar ? 2 : 4;
    const chargeable = Math.max(0, a.totalAbsent - Math.max(0, leaveLimit - a.paidLeave));
    // Context mirrors buildPayrollContext.
    const ctx = {
      employee: { name: e.name, department: e.department || '', organisation: e.organisation || '', designation: e.designation || '', monthlySalary: basic },
      attendance: { lateCount: a.late, absentDays: chargeable, missedSwipeCount: a.missed, halfDays: a.half, presentDays: 0, overtimeHours: 0, workingHours: a.hoursDays ? +(a.hoursSum / a.hoursDays).toFixed(2) : 0, totalFlagged: chargeable + a.missed + a.half + a.late },
      payroll: { basicSalary: basic, grossSalary: basic, netSalary: basic, deductions: 0, allowances: 0, lostPayDays: 0, period: month },
      leave: { balance: Math.max(0, leaveLimit - a.paidLeave), takenThisMonth: a.paidLeave, pendingRequests: 0, type: '' },
    };

    const lines = [];
    let totalDed = 0, totalBon = 0;
    for (const rule of rules) {
      const perDay = (rule.rule_conditions || []).find((c) => PER_DAY.test(String(c.field || '').trim()));
      if (perDay) {
        lines.push(`  ℹ️  ${rule.name} — per-day field "${perDay.field}" → applies at day level (info)`);
        continue;
      }
      let matched = true;
      for (const c of rule.rule_conditions || []) {
        const actual = fieldValue(ctx, c.field);
        if (!compare(actual, c.operator, parseVal(c.value, c.value_type))) { matched = false; break; }
      }
      if (!matched) continue;
      for (const act of rule.rule_actions || []) {
        const t = String(act.target_field || '');
        const amount = Number(act.amount || 0);
        if (act.action_type === 'subtract' && amount > 0) {
          totalDed += amount;
          lines.push(`  ⬇️  ${rule.name} — deduction ₹${amount}`);
        } else if (act.action_type === 'add' && amount > 0) {
          totalBon += amount;
          lines.push(`  ⬆️  ${rule.name} — bonus ₹${amount}`);
        } else if (act.action_type === 'sendNotification') {
          lines.push(`  ℹ️  ${rule.name} — matched, notification only (no pay change)`);
        } else if (act.action_type === 'set' && /deduction/i.test(t)) {
          const v = Number(String(act.value || '').replace(/"/g, ''));
          if (v > 0) { totalDed += v; lines.push(`  ⬇️  ${rule.name} — set deductions ₹${v}`); }
        } else {
          lines.push(`  ℹ️  ${rule.name} — matched (${act.action_type} ${t}) — no pay change`);
        }
      }
    }
    if (lines.length) {
      shown++;
      if (shown <= 12) {
        console.log(`${e.name} (${e.organisation || '?'}):`);
        console.log(lines.join('\n'));
        if (totalDed || totalBon) console.log(`  ⇒ ruleDeductions=₹${totalDed} ruleBonus=₹${totalBon} → net ${basic + totalBon - totalDed}`);
        console.log('');
      }
    }
  }
  console.log(`\n${shown} employees have visible rule effects (showing first 12).`);
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });