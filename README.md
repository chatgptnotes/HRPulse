# HRPulse

AI-powered HR attendance email dispatcher for UAE & GCC organizations.

**100% on-premises** — your data never leaves your server. No cloud subscription. Works offline.

## Features

- **GDHR SmartTime Excel parser** — upload your monthly attendance export, HRPulse handles the rest
- **Local AI email drafting** — Ollama + llama3.1:8b drafts personalized absence/missed-swipe emails
- **Loss of Pay calculator** — configurable LOP formula with missed-swipe weight
- **Bulk SMTP dispatch** — preview, edit, and send to 100+ employees in one click
- **Analytics** — trend charts, top offenders, monthly comparison (recharts)
- **Employees** — auto-synced from Excel uploads, editable profiles
- **Rules engine** — define HR policy rules for automated email triggers
- **SOPs** — searchable Markdown knowledge base for HR policies
- **AI Insights** — anomaly detection, risk scoring, report generator, NL Q&A
- **Email History** — full audit trail with per-employee records

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL via Prisma ORM (Supabase-compatible) |
| AI | Local Ollama (llama3.1:8b) |
| Email | Nodemailer SMTP + Ethereal.email test fallback |
| Excel | SheetJS (xlsx) |

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- [Ollama](https://ollama.ai) with `llama3.1:8b` pulled

### Local Development

```bash
git clone https://github.com/chatgptnotes/HRPulse.git
cd HRPulse

# Install all workspaces
npm install

# Configure backend
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL, SMTP credentials

# Run Prisma migration
cd backend && npx prisma migrate deploy && cd ..

# Start both servers (frontend :5173 + backend :3001)
npm run dev
```

Open http://localhost:5173

### First Run Checklist

1. **Settings > Company Info** — set company name
2. **Settings > Ollama AI** — click "Test Ollama" to confirm llama3.1:8b is detected
3. **Settings > SMTP Email** — configure your SMTP server (or leave blank for Ethereal test mode)
4. **Dispatcher** — drop your GDHR SmartTime Excel, click "Process with AI"

## Deployment (Railway)

1. Connect this repo to [Railway](https://railway.app)
2. Add a PostgreSQL plugin — copy the `DATABASE_URL`
3. Set environment variables: `DATABASE_URL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `OLLAMA_URL`
4. Deploy — Railway uses `railway.toml` automatically

> Note: Ollama must be reachable from your Railway service. For production, run Ollama on the same private network or use `OLLAMA_URL` to point to your on-premises instance.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `PORT` | `3001` | Backend port |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.1:8b` | Model name |
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `COMPANY_NAME` | `Your Company` | Used in email signatures |
| `HRPULSE_ESS_TOKEN` | - | Shared server-to-server token required by Adamrit ESS proxy calls |
| `ADAMRIT_HR_NOTIFICATIONS_URL` | - | Adamrit server endpoint that receives mirrored HRPulse notifications, for example `https://adamrit.com/api/hrpulse-notifications` |
| `ADAMRIT_HR_NOTIFICATIONS_TOKEN` | `HRPULSE_ESS_TOKEN` | Bearer token HRPulse uses when pushing notifications to Adamrit |
| `OPENROUTER_API_KEY` | - | Server-side OpenRouter API key used by backend rule generation only |
| `OPENROUTER_MODEL` | `openrouter/free` | OpenRouter model used for initial rule generation and verification |
| `OPENROUTER_SITE_URL` | - | Optional HTTP referer sent to OpenRouter from the backend |
| `OPENROUTER_APP_TITLE` | `HRPulse` | Optional application title sent to OpenRouter from the backend |

## OpenRouter Rule Generator

HRPulse can use OpenRouter from the backend for **Rules > Rule Generator**. Keep the key only in `backend/.env` locally or in the backend deployment environment:

```env
OPENROUTER_API_KEY=your-rotated-server-side-key
OPENROUTER_MODEL=openrouter/free
OPENROUTER_SITE_URL=http://localhost:5173
OPENROUTER_APP_TITLE=HRPulse
```

Do not add the key to frontend `.env` files, React components, `VITE_` variables, `NEXT_PUBLIC_` variables, GitHub, logs, screenshots, or browser code. If the key is exposed, rotate it in OpenRouter and replace the backend environment value.

Verify locally after starting the backend:

```bash
curl http://localhost:3001/health/openrouter
```

The health response reports only booleans and model name, never the key or Authorization header.

## Adamrit ESS Integration

HRPulse exposes employee-scoped ESS APIs under `/api/ess/*` for Adamrit. Adamrit must call these APIs from its server-side proxy only, passing `Authorization: Bearer <HRPULSE_ESS_TOKEN>` plus one employee identity header such as `x-employee-email`, `x-employee-number`, or `x-employee-id`.

Apply `backend/supabase/migrations/20260722_ess_integration.sql` before enabling leave requests, ESS notifications, audit logs, and optional employee `external_uuid` mapping.

For near-real-time employee notification display inside Adamrit, set `ADAMRIT_HR_NOTIFICATIONS_URL` and `ADAMRIT_HR_NOTIFICATIONS_TOKEN` in HRPulse. HRPulse will mirror newly created ESS notifications to Adamrit's `/api/hrpulse-notifications` endpoint. Adamrit stores only the employee-facing notification/read state; HRPulse remains the source system for all HR rules and message generation.

## Reusable HIMS Connector

The versioned connector foundation supersedes one-off sync for attendance,
employee master, leave decisions, finalized payroll, and private HR documents.

1. Apply `backend/supabase/migrations/20260730_hims_connector_foundation.sql`.
2. Create a Supabase Auth user and set its email as
   `HRPULSE_BOOTSTRAP_ADMIN_EMAIL`.
3. Configure frontend `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Configure the connector and scanner variables documented in
   `backend/.env.example`.
5. Start the API and integration worker separately:

```bash
npm run dev --workspace=backend
npm run worker:dev --workspace=backend
```

The seeded `adamrit-hope` connector starts disabled. Configure its base URL from
the Integrations page, enable `shadow` mode, and complete reconciliation before
using `active`.

Contract artifacts:

- `docs/integrations/hrpulse-inbound-v1.openapi.yaml`
- `docs/integrations/adamrit-required-v1.openapi.yaml`
- `docs/integrations/ADAMRIT_IMPLEMENTATION_HANDOFF.md`

Legacy employee documents can be inspected and migrated without deleting local
files:

```bash
npm run documents:migrate:dry-run --workspace=backend
npm run documents:migrate --workspace=backend
```

## License

MIT
