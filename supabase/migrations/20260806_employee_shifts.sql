-- Employee-specific recurring work schedules for the Supabase runtime.
CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  role_target TEXT NOT NULL DEFAULT 'GENERAL',
  start_time VARCHAR(5) NOT NULL,
  end_time VARCHAR(5) NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  is_overnight BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shifts_start_time_format CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$' AND substring(start_time, 1, 2)::int <= 23),
  CONSTRAINT shifts_end_time_format CHECK (end_time ~ '^[0-2][0-9]:[0-5][0-9]$' AND substring(end_time, 1, 2)::int <= 23),
  CONSTRAINT shifts_grace_minutes_valid CHECK (grace_minutes BETWEEN 0 AND 240)
);

CREATE TABLE IF NOT EXISTS public.employee_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id INTEGER NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employee_shifts_date_range_valid CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_shifts_employee_shift_from_key UNIQUE (employee_id, shift_id, effective_from)
);

CREATE INDEX IF NOT EXISTS employee_shifts_employee_from_idx ON public.employee_shifts(employee_id, effective_from);
CREATE INDEX IF NOT EXISTS shifts_role_target_idx ON public.shifts(role_target);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shifts_authenticated_access ON public.shifts;
DROP POLICY IF EXISTS employee_shifts_authenticated_access ON public.employee_shifts;
CREATE POLICY shifts_authenticated_access ON public.shifts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY employee_shifts_authenticated_access ON public.employee_shifts FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.shifts (name, role_target, start_time, end_time, grace_minutes, is_overnight)
VALUES
  ('Nurse Morning 08:00-14:00', 'NURSE', '08:00', '14:00', 15, false),
  ('Nurse Evening 14:00-20:00', 'NURSE', '14:00', '20:00', 15, false),
  ('Nurse Double 08:00-20:00', 'NURSE', '08:00', '20:00', 15, false),
  ('General 09:00-18:00', 'GENERAL', '09:00', '18:00', 15, false)
ON CONFLICT (name) DO NOTHING;
