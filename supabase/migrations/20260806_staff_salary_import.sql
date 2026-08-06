-- Use this for a staff-name and salary spreadsheet.
-- First create this table, then import a CSV with columns:
-- staff_name,monthly_salary,effective_month

CREATE TABLE IF NOT EXISTS public.salary_import_rows (
  id BIGSERIAL PRIMARY KEY,
  staff_name TEXT NOT NULL,
  monthly_salary NUMERIC(12,2) NOT NULL,
  effective_month TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.salary_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salary_import_rows_authenticated_access ON public.salary_import_rows;
CREATE POLICY salary_import_rows_authenticated_access
  ON public.salary_import_rows
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Match imported staff names to existing employees and create/update salary rows.
INSERT INTO public.salary_configs (employee_id, effective_month, basic_salary)
SELECT
  e.id,
  s.effective_month,
  s.monthly_salary
FROM public.salary_import_rows s
JOIN public.employees e
  ON LOWER(TRIM(e.name)) = LOWER(TRIM(s.staff_name))
ON CONFLICT (employee_id, effective_month)
DO UPDATE SET basic_salary = EXCLUDED.basic_salary;

-- Show rows that did not match an existing employee.
SELECT
  s.staff_name,
  s.monthly_salary,
  s.effective_month
FROM public.salary_import_rows s
LEFT JOIN public.employees e
  ON LOWER(TRIM(e.name)) = LOWER(TRIM(s.staff_name))
WHERE e.id IS NULL
ORDER BY s.staff_name;
