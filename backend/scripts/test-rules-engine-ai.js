/**
 * E2E test for the rules-engine-ai edge function: creates a temporary auth
 * user, signs in to get a real session token, invokes the function with a
 * natural-language rule, prints the result, then removes the temp user.
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
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY || env.anon_public;
  const email = `ai-e2e-test-${Date.now()}@example.com`;
  const password = 'TestPass123!x';

  // 1. Create temp user (service role).
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role: 'admin', name: 'AI E2E Test' } }),
  });
  const created = await createRes.json();
  if (!createRes.ok) throw new Error(`Temp user create failed: ${JSON.stringify(created)}`);
  console.log('Temp user created:', email);

  try {
    // 2. Sign in to get a real session access token.
    const loginRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const session = await loginRes.json();
    if (!loginRes.ok) throw new Error(`Login failed: ${JSON.stringify(session)}`);
    console.log('Login OK, token acquired');

    // 3. Invoke the edge function exactly like the frontend does.
    const fnRes = await fetch(`${url}/functions/v1/rules-engine-ai`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'If an employee is absent more than 5 days in a month, deduct 2000 rupees from salary',
      }),
    });
    const bodyText = await fnRes.text();
    console.log('FUNCTION STATUS:', fnRes.status);
    console.log('FUNCTION BODY:', bodyText.slice(0, 1200));
  } finally {
    // 4. Cleanup temp user.
    if (created.id) {
      const del = await fetch(`${url}/auth/v1/admin/users/${created.id}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      console.log('Temp user deleted:', del.status);
    }
  }
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });