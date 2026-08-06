# HRPulse

HRPulse is an attendance and HR email dispatcher for UAE/GCC organizations.
It imports GDHR SmartTime Excel files, identifies attendance issues, calculates
LOP, creates template-based email drafts, and sends approved emails.

## Deployment

The application is designed for:

- **Vercel** for the React frontend and serverless API function.
- **Supabase** for PostgreSQL and Supabase Auth.
- An existing **SMTP provider** for sending employee emails.

The API is exposed through `api/[...path].ts`, which adapts the existing
Express routes to a Vercel function. This keeps the attendance, salary, rules,
SOP, and email workflows together while removing the separate server process.

## Supabase setup

1. Create a Supabase project.
2. Run the Prisma migration SQL from `backend/prisma/migrations` in the
   Supabase SQL Editor, or run `npx prisma migrate deploy` with the direct
   Supabase connection string.
3. Enable Email/Password authentication in Supabase Auth.
4. Create the first HR user in Supabase Auth. The application creates the
   matching profile row in `users` on the first authenticated request.

## Vercel environment variables

Set these in the Vercel project:

```text
DATABASE_URL=your_supabase_database_connection_string
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
AUTH_SECRET=only-needed-for-legacy-login-fallback
INGEST_API_KEY=optional-biometric-device-key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash-lite
```

SMTP settings are stored in the Supabase `settings` table and managed from the
Settings screen. Do not expose SMTP credentials or a Supabase service-role key
to the browser.

## Local development

```powershell
npm install
npm run dev
```

The Vite development server proxies `/api` to the local Express process. A
Supabase project and `DATABASE_URL` are still required for database-backed
features.

## Build

```powershell
npm run build
```

AI/Ollama features are intentionally not included in this Supabase + Vercel
deployment. Email drafts use the editable templates in the application. Gemini
is used only when an HR user asks it to convert plain-language policy text into
a draft attendance rule; the HR user must review and save the result.

For the backend-removal migration, deploy the Supabase function and set its
secrets with the Supabase CLI:

```powershell
supabase functions deploy generate-rule
supabase secrets set GEMINI_API_KEY=your_key GEMINI_MODEL=gemini-2.0-flash-lite
```

The frontend uses this function whenever `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are configured. Other workflows still use the
compatibility API until their matching Edge Functions are migrated.
