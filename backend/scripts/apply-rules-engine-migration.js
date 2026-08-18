/**
 * Applies supabase/migrations/20260818_rules_engine.sql through the Supabase
 * Supavisor pooler (direct db.<ref>.supabase.co:5432 is blocked on this network).
 *
 * - Splits the SQL into individual statements, respecting $$ dollar-quoted
 *   blocks, single-quoted strings and comments (naive split on ';' would break
 *   the DO $$ ... $$ seed blocks).
 * - Prefers the session-mode pooler (port 5432, prepared statements OK) and
 *   falls back to transaction mode (6543, pgbouncer=true).
 *
 * Usage: node backend/scripts/apply-rules-engine-migration.js
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { PrismaClient } = require('@prisma/client');

const ROOT = path.resolve(__dirname, '..', '..');
const SQL_FILE = path.join(ROOT, 'supabase', 'migrations', '20260818_rules_engine.sql');
const REGIONS = ['ap-south-1', 'ap-southeast-1', 'us-east-1', 'eu-central-1'];

function readEnv() {
  const lines = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return env;
}

function tryConnect(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Splits SQL text into top-level statements. Understands:
 *  - $$ ... $$ (and $tag$ ... $tag$) dollar-quoted blocks
 *  - '...' strings with '' escaping
 *  - -- line comments and slash-star block comments
 */
function splitSql(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    // Line comment
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Block comment
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Dollar-quoted block ($$ or $tag$)
    const dollar = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? n : end + tag.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    // Statement separator
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function resolvePoolerUrl() {
  const env = readEnv();
  const raw = env.DATABASE_URL || '';
  const ref = (env.SUPABASE_URL.match(/https?:\/\/([a-z]{20})\.supabase\.co/) || [])[1]
    || (raw.match(/:\/\/postgres\.([a-z]{20}):/) || [])[1];
  if (!ref) throw new Error('Could not determine Supabase project ref');
  const password = decodeURIComponent((raw.match(/:\/\/[^:]+:([^@]+)@/) || [])[1] || '');
  if (!password) throw new Error('Could not parse password from DATABASE_URL');

  for (const region of REGIONS) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    if (await tryConnect(host, 5432)) {
      return { url: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres?sslmode=require`, mode: 'session', host };
    }
    if (await tryConnect(host, 6543)) {
      return { url: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1`, mode: 'transaction', host };
    }
  }
  throw new Error('No Supabase pooler port reachable from this network');
}

async function main() {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = splitSql(sql);
  console.log(`Parsed ${statements.length} SQL statements from ${path.relative(ROOT, SQL_FILE)}`);

  const { url, mode, host } = await resolvePoolerUrl();
  console.log(`Using pooler ${host} (${mode} mode)`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let done = 0;
  const t0 = Date.now();
  try {
    for (const statement of statements) {
      const label = statement.replace(/\s+/g, ' ').slice(0, 80);
      try {
        await prisma.$executeRawUnsafe(statement);
        done += 1;
      } catch (err) {
        // Idempotent re-runs: "already exists" errors are safe to skip.
        const msg = String(err.message || err);
        if (/already exists|duplicate key value|unique constraint/i.test(msg)) {
          console.log(`  skip (exists): ${label}`);
          done += 1;
          continue;
        }
        console.error(`  FAILED: ${label}`);
        console.error(`  ${msg}`);
        throw err;
      }
    }
    console.log(`\nSUCCESS — ${done}/${statements.length} statements applied in ${Date.now() - t0}ms`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error('MIGRATION FAILED:', e.message); process.exit(1); });