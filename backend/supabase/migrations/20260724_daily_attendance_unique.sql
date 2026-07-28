-- Daily attendance uploads must update the same employee/date instead of
-- creating duplicate rows when a corrected daily Excel is re-uploaded.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_employee_date_unique
  ON attendance_records(employee_id, record_date);
