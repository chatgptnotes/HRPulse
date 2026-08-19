/**
 * Deploys the rules-engine-ai edge function to Supabase via the Management API
 * (no CLI needed). Multipart body is built manually; entrypoint is a bare
 * filename because the API strips directory components from filenames.
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
  const token = env.SUPABASE_ACCESS_TOKENS;
  const ref = 'lhqalhmlamdyjmeinozo';
  const fnPath = path.resolve(__dirname, '..', '..', 'supabase', 'functions', 'rules-engine-ai', 'index.ts');
  const code = fs.readFileSync(fnPath);

  const metadata = JSON.stringify({
    entrypoint_path: 'index.ts',
    name: 'rules-engine-ai',
    verify_jwt: true,
  });

  const boundary = '----hrpulse' + Date.now();
  const parts = [];
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="metadata"\r\n` +
      `Content-Type: application/json\r\n\r\n`,
    ),
    Buffer.from(metadata),
    Buffer.from(`\r\n--${boundary}\r\n`),
    Buffer.from(
      `Content-Disposition: form-data; name="files"; filename="index.ts"\r\n` +
      `Content-Type: text/plain\r\n\r\n`,
    ),
    code,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  const body = Buffer.concat(parts);

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const text = await res.text();
  console.log('DEPLOY STATUS:', res.status);
  console.log(text.slice(0, 800));
  if (!res.ok) process.exit(1);
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });