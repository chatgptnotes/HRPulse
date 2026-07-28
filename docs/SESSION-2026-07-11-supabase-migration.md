# HRPulse Session Log — 2026-07-11

## Objective
Run HRPulse locally on the developer's Windows machine (`C:\Users\hope4\hrpulse\HRPulse`).

---

## 1. Initial discovery

- **Monorepo** with npm workspaces: `shared`, `backend` (Express + TypeScript + Prisma), `frontend` (React + Vite).
- Root `package.json` runs both via `concurrently`: `npm run dev`.
- `node_modules` already installed in all workspaces.
- Prisma schema present (`backend/prisma/schema.prisma`) with 11 models + 2 migrations.

## 2. Database problems found

- `backend/.env` was **malformed**: every line had 6 spaces of leading indentation, and `DATABASE_URL` was split across two lines.
- **No database existed** on the machine:
  - Nothing listening on port 5432.
  - No `postgresql*` Windows service, no `psql`/`pg_ctl`, no Docker, no `C:\Program Files\PostgreSQL`.
- Original `.env` pointed at `postgresql://murali@localhost:5432/hrpulse` (passwordless — would need trust auth).

## 3. PostgreSQL installation

- `winget` + `choco` available; chose **`PostgreSQL.PostgreSQL.17`** via winget (unattended, superpassword `postgres`, port 5432).
- Launched elevated install (`Start-Process -Verb RunAs`) — user accepted UAC.
- **Result:** PostgreSQL 17 installed successfully to `C:\Program Files\PostgreSQL\17`, service `postgresql-x64-17` running (Automatic), version `17.10-2`.
- Verified: superuser `postgres` / password `postgres` connects over `localhost:5432`.
- `hrpulse` DB not yet created (only default `postgres` DB); `murali` role did not exist.

## 4. Pivot to Supabase (user decision)

- User wanted to use **Supabase** (project `lhqalhmlamdyjmeinozo`) and **not** a local/Postgres connection string.
- User initially put the Supabase **project/REST URL** as `DATABASE_URL`:
  `https://lhqalhmlamdyjmeinozo.supabase.co`
- **Problem:** Prisma only accepts `postgresql://` connection strings. Proved with `prisma migrate status` → error `P1012: the URL must start with the protocol postgresql:// or postgres://.`.
- User then explicitly requested: **remove Prisma/PostgreSQL entirely; use the Supabase JS client with the REST URL**.

## 5. Full Prisma → Supabase migration (code)

### Removed
- `@prisma/client`, `prisma` from `backend/package.json` dependencies.
- `prisma:generate`, `prisma:migrate` npm scripts.
- `backend/src/db/prisma.ts` (the PrismaClient singleton).

### Added
- `@supabase/supabase-js@^2.110.2` (backend dependency).
- `backend/src/db/supabase.ts` — exports the client (`createClient`) + `getSettings()` helper. Client typed as `any` because no generated TypeScript schema (avoids strict `.in()`/`.or()` generic errors).
- `backend/supabase/schema.sql` — full DDL for all 11 tables (snake_case, FKs, unique constraints, `updated_at` triggers, RLS enabled).

### Rewritten (13 files)
All Prisma calls converted to the Supabase JS client. Aggregates (`groupBy`, `_count`) reimplemented in JavaScript.

- `backend/src/db/seed.ts` — settings, email templates, SOPs, attendance rules (upsert with `ignoreDuplicates` / insert-if-empty).
- Routes (9):
  - `routes/employees.ts` — list/get/patch/photo upload.
  - `routes/attendance.ts` — Excel upload, employee upsert-by-email, summary, records, delete (cascade).
  - `routes/emails.ts` — SSE draft generation, drafts list/patch, send, send-bulk, remind-pending, history.
  - `routes/salary.ts` — configs list/put/bulk, deductions (LOP).
  - `routes/settings.ts` — get (masked smtp_pass)/put, templates, test-smtp/test-ollama.
  - `routes/sops.ts` — list (category + ilike search), categories, CRUD, soft-delete, version bump.
  - `routes/rules.ts` — CRUD, toggle, evaluate (builds Dubai-policy email bodies, cross-month escalation).
  - `routes/analytics.ts` — overview counts, trends, monthly comparison.
  - `routes/ai.ts` — ask, analyze, insights, predict, generate-report (Ollama integration).
- Services (3):
  - `services/ruleEngine.ts` — loads active rules via Supabase.
  - `services/ollamaService.ts` — uses shared `getSettings`.
  - `services/emailService.ts` — uses shared `getSettings`; Ethereal fallback preserved.
- `backend/src/index.ts` — health endpoint changed `db: 'postgresql'` → `db: 'supabase'`.

### Supabase schema (11 tables)
`employees`, `attendance_uploads`, `attendance_records`, `email_drafts` (unique upload+employee), `email_history`, `salary_configs` (unique employee+month), `settings` (PK key), `email_templates` (unique type), `sops` (text[] tags), `attendance_rules` (jsonb conditions/actions), `ai_insights` (jsonb metadata).

## 6. `backend/.env` (final)

```
SUPABASE_URL=https://lhqalhmlamdyjmeinozo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=[REDACTED]   (set by user)
SUPABASE_ANON_KEY=[REDACTED]      (set by user)
```
Plus SMTP (placeholders), Ollama (localhost), company, PORT=3001.

## 7. Connection verification

- Without a key: Supabase REST returned `401 Unauthorized`.
- After user supplied the `sb_secret_` service-role key: connection **works**.
- After user ran `schema.sql` in Supabase SQL Editor: **all 11 tables exist** (`Tables OK: 11/11`).
- **TypeScript build check:** `npx tsc --noEmit` → **clean** (after fixing 6 implicit-`any` sort-comparator params and loosening the client type).

## 8. Dev server start — FAILED (new issue)

- Ran `npm run dev` from repo root.
- **Error:** `'concurrently' is not recognized as an internal or external command`
- Root cause: `concurrently` is listed in the **root** `package.json` `devDependencies` but is **not installed** in the root `node_modules` (workspaces install hoisted differently; the binary isn't on PATH at the root level).
- This is the **only remaining blocker** to running locally.

---

## Outstanding / Next steps

1. **Fix `concurrently`** — run `npm install` at the repo root (installs root devDeps including `concurrently`), then `npm run dev` should launch backend `:3001` + frontend `:5173`.
   - Alternative: run the two workspaces separately in two terminals:
     - `npm run dev --workspace=backend`
     - `npm run dev --workspace=frontend`
2. **Ollama not installed** — AI email-drafting / AI Insights will error until Ollama + `llama3.1:8b` are installed (optional; rest of app works).
3. **SMTP is placeholder** — emails fall back to Ethereal test mode (preview only, not real send).
4. **Prisma schema file** (`backend/prisma/schema.prisma`) and migrations folder are left in place as documentation of the data model but are no longer used at runtime.

---

## Files changed this session

| File | Change |
|------|--------|
| `backend/src/db/prisma.ts` | **Deleted** |
| `backend/src/db/supabase.ts` | **New** — Supabase client + getSettings |
| `backend/src/db/seed.ts` | Rewritten (Prisma → Supabase) |
| `backend/src/routes/employees.ts` | Rewritten |
| `backend/src/routes/attendance.ts` | Rewritten |
| `backend/src/routes/emails.ts` | Rewritten |
| `backend/src/routes/salary.ts` | Rewritten |
| `backend/src/routes/settings.ts` | Rewritten |
| `backend/src/routes/sops.ts` | Rewritten |
| `backend/src/routes/rules.ts` | Rewritten |
| `backend/src/routes/analytics.ts` | Rewritten |
| `backend/src/routes/ai.ts` | Rewritten |
| `backend/src/services/ruleEngine.ts` | Rewritten (import + rules query) |
| `backend/src/services/ollamaService.ts` | Rewritten (getSettings import) |
| `backend/src/services/emailService.ts` | Rewritten (getSettings import) |
| `backend/src/index.ts` | Health endpoint db label |
| `backend/package.json` | Removed prisma deps/scripts; added supabase-js |
| `backend/.env` | Supabase URL + service_role key; de-indented; cleaned |
| `backend/supabase/schema.sql` | **New** — 11-table DDL |
| `backend/supabase/_test_sb.js`, `_verify.js` | Temp scripts — **deleted after use** |

---

## Environment after session

- **OS:** Windows (DESKTOP-545CVHH, user `hope4`)
- **PostgreSQL 17** installed and running (port 5432) — *unused by app now; app uses Supabase.*
- **Node.js:** installed at `C:\Program Files\nodejs`.
- **Supabase project:** `lhqalhmlamdyjmeinozo` — connected, all tables created, service_role key configured.
- **App runtime status:** code complete + typechecks; **not yet running** (blocked on `concurrently` install).
