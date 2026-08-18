/**
 * Promotes a Supabase auth user to role 'admin' (superadmin) by setting
 * user_metadata.role via the Admin API (service-role key from .env).
 * Usage: node backend/scripts/promote-admin.js [email]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readEnv() {
  const lines = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const email = (process.argv[2] || 'admin@ambufast.com').toLowerCase().trim();
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

  // 1. Look up user by email
  const lookup = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!lookup.ok) throw new Error(`User lookup failed: ${lookup.status}`);
  const { users = [] } = await lookup.json();
  const user = users.find((u) => String(u.email || '').toLowerCase() === email);
  if (!user) throw new Error(`No Supabase auth user found for ${email}`);
  console.log(`Found user: ${user.email} (id ${user.id})`);
  console.log(`  current metadata: ${JSON.stringify(user.user_metadata ?? {})}`);

  // 2. Update metadata: role = admin, keep everything else
  const update = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_metadata: {
        ...(user.user_metadata ?? {}),
        role: 'admin',
        name: user.user_metadata?.name || user.user_metadata?.full_name || 'Administrator',
      },
    }),
  });
  if (!update.ok) {
    const detail = await update.text().catch(() => '');
    throw new Error(`Update failed: ${update.status} ${detail.slice(0, 200)}`);
  }
  const updated = await update.json();
  console.log(`  updated metadata: ${JSON.stringify(updated.user_metadata)}`);
  console.log(`\nSUCCESS — ${email} is now a superadmin.`);
  console.log('Sign out of HRPulse and sign back in for the role to take effect.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });