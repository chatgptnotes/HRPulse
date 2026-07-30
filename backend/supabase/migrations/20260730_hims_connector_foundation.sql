-- HRPulse reusable HIMS connector foundation.
-- Additive and idempotent: apply after the existing HRPulse schema/migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Kolkata',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO organizations (code, name, timezone)
VALUES ('hope', 'Hope Hospital', 'Asia/Kolkata')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS public_uuid uuid DEFAULT gen_random_uuid();
ALTER TABLE employees ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS record_version integer NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
UPDATE employees SET public_uuid = gen_random_uuid() WHERE public_uuid IS NULL;
UPDATE employees
SET organization_id = (SELECT id FROM organizations WHERE code = 'hope')
WHERE organization_id IS NULL;
ALTER TABLE employees ALTER COLUMN public_uuid SET NOT NULL;
ALTER TABLE employees ALTER COLUMN organization_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_public_uuid_unique ON employees(public_uuid);
CREATE INDEX IF NOT EXISTS employees_organization_idx ON employees(organization_id);

CREATE TABLE IF NOT EXISTS hr_user_roles (
  auth_user_id    uuid PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  role            text NOT NULL CHECK (role IN ('super_admin', 'hr_admin', 'payroll_admin', 'viewer')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_connectors (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key            text NOT NULL UNIQUE,
  organization_id          uuid NOT NULL REFERENCES organizations(id),
  connector_type           text NOT NULL DEFAULT 'hims',
  display_name             text NOT NULL,
  base_url                 text,
  status                   text NOT NULL DEFAULT 'disabled'
                           CHECK (status IN ('disabled', 'shadow', 'active', 'error')),
  inbound_token_hash       text,
  inbound_token_env        text,
  inbound_hmac_env         text,
  outbound_token_env       text,
  outbound_hmac_env        text,
  poll_interval_seconds    integer NOT NULL DEFAULT 300,
  settings                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_success_at          timestamptz,
  last_error_at            timestamptz,
  last_error               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE integration_connectors ADD COLUMN IF NOT EXISTS inbound_token_env text;

INSERT INTO integration_connectors (
  connector_key,
  organization_id,
  display_name,
  status,
  inbound_token_env,
  inbound_hmac_env,
  outbound_token_env,
  outbound_hmac_env
)
SELECT
  'adamrit-hope',
  id,
  'Adamrit — Hope Hospital',
  'disabled',
  'ADAMRIT_INBOUND_TOKEN',
  'ADAMRIT_INBOUND_HMAC_SECRET',
  'ADAMRIT_API_TOKEN',
  'ADAMRIT_OUTBOUND_HMAC_SECRET'
FROM organizations
WHERE code = 'hope'
ON CONFLICT (connector_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS employee_integration_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id          uuid NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  employee_id           integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  external_employee_id  text,
  external_user_id      text,
  external_employee_number text,
  source_version        integer NOT NULL DEFAULT 0,
  is_active             boolean NOT NULL DEFAULT true,
  last_synced_at        timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, employee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_mapping_external_unique
  ON employee_integration_mappings(connector_id, external_employee_id)
  WHERE external_employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employee_mapping_external_user_unique
  ON employee_integration_mappings(connector_id, external_user_id)
  WHERE external_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_inbox_events (
  id              bigserial PRIMARY KEY,
  connector_id    uuid NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  event_uuid      uuid NOT NULL,
  event_type      text NOT NULL,
  event_version   integer NOT NULL DEFAULT 1,
  entity_uuid     uuid,
  occurred_at     timestamptz NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received', 'processed', 'duplicate', 'failed')),
  error_message   text,
  processed_at    timestamptz,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, event_uuid)
);

CREATE TABLE IF NOT EXISTS integration_outbox_events (
  id              bigserial PRIMARY KEY,
  connector_id    uuid NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  event_uuid      uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  event_version   integer NOT NULL DEFAULT 1,
  entity_uuid     uuid,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'delivered', 'retry', 'dead_letter', 'cancelled')),
  attempt_count   integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id, event_uuid)
);
CREATE INDEX IF NOT EXISTS integration_outbox_due_idx
  ON integration_outbox_events(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS integration_delivery_attempts (
  id              bigserial PRIMARY KEY,
  outbox_event_id bigint NOT NULL REFERENCES integration_outbox_events(id) ON DELETE CASCADE,
  attempt_number  integer NOT NULL,
  request_url     text,
  request_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status integer,
  response_body   text,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE TABLE IF NOT EXISTS integration_checkpoints (
  connector_id    uuid NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  domain          text NOT NULL,
  cursor_value    text,
  watermark_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connector_id, domain)
);

CREATE TABLE IF NOT EXISTS integration_audit_logs (
  id              bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  connector_id    uuid REFERENCES integration_connectors(id),
  actor_type      text NOT NULL,
  actor_id        text,
  action          text NOT NULL,
  entity_type     text,
  entity_id       text,
  request_id      text,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_audit_created_idx
  ON integration_audit_logs(created_at DESC);

ALTER TABLE attendance_uploads ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'excel';
ALTER TABLE attendance_uploads ADD COLUMN IF NOT EXISTS connector_id uuid REFERENCES integration_connectors(id);
ALTER TABLE attendance_uploads ADD COLUMN IF NOT EXISTS uploaded_by text;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_upload_connector_month_unique
  ON attendance_uploads(connector_id, period_month)
  WHERE connector_id IS NOT NULL AND source_type = 'hims_daily';

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS connector_id uuid REFERENCES integration_connectors(id);
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'excel';
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source_record_id text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 1;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source_updated_at timestamptz DEFAULT now();
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_reversed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_source_record_unique
  ON attendance_records(connector_id, source_record_id)
  WHERE connector_id IS NOT NULL AND source_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attendance_record_revisions (
  id                    bigserial PRIMARY KEY,
  attendance_record_id  integer,
  employee_id           integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  record_date           text NOT NULL,
  connector_id          uuid REFERENCES integration_connectors(id),
  source_type           text NOT NULL,
  source_record_id      text,
  source_version        integer NOT NULL DEFAULT 1,
  source_updated_at     timestamptz NOT NULL,
  record_snapshot       jsonb NOT NULL,
  replaced_by_source    text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_revision_employee_date_idx
  ON attendance_record_revisions(employee_id, record_date, created_at DESC);

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS request_uuid uuid DEFAULT gen_random_uuid();
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'hrpulse';
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 1;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_day_part text NOT NULL DEFAULT 'full'
  CHECK (start_day_part IN ('full', 'first_half', 'second_half'));
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_day_part text NOT NULL DEFAULT 'full'
  CHECK (end_day_part IN ('full', 'first_half', 'second_half'));
UPDATE leave_requests SET request_uuid = gen_random_uuid() WHERE request_uuid IS NULL;
ALTER TABLE leave_requests ALTER COLUMN request_uuid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leave_requests_request_uuid_unique ON leave_requests(request_uuid);

CREATE TABLE IF NOT EXISTS leave_request_days (
  id                bigserial PRIMARY KEY,
  leave_request_id  integer NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  leave_date        date NOT NULL,
  day_fraction      numeric(3,2) NOT NULL CHECK (day_fraction IN (0.5, 1.0)),
  day_part          text NOT NULL CHECK (day_part IN ('full', 'first_half', 'second_half')),
  is_paid           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leave_request_id, leave_date)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id           serial PRIMARY KEY,
  upload_id    integer REFERENCES attendance_uploads(id) ON DELETE SET NULL,
  period_month text NOT NULL,
  status       text NOT NULL DEFAULT 'draft',
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows         jsonb NOT NULL DEFAULT '[]'::jsonb,
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payroll_runs ALTER COLUMN upload_id DROP NOT NULL;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_upload_id_key;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS run_uuid uuid DEFAULT gen_random_uuid();
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS supersedes_version integer;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS correction_type text;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS snapshot_hash text;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS finalized_by uuid;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS finalized_by_email text;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS publish_status text NOT NULL DEFAULT 'not_published'
  CHECK (publish_status IN ('not_published', 'pending', 'partial', 'published', 'failed'));
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS override_reason text;
UPDATE payroll_runs SET run_uuid = gen_random_uuid() WHERE run_uuid IS NULL;
UPDATE payroll_runs
SET organization_id = (SELECT id FROM organizations WHERE code = 'hope')
WHERE organization_id IS NULL;
ALTER TABLE payroll_runs ALTER COLUMN run_uuid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_run_uuid_unique ON payroll_runs(run_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_org_period_version_unique
  ON payroll_runs(organization_id, period_month, version);

CREATE TABLE IF NOT EXISTS payroll_run_items (
  id                    bigserial PRIMARY KEY,
  payroll_run_id        integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id           integer NOT NULL REFERENCES employees(id),
  employee_public_uuid  uuid NOT NULL,
  employee_number       text,
  monthly_salary        numeric(14,2) NOT NULL DEFAULT 0,
  gross_earnings        numeric(14,2) NOT NULL DEFAULT 0,
  allowances            jsonb NOT NULL DEFAULT '[]'::jsonb,
  overtime_minutes      integer NOT NULL DEFAULT 0,
  overtime_amount       numeric(14,2) NOT NULL DEFAULT 0,
  paid_days             numeric(6,2) NOT NULL DEFAULT 0,
  paid_leave_days       numeric(6,2) NOT NULL DEFAULT 0,
  unpaid_leave_days     numeric(6,2) NOT NULL DEFAULT 0,
  attendance_deductions numeric(14,2) NOT NULL DEFAULT 0,
  rule_deductions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  other_deductions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_deductions      numeric(14,2) NOT NULL DEFAULT 0,
  net_salary            numeric(14,2) NOT NULL DEFAULT 0,
  payment_status        text NOT NULL DEFAULT 'pending',
  calculation_summary   jsonb NOT NULL DEFAULT '{}'::jsonb,
  publish_status        text NOT NULL DEFAULT 'pending',
  publish_error         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type     text NOT NULL DEFAULT 'GENERAL_HR_DOCUMENT',
  original_filename text NOT NULL,
  stored_filename   text NOT NULL,
  mime_type         text NOT NULL DEFAULT 'application/octet-stream',
  file_size         integer NOT NULL DEFAULT 0,
  file_path         text NOT NULL,
  source            text NOT NULL DEFAULT 'hrpulse',
  uploaded_by       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS public_uuid uuid DEFAULT gen_random_uuid();
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS storage_bucket text;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'quarantined'
  CHECK (scan_status IN ('quarantined', 'scanning', 'clean', 'infected', 'scan_failed', 'revoked'));
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending'
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'expired'));
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE employee_documents SET public_uuid = gen_random_uuid() WHERE public_uuid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employee_documents_public_uuid_unique
  ON employee_documents(public_uuid);
CREATE INDEX IF NOT EXISTS employee_documents_sha256_idx ON employee_documents(sha256);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('employee-documents-private', 'employee-documents-private', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

CREATE OR REPLACE FUNCTION claim_integration_outbox_events(batch_size integer DEFAULT 25)
RETURNS SETOF integration_outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM integration_outbox_events
    WHERE status IN ('pending', 'retry')
      AND next_attempt_at <= now()
      AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
    ORDER BY next_attempt_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(batch_size, 100))
  )
  UPDATE integration_outbox_events e
  SET status = 'processing', locked_at = now(), updated_at = now()
  FROM due
  WHERE e.id = due.id
  RETURNING e.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_integration_outbox_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_integration_outbox_events(integer) TO service_role;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_integration_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_request_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_items ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
