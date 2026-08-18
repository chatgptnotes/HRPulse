/**
 * Checks which rules-engine tables exist in Supabase via PostgREST (HTTPS),
 * since direct port 5432 is blocked on this network.
 */
const fs = require('fs');
const path = require('path');

function readEnv() {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return env;
}

async function main() {
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / key missing in .env');

  const tables = [
    'rule_categories', 'rules', 'rule_conditions', 'rule_actions',
    'rule_logs', 'rule_versions', 'rule_approvals', 'rule_execution_logs',
    'rule_permissions', 'rule_schedules', 'ai_rule_generation_history',
    'attendance_rules',
  ];
  for (const table of tables) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const body = await res.text();
    let note = '';
    try {
      const parsed = JSON.parse(body);
      if (parsed.code === '42P01') note = 'TABLE MISSING';
      else if (res.ok) note = `EXISTS (${parsed.length} sample rows returned)`;
      else note = `HTTP ${res.status}`;
    } catch { note = `HTTP ${res.status} (non-JSON)`; }
    console.log(`${table.padEnd(28)} ${note}`);
  }
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });