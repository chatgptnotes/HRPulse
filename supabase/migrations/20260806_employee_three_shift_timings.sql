-- Three employee-specific shift timings. The upload uses the closest configured
-- shift to the first punch-in, so rotating Nurse, OT and Ward staff are covered.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS shift_timings JSONB NOT NULL DEFAULT '{}'::jsonb;
