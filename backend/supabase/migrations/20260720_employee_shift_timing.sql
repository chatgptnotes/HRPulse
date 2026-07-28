-- HRPulse Employee Shift Timing migration
-- Run in: Supabase Dashboard > SQL Editor > New query > Run
-- After running, reload the PostgREST schema cache:
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_start_time text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_end_time text;

NOTIFY pgrst, 'reload schema';
