-- HRPulse Payroll migration (optional enhancement)
-- Run in: Supabase Dashboard > SQL Editor > New query > Run
-- After running, reload the PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';
--
-- This migration is OPTIONAL. The payroll feature works without it:
--   - biometric_id / shift on employees  (shown as "—" until applied)
--   - uploaded_by on attendance_uploads   (defaults to "admin")
--   - payroll_runs table                  (used to persist finalized runs)
-- Applying it unlocks shift/biometric capture from Excel and run persistence.

-- 1) employees: optional identity + shift columns
ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift text;

-- 2) attendance_uploads: who uploaded the file
ALTER TABLE attendance_uploads ADD COLUMN IF NOT EXISTS uploaded_by text;

-- 3) payroll_runs: persisted computation snapshots (one row per upload, optional)
CREATE TABLE IF NOT EXISTS payroll_runs (
  id           serial PRIMARY KEY,
  upload_id    integer NOT NULL REFERENCES attendance_uploads(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  status       text NOT NULL DEFAULT 'processed',   -- draft | processed | finalized
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows         jsonb NOT NULL DEFAULT '[]'::jsonb,
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upload_id)
);
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;

-- Reload PostgREST schema cache so the new columns are visible immediately.
NOTIFY pgrst, 'reload schema';
