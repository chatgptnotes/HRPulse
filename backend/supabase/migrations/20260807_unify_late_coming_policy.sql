-- One authoritative late policy: assigned shift start + 30 minutes,
-- with one full duty-day deduction for every three monthly late days.

BEGIN;

INSERT INTO settings (key, value)
VALUES
  ('late_grace_minutes', '30'),
  ('half_day_hours', '4'),
  ('ot_threshold_hours', '2'),
  ('paid_leave_days', '2')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

DO $migration$
BEGIN
  IF to_regclass('public.sops') IS NOT NULL THEN
    UPDATE public.sops
    SET content = $policy$
## Late Coming & Early Leaving Policy

### Standard Working Hours
- Each employee follows the shift assigned in Employee Master
- Late-coming grace period: 30 minutes after the assigned shift start
- For a 9:00 AM shift, 9:30 AM is allowed and 9:31 AM is late

### Late Coming
- Every completed group of 3 late days in one month deducts 1 full duty day
- 1-2 late days = no salary deduction
- 3-5 late days = 1 duty day deduction
- 6-8 late days = 2 duty days deduction
- 9-11 late days = 3 duty days deduction
- The late count resets at the beginning of each month

### Exceptions
- Absence, weekly off, holiday, approved leave, and a missing punch-in are not counted as late
- Prior manager approval or a documented correction must be recorded through HR
$policy$,
        updated_at = now()
    WHERE title = 'Late Coming & Early Leaving Policy';
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF to_regclass('public.attendance_rules') IS NOT NULL THEN
    UPDATE public.attendance_rules
    SET name = 'Late Coming — Reminder (1–2 Times)',
        description = 'The grace period is 30 minutes after the assigned shift start. One or two late arrivals trigger a courtesy reminder.',
        conditions = jsonb_build_object('lateComingDays', jsonb_build_object('gte', 1, 'lte', 2)),
        actions = jsonb_build_object('templateType', 'initial', 'severity', 'notice', 'gracePeriodMinutes', 30),
        updated_at = now()
    WHERE rule_type = 'late_coming' AND priority = 5;

    UPDATE public.attendance_rules
    SET name = 'Late Coming — One-Day Deduction (3–5 Times)',
        description = 'Three to five late arrivals in a month deduct one full duty day.',
        conditions = jsonb_build_object('lateComingDays', jsonb_build_object('gte', 3, 'lte', 5)),
        actions = jsonb_build_object('templateType', 'reminder', 'severity', 'warning', 'notifyManager', true),
        updated_at = now()
    WHERE rule_type = 'late_coming' AND priority = 6;

    UPDATE public.attendance_rules
    SET name = 'Late Coming — Repeated Duty Deduction (6+ Times)',
        description = 'Six or more late arrivals deduct one duty day for every completed group of three late days and trigger a formal warning.',
        conditions = jsonb_build_object('lateComingDays', jsonb_build_object('gte', 6)),
        actions = jsonb_build_object('templateType', 'escalation', 'severity', 'critical', 'notifyHRDirector', true, 'disciplinaryRisk', true),
        updated_at = now()
    WHERE rule_type = 'late_coming' AND priority = 7;
  END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';

COMMIT;
