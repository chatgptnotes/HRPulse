-- HRPulse schema for Supabase (PostgreSQL)
-- Run this in: Supabase Dashboard > SQL Editor > New query > Run
-- Mirrors backend/prisma/schema.prisma (snake_case table/column names)

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION hrpulse_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1) employees
CREATE TABLE IF NOT EXISTS employees (
  id              serial PRIMARY KEY,
  employee_number text,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  photo_url       text,
  organisation    text,
  entity          text,
  department      text,
  designation     text,
  shift_start_time text,
  shift_end_time   text,
  same_name_collision_confirmed_at timestamptz,
  same_name_collision_confirmed_by text,
  joining_date    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS employees_updated_at ON employees;
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();

-- 2) attendance_uploads
CREATE TABLE IF NOT EXISTS attendance_uploads (
  id            serial PRIMARY KEY,
  filename      text NOT NULL,
  period_month  text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  row_count     integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'processed'
);

-- 3) attendance_records
CREATE TABLE IF NOT EXISTS attendance_records (
  id           serial PRIMARY KEY,
  upload_id    integer NOT NULL REFERENCES attendance_uploads(id) ON DELETE CASCADE,
  employee_id  integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  record_date  text NOT NULL,
  status       text NOT NULL,
  time_in      text,
  time_out     text
);

-- 4) email_drafts
CREATE TABLE IF NOT EXISTS email_drafts (
  id            serial PRIMARY KEY,
  upload_id     integer NOT NULL REFERENCES attendance_uploads(id) ON DELETE CASCADE,
  employee_id   integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_type text NOT NULL DEFAULT 'initial',
  subject       text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  is_edited     boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'pending',
  sent_at       timestamptz,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upload_id, employee_id)
);

-- 5) email_history
CREATE TABLE IF NOT EXISTS email_history (
  id            serial PRIMARY KEY,
  employee_id   integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  upload_id     integer REFERENCES attendance_uploads(id) ON DELETE SET NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  sent_at       timestamptz NOT NULL,
  status        text NOT NULL,
  error_message text
);

-- 6) salary_configs
CREATE TABLE IF NOT EXISTS salary_configs (
  id              serial PRIMARY KEY,
  employee_id     integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  basic_salary    double precision NOT NULL DEFAULT 0,
  effective_month text NOT NULL,
  UNIQUE (employee_id, effective_month)
);

-- 7) settings
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- 7a) salary_payments
CREATE TABLE IF NOT EXISTS salary_payments (
  id             serial PRIMARY KEY,
  employee_id    integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_month   text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'paid', 'on_hold', 'resigned')),
  paid_amount    double precision NOT NULL DEFAULT 0,
  payment_date   text,
  hold_reason    text,
  notes          text,
  marked_by      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_month)
);
DROP TRIGGER IF EXISTS salary_payments_updated_at ON salary_payments;
CREATE TRIGGER salary_payments_updated_at BEFORE UPDATE ON salary_payments
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();

-- 8) email_templates
CREATE TABLE IF NOT EXISTS email_templates (
  id      serial PRIMARY KEY,
  type    text NOT NULL UNIQUE,
  subject text NOT NULL,
  body    text NOT NULL
);

-- 9) sops
CREATE TABLE IF NOT EXISTS sops (
  id         serial PRIMARY KEY,
  title      text NOT NULL,
  category   text NOT NULL,
  content    text NOT NULL,
  tags       text[] NOT NULL DEFAULT '{}',
  is_active  boolean NOT NULL DEFAULT true,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS sops_updated_at ON sops;
CREATE TRIGGER sops_updated_at BEFORE UPDATE ON sops
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();

-- 10) attendance_rules
CREATE TABLE IF NOT EXISTS attendance_rules (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  description text,
  rule_type   text NOT NULL,
  conditions  jsonb NOT NULL,
  actions     jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  priority    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS attendance_rules_updated_at ON attendance_rules;
CREATE TRIGGER attendance_rules_updated_at BEFORE UPDATE ON attendance_rules
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();

-- 11) ai_insights
CREATE TABLE IF NOT EXISTS ai_insights (
  id           serial PRIMARY KEY,
  upload_id    integer REFERENCES attendance_uploads(id) ON DELETE SET NULL,
  insight_type text NOT NULL,
  title        text NOT NULL,
  content      text NOT NULL,
  severity     text NOT NULL DEFAULT 'info',
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- NOTE: The backend uses the service_role key which bypasses Row Level Security.
-- If you ever use the anon key, disable RLS or add policies. For safety:
ALTER TABLE employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_drafts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_configs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sops               ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insights        ENABLE ROW LEVEL SECURITY;
