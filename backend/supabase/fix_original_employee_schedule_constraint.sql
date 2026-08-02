-- Remove the schedule constraint left by the abandoned four-table Dispatcher.
-- Safe to run without deleting employees or attendance.

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_active_schedule_check;

NOTIFY pgrst, 'reload schema';
