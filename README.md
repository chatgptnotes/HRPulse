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

## License

MIT
