-- Employee Master schema upgrade.
-- Run ONCE in Supabase SQL Editor (Database > SQL Editor > New query > Run).
-- Adds the columns needed by the Employee Master feature. Idempotent.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS mobile text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_start_time text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_end_time text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_salary numeric(12,2) DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS paid_leaves_eligible boolean DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS overtime_eligible boolean DEFAULT false;

-- Optional: clean up junk employees auto-created from bad attendance parses
-- (names that are really time strings like "08:32 16:10"). Uncomment to run.
-- DELETE FROM employees WHERE name ~ '^[0-9]{2}:[0-9]{2}';
