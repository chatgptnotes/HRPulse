-- HRPulse ESS integration tables for Adamrit.
-- Run in Supabase SQL Editor, then reload PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE employees ADD COLUMN IF NOT EXISTS external_uuid text;
CREATE UNIQUE INDEX IF NOT EXISTS employees_external_uuid_unique
  ON employees (external_uuid)
  WHERE external_uuid IS NOT NULL;

CREATE TABLE IF NOT EXISTS leave_balances (
  id              serial PRIMARY KEY,
  employee_id     integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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

DROP TRIGGER IF EXISTS leave_balances_updated_at ON leave_balances;
CREATE TRIGGER leave_balances_updated_at BEFORE UPDATE ON leave_balances
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();

CREATE TABLE IF NOT EXISTS leave_requests (
  id                  serial PRIMARY KEY,
  employee_id          integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type           text NOT NULL,
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  reason               text,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  source               text NOT NULL DEFAULT 'hrpulse',
  external_request_id  text,
  approver_notes       text,
  decided_by           text,
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_requests_external_request_unique
  ON leave_requests (source, external_request_id)
  WHERE external_request_id IS NOT NULL;

DROP TRIGGER IF EXISTS leave_requests_updated_at ON leave_requests;
CREATE TRIGGER leave_requests_updated_at BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION hrpulse_set_updated_at();

CREATE TABLE IF NOT EXISTS hr_notifications (
  id               serial PRIMARY KEY,
  employee_id       integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  notification_key  text,
  type              text NOT NULL,
  title             text NOT NULL,
  body              text NOT NULL DEFAULT '',
  severity          text NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info', 'warning', 'critical', 'success')),
  source            text NOT NULL DEFAULT 'hrpulse',
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hr_notifications_employee_key_unique
  ON hr_notifications (employee_id, notification_key)
  WHERE notification_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS hr_notifications_employee_created_idx
  ON hr_notifications (employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ess_audit_logs (
  id                  bigserial PRIMARY KEY,
  employee_id          integer REFERENCES employees(id) ON DELETE SET NULL,
  action               text NOT NULL,
  actor_source         text NOT NULL DEFAULT 'adamrit',
  actor_external_id    text,
  ip_address           text,
  user_agent           text,
  status               text NOT NULL DEFAULT 'success'
                       CHECK (status IN ('success', 'denied', 'error')),
  details              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ess_audit_logs_employee_created_idx
  ON ess_audit_logs (employee_id, created_at DESC);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ess_audit_logs ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
