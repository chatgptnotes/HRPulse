-- HRPulse Salary Payments migration
-- Run in: Supabase Dashboard > SQL Editor > New query > Run
-- After running, reload the PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';

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

ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
