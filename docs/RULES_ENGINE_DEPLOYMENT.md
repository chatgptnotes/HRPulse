# Rules Engine — Deployment Guide

The complete enterprise Dynamic Rule Engine for HRPulse. All application code
is finished and verified (TypeScript ✅, production build ✅). Two one-time
deployment steps remain.

---

## Step 1 — Create the database tables (2 minutes)

The `DATABASE_URL` password in `.env` is stale, so the migration could not be
applied automatically. Apply it through the Supabase Dashboard:

1. Open **Supabase Dashboard → your project → SQL Editor**
2. Open `supabase/migrations/20260818_rules_engine.sql`, copy **all** of it
3. Paste into the SQL Editor → **Run**

This creates all 11 tables (`rule_categories`, `rules`, `rule_conditions`,
`rule_actions`, `rule_versions`, `rule_approvals`, `rule_execution_logs`,
`rule_permissions`, `rule_schedules`, `ai_rule_generation_history`) with RLS,
indexes, **16 seeded categories** and **5 starter rules** (Half Day < 4h,
Late > 3 → ₹500 deduction, Sunday OT ×2, Leave Balance ≤ 2 notify,
Absences ≥ 3 escalate). Safe to re-run.

> Alternative: reset the DB password in Supabase → Settings → Database, update
> `DATABASE_URL` in `.env`, then run `node backend/scripts/apply-rules-engine-migration.js`.

Verify: `node backend/scripts/check-rule-tables.js` — all tables should say EXISTS.

## Step 2 — Deploy the AI Rule Generator edge function (2 minutes)

The Gemini-powered natural-language rule generator:

```bash
npm i -g supabase        # if the CLI is not installed
supabase login
supabase link --project-ref lhqalhmlamdyjmeinozo
supabase secrets set GEMINI_API_KEY=<your Gemini API key>
supabase functions deploy rules-engine-ai
```

Optional: `supabase secrets set GEMINI_MODEL=gemini-3.5-flash-lite` (defaults to
`gemini-3.5-flash-lite`). Note: the `gemini-2.0-flash` / `gemini-2.0-flash-lite`
models were retired by Google and now return 404 — use `gemini-3.5-flash-lite`
or newer.

> ✅ **Already deployed** (2026-08-18): function live on project
> `lhqalhmlamdyjmeinozo` with `GEMINI_API_KEY` + `GEMINI_MODEL=gemini-3.5-flash-lite`
> secrets configured.

Until this is deployed the AI panel shows a clear actionable message; every
other feature works without it.

---

## What was built

| Layer | Files |
|---|---|
| Database schema + seed | `supabase/migrations/20260818_rules_engine.sql` |
| AI generator (Gemini, clarifying questions, history logging) | `supabase/functions/rules-engine-ai/index.ts` |
| Field/operator/action catalog + templates | `frontend/src/lib/ruleFields.ts` |
| Rule Execution Engine (13 operators, AND/OR/nested groups, 10 action types, safe formulas) | `frontend/src/lib/ruleEvaluator.ts` |
| Supabase data layer (CRUD, auto-versioning, approvals, logs, analytics, import/export, clone) | `frontend/src/api/rulesEngine.ts` |
| Dashboard shell (6 KPIs + 7 tabs) | `frontend/src/pages/RulesEngineDashboard.tsx` |
| Rule Management 3-panel workspace + Visual Rule Builder | `frontend/src/components/rules/RuleManagementTab.tsx` |
| AI Rule Generator panel | `frontend/src/components/rules/AiGeneratorPanel.tsx` |
| Testing Sandbox (dry-run, real employee data, audit logging) | `frontend/src/components/rules/SandboxPanel.tsx` |
| Categories / Logs / Versions / Import-Export / Analytics / Settings | `frontend/src/components/rules/*Tab.tsx` |

Access: sidebar → **Rules Engine** (admin role), route `/rules-engine`.

## Utilities

- `node backend/scripts/check-rule-tables.js` — verify table existence
- `node backend/scripts/apply-rules-engine-migration.js` — apply the migration
  once the DB password in `.env` is valid