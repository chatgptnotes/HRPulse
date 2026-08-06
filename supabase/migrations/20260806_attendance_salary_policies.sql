-- Attendance and salary policy fields used by the Supabase-only version.
ALTER TABLE IF EXISTS public.attendance_records
  ADD COLUMN IF NOT EXISTS work_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS policy_code TEXT;

ALTER TABLE IF EXISTS public.salary_configs
  ADD COLUMN IF NOT EXISTS late_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS absence_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS half_day_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_lop_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

INSERT INTO public.settings(key, value) VALUES
  ('it_paid_leave_limit', '2'),
  ('non_it_paid_leave_limit', '4'),
  ('half_day_threshold_hours', '4'),
  ('late_occurrences_for_deduction', '3')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- The frontend uses the logged-in Supabase user and the publishable key.
-- These policies allow authenticated HR users to manage the shared HR data.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['employees','attendance_imports','attendance_records','salary_configs','attendance_rules','email_messages','email_templates','settings']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_authenticated_access', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', table_name || '_authenticated_access', table_name);
  END LOOP;
END $$;
