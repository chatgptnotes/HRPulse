-- Restore the HRPulse Leave module required by Payroll's approved-leave overlay.
-- Additive and idempotent: existing employees and attendance are preserved.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION hrpulse_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

-- Upgrade an earlier partial Leave installation without rebuilding it.
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

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_notifications ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
