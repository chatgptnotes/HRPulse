-- Name used by the biometric device, kept separately from the employee's
-- display name and designation.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS biometric_name TEXT;
