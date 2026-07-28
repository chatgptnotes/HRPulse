-- Manual overtime eligibility flag.
-- Existing and new employees default to false; HR must enable overtime per employee.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS overtime_eligible boolean DEFAULT false;

UPDATE employees
SET overtime_eligible = false
WHERE overtime_eligible IS NULL;
