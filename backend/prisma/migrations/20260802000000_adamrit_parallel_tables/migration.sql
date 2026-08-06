-- Adamrit integration foundation — PARALLEL TABLES, NON-DESTRUCTIVE, IDEMPOTENT.
--
-- The existing `attendance_records` and `salary_configs` tables hold production
-- data and are NOT modified. Not one row is deleted, not one column is altered,
-- renamed or dropped. Instead:
--
--   attendance_records  ──copy──>  attendance_days       (DATE, typed times, unique)
--   salary_configs      ──copy──>  salary_structures     (DECIMAL money)
--
-- Rows that cannot be carried over — an unparseable date, or a duplicate
-- superseded by a later row for the same employee and day — are recorded in
-- `attendance_records_unmigrated` with a reason. They also still exist,
-- untouched, in the original table.
--
-- The only change to a pre-existing table is `ADD COLUMN IF NOT EXISTS
-- adamrit_ledger_id` on employees — a nullable ADD COLUMN, which in PostgreSQL
-- 11+ is a catalog-only operation: no table rewrite, no row touched.
--
-- EVERY STATEMENT IS IDEMPOTENT. This migration may have been applied by hand
-- (e.g. pasted into the Supabase SQL editor) without Prisma recording it in
-- `_prisma_migrations`. Re-running it must therefore be a safe no-op rather than
-- an error that fails the deploy. Hence IF NOT EXISTS guards throughout and
-- ON CONFLICT DO NOTHING on every copy.
--
-- Prisma runs each migration inside a transaction: any failure rolls the whole
-- thing back and leaves the originals exactly as they were.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Employee → Adamrit ledger linkage (additive)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "adamrit_ledger_id" TEXT;

-- Postgres allows unlimited NULLs under a UNIQUE index, so every not-yet-linked
-- employee coexists while linked ones stay distinct.
CREATE UNIQUE INDEX IF NOT EXISTS "employees_adamrit_ledger_id_key"
    ON "employees" ("adamrit_ledger_id");

CREATE INDEX IF NOT EXISTS "employees_employee_number_idx"
    ON "employees" ("employee_number");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Shifts (new tables)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "shifts" (
    "id"            TEXT         NOT NULL,
    "name"          TEXT         NOT NULL,
    "role_target"   TEXT         NOT NULL,
    "start_time"    VARCHAR(5)   NOT NULL,
    "end_time"      VARCHAR(5)   NOT NULL,
    "grace_minutes" INTEGER      NOT NULL DEFAULT 15,
    "is_overnight"  BOOLEAN      NOT NULL DEFAULT false,
    "is_active"     BOOLEAN      NOT NULL DEFAULT true,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "shifts_name_key" ON "shifts" ("name");
CREATE INDEX IF NOT EXISTS "shifts_role_target_idx" ON "shifts" ("role_target");

CREATE TABLE IF NOT EXISTS "employee_shifts" (
    "id"             TEXT         NOT NULL,
    "employee_id"    INTEGER      NOT NULL,
    "shift_id"       TEXT         NOT NULL,
    "effective_from" DATE         NOT NULL,
    "effective_to"   DATE,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_shifts_employee_id_shift_id_effective_from_key"
    ON "employee_shifts" ("employee_id", "shift_id", "effective_from");
CREATE INDEX IF NOT EXISTS "employee_shifts_employee_id_effective_from_idx"
    ON "employee_shifts" ("employee_id", "effective_from");

-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS, so each FK is guarded.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_shifts_employee_id_fkey') THEN
        ALTER TABLE "employee_shifts"
            ADD CONSTRAINT "employee_shifts_employee_id_fkey"
            FOREIGN KEY ("employee_id") REFERENCES "employees" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- RESTRICT, not CASCADE: deleting a shift pattern must not silently delete the
-- assignment history that payroll was calculated against.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_shifts_shift_id_fkey') THEN
        ALTER TABLE "employee_shifts"
            ADD CONSTRAINT "employee_shifts_shift_id_fkey"
            FOREIGN KEY ("shift_id") REFERENCES "shifts" ("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Biometric punches (new table)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "biometric_punches" (
    "id"          TEXT         NOT NULL,
    "employee_id" INTEGER      NOT NULL,
    "punch_time"  TIMESTAMP(3) NOT NULL,
    "punch_type"  VARCHAR(3)   NOT NULL,
    "device_id"   TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_punches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "biometric_punches_employee_id_punch_time_punch_type_key"
    ON "biometric_punches" ("employee_id", "punch_time", "punch_type");
CREATE INDEX IF NOT EXISTS "biometric_punches_employee_id_punch_time_idx"
    ON "biometric_punches" ("employee_id", "punch_time");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'biometric_punches_employee_id_fkey') THEN
        ALTER TABLE "biometric_punches"
            ADD CONSTRAINT "biometric_punches_employee_id_fkey"
            FOREIGN KEY ("employee_id") REFERENCES "employees" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. attendance_days — the new attendance table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "attendance_days" (
    "id"            SERIAL       NOT NULL,
    "upload_id"     INTEGER      NOT NULL,
    "employee_id"   INTEGER      NOT NULL,
    "record_date"   DATE         NOT NULL,
    "status"        TEXT         NOT NULL,
    "time_in"       TIMESTAMP(3),
    "time_out"      TIMESTAMP(3),
    "late_minutes"  INTEGER      NOT NULL DEFAULT 0,
    "early_minutes" INTEGER      NOT NULL DEFAULT 0,
    "time_in_raw"   TEXT,
    "time_out_raw"  TEXT,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- Archive of rows not carried across, with the reason. Intentionally has no
-- foreign keys: it is a record of what happened, not live relational data.
CREATE TABLE IF NOT EXISTS "attendance_records_unmigrated" (
    "id"          INTEGER      NOT NULL,
    "upload_id"   INTEGER      NOT NULL,
    "employee_id" INTEGER      NOT NULL,
    "record_date" TEXT         NOT NULL,
    "status"      TEXT         NOT NULL,
    "time_in"     TEXT,
    "time_out"    TEXT,
    "reason"      TEXT         NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_unmigrated_pkey" PRIMARY KEY ("id")
);

-- Indexes created BEFORE the copy so ON CONFLICT has a constraint to target.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_days_employee_id_record_date_key"
    ON "attendance_days" ("employee_id", "record_date");
CREATE INDEX IF NOT EXISTS "attendance_days_upload_id_idx"
    ON "attendance_days" ("upload_id");

-- A cast that yields NULL instead of raising, so one malformed date cannot abort
-- the whole migration. '2026-02-30' matches a date-shaped regex but is not a
-- real date, so a regex test is not sufficient — this actually attempts the cast.
CREATE OR REPLACE FUNCTION "hrpulse_safe_date"(t TEXT) RETURNS DATE AS $$
BEGIN
    RETURN t::date;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4a. Copy across, collapsing duplicates as we go. DISTINCT ON keeps the highest
--     id per (employee, date) — the most recently imported row. The duplicates
--     are NOT deleted; they remain in attendance_records.
INSERT INTO "attendance_days" (
    "id", "upload_id", "employee_id", "record_date", "status", "time_in_raw", "time_out_raw"
)
SELECT DISTINCT ON ("employee_id", "hrpulse_safe_date"("record_date"))
    "id",
    "upload_id",
    "employee_id",
    "hrpulse_safe_date"("record_date"),
    "status",
    NULLIF("time_in", ''),
    NULLIF("time_out", '')
FROM "attendance_records"
WHERE "hrpulse_safe_date"("record_date") IS NOT NULL
ORDER BY "employee_id", "hrpulse_safe_date"("record_date"), "id" DESC
ON CONFLICT DO NOTHING;

-- 4b. Record rows whose date could not be parsed.
INSERT INTO "attendance_records_unmigrated" (
    "id", "upload_id", "employee_id", "record_date", "status", "time_in", "time_out", "reason"
)
SELECT "id", "upload_id", "employee_id", "record_date", "status", "time_in", "time_out",
       'unparseable record_date'
FROM "attendance_records"
WHERE "hrpulse_safe_date"("record_date") IS NULL
ON CONFLICT ("id") DO NOTHING;

-- 4c. Record duplicates that were superseded, so the collapse is auditable.
INSERT INTO "attendance_records_unmigrated" (
    "id", "upload_id", "employee_id", "record_date", "status", "time_in", "time_out", "reason"
)
SELECT ar."id", ar."upload_id", ar."employee_id", ar."record_date", ar."status",
       ar."time_in", ar."time_out",
       'duplicate — superseded by a later row for the same employee and date'
FROM "attendance_records" ar
WHERE "hrpulse_safe_date"(ar."record_date") IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "attendance_days" ad WHERE ad."id" = ar."id")
ON CONFLICT ("id") DO NOTHING;

-- 4d. Original ids were preserved above, so move the sequence past them.
SELECT setval(
    pg_get_serial_sequence('attendance_days', 'id'),
    COALESCE((SELECT MAX("id") FROM "attendance_days"), 0) + 1,
    false
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_days_upload_id_fkey') THEN
        ALTER TABLE "attendance_days"
            ADD CONSTRAINT "attendance_days_upload_id_fkey"
            FOREIGN KEY ("upload_id") REFERENCES "attendance_uploads" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_days_employee_id_fkey') THEN
        ALTER TABLE "attendance_days"
            ADD CONSTRAINT "attendance_days_employee_id_fkey"
            FOREIGN KEY ("employee_id") REFERENCES "employees" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. salary_structures — the new salary table, with DECIMAL money
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "salary_structures" (
    "id"                  SERIAL        NOT NULL,
    "employee_id"         INTEGER       NOT NULL,
    "effective_month"     TEXT          NOT NULL,
    "basic_salary"        DECIMAL(12,2) NOT NULL DEFAULT 0,
    "housing_allowance"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transport_allowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_allowances"    DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_deductions"    DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salary_structures_employee_id_effective_month_key"
    ON "salary_structures" ("employee_id", "effective_month");

-- salary_configs already has a unique (employee_id, effective_month), so there
-- is nothing to deduplicate. The float is rounded to 2dp on the way in — that is
-- the correction, not a loss.
INSERT INTO "salary_structures" ("id", "employee_id", "effective_month", "basic_salary")
SELECT "id", "employee_id", "effective_month", ROUND("basic_salary"::numeric, 2)
FROM "salary_configs"
ON CONFLICT DO NOTHING;

SELECT setval(
    pg_get_serial_sequence('salary_structures', 'id'),
    COALESCE((SELECT MAX("id") FROM "salary_structures"), 0) + 1,
    false
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salary_structures_employee_id_fkey') THEN
        ALTER TABLE "salary_structures"
            ADD CONSTRAINT "salary_structures_employee_id_fkey"
            FOREIGN KEY ("employee_id") REFERENCES "employees" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Payroll runs (new table)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "payroll_runs" (
    "id"                 TEXT          NOT NULL,
    "period_month"       TEXT          NOT NULL,
    "status"             TEXT          NOT NULL DEFAULT 'draft',
    "employee_count"     INTEGER       NOT NULL DEFAULT 0,
    "total_gross"        DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net"          DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adamrit_payload"    JSONB,
    "adamrit_response"   JSONB,
    "adamrit_voucher_no" TEXT,
    "idempotency_key"    TEXT,
    "error_message"      TEXT,
    "calculated_at"      TIMESTAMP(3),
    "approved_at"        TIMESTAMP(3),
    "posted_at"          TIMESTAMP(3),
    "created_at"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_period_month_key" ON "payroll_runs" ("period_month");
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_idempotency_key_key" ON "payroll_runs" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "payroll_runs_status_idx" ON "payroll_runs" ("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Clean up the helper
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS "hrpulse_safe_date"(TEXT);
