-- Salary sheet entries — stores calculated salary data per employee per month.
-- This is the canonical record that feeds both the Excel export and the HIMS ledger push.
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS salary_sheet_entries (
  id                serial PRIMARY KEY,
  period_month      text NOT NULL,
  employee_id       integer REFERENCES employees(id) ON DELETE CASCADE,
  employee_name     text NOT NULL,
  employee_number   text,
  designation       text,
  organisation      text,
  monthly_salary    numeric NOT NULL DEFAULT 0,
  working_days      integer NOT NULL DEFAULT 27,
  days_present      integer NOT NULL DEFAULT 0,
  paid_leaves       integer NOT NULL DEFAULT 0,
  ot_duties         integer NOT NULL DEFAULT 0,
  ot_amount         numeric NOT NULL DEFAULT 0,
  gross_salary      numeric NOT NULL DEFAULT 0,
  advance_paid      numeric NOT NULL DEFAULT 0,
  absent_days       integer NOT NULL DEFAULT 0,
  absent_deduction  numeric NOT NULL DEFAULT 0,
  total_deductions  numeric NOT NULL DEFAULT 0,
  net_salary        numeric NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_month, employee_id)
);

CREATE INDEX IF NOT EXISTS salary_sheet_entries_period_idx
  ON salary_sheet_entries(period_month);

CREATE INDEX IF NOT EXISTS salary_sheet_entries_employee_idx
  ON salary_sheet_entries(employee_id);

ALTER TABLE salary_sheet_entries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE salary_sheet_entries IS
  'Calculated monthly salary entries per employee. Fed by the salary-fill process, consumed by Excel export and HIMS ledger push.';