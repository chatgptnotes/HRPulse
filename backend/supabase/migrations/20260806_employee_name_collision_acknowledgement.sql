-- Remember HR confirmation that identical employee names belong to different people.
-- Additive only: no Employee Master or attendance rows are changed or removed.

BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS same_name_collision_confirmed_at timestamptz;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS same_name_collision_confirmed_by text;

COMMENT ON COLUMN employees.same_name_collision_confirmed_at IS
  'When set, HR confirmed that this employee is distinct from other active employees with the same normalized name.';

COMMENT ON COLUMN employees.same_name_collision_confirmed_by IS
  'HR administrator who confirmed the same-name Employee Master group.';

NOTIFY pgrst, 'reload schema';

COMMIT;
