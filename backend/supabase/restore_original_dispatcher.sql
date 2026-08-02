-- Restore the original HRPulse Dispatcher database contract.
-- WARNING: this intentionally removes attendance created by the rebuilt Dispatcher.
-- Employee Master rows are preserved.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS attendance_import_rows CASCADE;
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS attendance_uploads CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;

-- Columns used by the original Employee Master and Dispatcher matching logic.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mobile text;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_active_schedule_check;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS organisation text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS entity text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_date timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS public_uuid uuid DEFAULT gen_random_uuid();
ALTER TABLE employees ADD COLUMN IF NOT EXISTS record_version integer NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_salary double precision NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Active';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS paid_leaves_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS overtime_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_start_time text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_end_time text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS same_name_collision_confirmed_at timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS same_name_collision_confirmed_by text;
UPDATE employees SET public_uuid = gen_random_uuid() WHERE public_uuid IS NULL;
ALTER TABLE employees ALTER COLUMN public_uuid SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS employees_public_uuid_unique ON employees(public_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_number_unique ON employees(employee_number);

INSERT INTO settings (key, value)
VALUES
  ('late_grace_minutes', '30'),
  ('half_day_hours', '4'),
  ('ot_threshold_hours', '2'),
  ('paid_leave_days', '2')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE TABLE attendance_uploads (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename      text NOT NULL,
  period_month  text NOT NULL,
  uploaded_by   text,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  row_count     integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'processed'
);

CREATE TABLE attendance_records (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_id    bigint NOT NULL REFERENCES attendance_uploads(id) ON DELETE CASCADE,
  employee_id  bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  record_date  text NOT NULL,
  status       text NOT NULL,
  time_in      text,
  time_out     text,
  UNIQUE (employee_id, record_date)
);

CREATE TABLE IF NOT EXISTS salary_configs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  basic_salary    double precision NOT NULL DEFAULT 0,
  effective_month text NOT NULL,
  UNIQUE (employee_id, effective_month)
);

CREATE TABLE IF NOT EXISTS email_drafts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_id     bigint NOT NULL REFERENCES attendance_uploads(id) ON DELETE CASCADE,
  employee_id   bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS email_history (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id   bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  upload_id     bigint REFERENCES attendance_uploads(id) ON DELETE SET NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  sent_at       timestamptz NOT NULL,
  status        text NOT NULL,
  error_message text
);

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS email_templates (
  id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type    text NOT NULL UNIQUE,
  subject text NOT NULL,
  body    text NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_rules (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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

-- Full Leave module used by Payroll, HR Leave Requests, and employee alerts.
CREATE OR REPLACE FUNCTION hrpulse_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS leave_balances (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id     bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type      text NOT NULL,
  opening_balance numeric NOT NULL DEFAULT 0,
  accrued         numeric NOT NULL DEFAULT 0,
  used            numeric NOT NULL DEFAULT 0,
  pending         numeric NOT NULL DEFAULT 0,
  available       numeric NOT NULL DEFAULT 0,
  period_year     integer NOT NULL DEFAULT EXTRACT(YEAR FROM now())::integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type, period_year)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id         bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_uuid        uuid NOT NULL DEFAULT gen_random_uuid(),
  leave_type          text NOT NULL,
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  start_day_part      text NOT NULL DEFAULT 'full' CHECK (start_day_part IN ('full', 'first_half', 'second_half')),
  end_day_part        text NOT NULL DEFAULT 'full' CHECK (end_day_part IN ('full', 'first_half', 'second_half')),
  reason              text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  source              text NOT NULL DEFAULT 'hrpulse',
  source_system       text NOT NULL DEFAULT 'hrpulse',
  source_version      integer NOT NULL DEFAULT 1,
  external_request_id text,
  approver_notes      text,
  decided_by          text,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS request_uuid uuid DEFAULT gen_random_uuid();
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_day_part text NOT NULL DEFAULT 'full';
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_day_part text NOT NULL DEFAULT 'full';
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'hrpulse';
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 1;
UPDATE leave_requests SET request_uuid = gen_random_uuid() WHERE request_uuid IS NULL;
ALTER TABLE leave_requests ALTER COLUMN request_uuid SET NOT NULL;

CREATE TABLE IF NOT EXISTS leave_request_days (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  leave_request_id bigint NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  leave_date       date NOT NULL,
  day_fraction     numeric(3,2) NOT NULL CHECK (day_fraction IN (0.5, 1.0)),
  day_part         text NOT NULL CHECK (day_part IN ('full', 'first_half', 'second_half')),
  is_paid          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leave_request_id, leave_date)
);

CREATE TABLE IF NOT EXISTS hr_notifications (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id      bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  notification_key text,
  type             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  severity         text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'success')),
  source           text NOT NULL DEFAULT 'hrpulse',
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_requests_request_uuid_unique ON leave_requests(request_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS leave_requests_external_request_unique
  ON leave_requests(source, external_request_id) WHERE external_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_requests_employee_dates_idx ON leave_requests(employee_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS hr_notifications_employee_key_unique
  ON hr_notifications(employee_id, notification_key) WHERE notification_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS hr_notifications_employee_created_idx ON hr_notifications(employee_id, created_at DESC);

DROP TRIGGER IF EXISTS leave_balances_updated_at ON leave_balances;
CREATE TRIGGER leave_balances_updated_at BEFORE UPDATE ON leave_balances
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();
DROP TRIGGER IF EXISTS leave_requests_updated_at ON leave_requests;
CREATE TRIGGER leave_requests_updated_at BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_notifications ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
