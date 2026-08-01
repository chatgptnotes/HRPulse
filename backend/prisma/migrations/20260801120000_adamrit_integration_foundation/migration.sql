-- Adamrit integration foundation.
--
-- Hand-written rather than auto-generated: three of these steps are destructive
-- or impossible under Prisma's default DDL.
--   * attendance_records.record_date TEXT -> DATE needs an explicit USING cast.
--   * time_in / time_out TEXT -> TIMESTAMP has no safe cast (the strings carry no
--     date and no timezone), so the originals are preserved rather than dropped.
--   * the new UNIQUE (employee_id, record_date) cannot be created while duplicate
--     rows exist, so duplicates are collapsed first.
--
-- !! TAKE A DATABASE BACKUP BEFORE RUNNING THIS ON AN ENVIRONMENT WITH REAL DATA.
-- !! Step 4a DELETES rows. See the comment there for exactly which ones.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Employee: Adamrit ledger linkage
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees" ADD COLUMN "adamrit_ledger_id" TEXT;

-- Postgres permits unlimited NULLs under a UNIQUE index, so every not-yet-linked
-- employee coexists while linked ones are guaranteed distinct.
CREATE UNIQUE INDEX "employees_adamrit_ledger_id_key"
    ON "employees" ("adamrit_ledger_id");

CREATE INDEX "employees_employee_number_idx"
    ON "employees" ("employee_number");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Shifts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "shifts" (
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

CREATE UNIQUE INDEX "shifts_name_key" ON "shifts" ("name");
CREATE INDEX "shifts_role_target_idx" ON "shifts" ("role_target");

CREATE TABLE "employee_shifts" (
    "id"             TEXT         NOT NULL,
    "employee_id"    INTEGER      NOT NULL,
    "shift_id"       TEXT         NOT NULL,
    "effective_from" DATE         NOT NULL,
    "effective_to"   DATE,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_shifts_employee_id_shift_id_effective_from_key"
    ON "employee_shifts" ("employee_id", "shift_id", "effective_from");
CREATE INDEX "employee_shifts_employee_id_effective_from_idx"
    ON "employee_shifts" ("employee_id", "effective_from");

ALTER TABLE "employee_shifts"
    ADD CONSTRAINT "employee_shifts_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: deleting a shift pattern must not silently delete the
-- assignment history that payroll was calculated against.
ALTER TABLE "employee_shifts"
    ADD CONSTRAINT "employee_shifts_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "shifts" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Biometric punches
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "biometric_punches" (
    "id"          TEXT         NOT NULL,
    "employee_id" INTEGER      NOT NULL,
    "punch_time"  TIMESTAMP(3) NOT NULL,
    "punch_type"  VARCHAR(3)   NOT NULL,
    "device_id"   TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_punches_pkey" PRIMARY KEY ("id")
);

-- Makes replaying a device export idempotent.
CREATE UNIQUE INDEX "biometric_punches_employee_id_punch_time_punch_type_key"
    ON "biometric_punches" ("employee_id", "punch_time", "punch_type");
CREATE INDEX "biometric_punches_employee_id_punch_time_idx"
    ON "biometric_punches" ("employee_id", "punch_time");

ALTER TABLE "biometric_punches"
    ADD CONSTRAINT "biometric_punches_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. attendance_records refactor
-- ─────────────────────────────────────────────────────────────────────────────

-- 4a. Collapse duplicates so the new unique index can be created.
--
-- Keeps the HIGHEST id per (employee_id, record_date) — i.e. the most recently
-- imported row wins — and deletes the rest. Run the SELECT below first if you
-- want to see what will go:
--
--   SELECT employee_id, record_date, count(*)
--   FROM "attendance_records"
--   GROUP BY employee_id, record_date HAVING count(*) > 1;
--
DELETE FROM "attendance_records" a
    USING "attendance_records" b
WHERE a."employee_id" = b."employee_id"
  AND a."record_date" = b."record_date"
  AND a."id" < b."id";

-- 4b. record_date TEXT -> DATE. Existing values are 'yyyy-MM-dd', which is
--     unambiguous for ::date.
ALTER TABLE "attendance_records"
    ALTER COLUMN "record_date" TYPE DATE USING "record_date"::date;

-- 4c. Preserve the free-text times instead of destroying them. They hold values
--     like '09:15' with no date and no timezone, so there is no correct cast to
--     a timestamp; a backfill needs the shift date and the source timezone.
ALTER TABLE "attendance_records" RENAME COLUMN "time_in"  TO "time_in_raw";
ALTER TABLE "attendance_records" RENAME COLUMN "time_out" TO "time_out_raw";

ALTER TABLE "attendance_records" ADD COLUMN "time_in"  TIMESTAMP(3);
ALTER TABLE "attendance_records" ADD COLUMN "time_out" TIMESTAMP(3);

-- 4d. Computed lateness / earliness, in minutes against the resolved shift.
ALTER TABLE "attendance_records"
    ADD COLUMN "late_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "attendance_records"
    ADD COLUMN "early_minutes" INTEGER NOT NULL DEFAULT 0;

-- 4e. One row per person per day. This is the constraint whose absence allowed a
--     repeated upload to double every count feeding the LOP calculation.
CREATE UNIQUE INDEX "attendance_records_employee_id_record_date_key"
    ON "attendance_records" ("employee_id", "record_date");

CREATE INDEX "attendance_records_upload_id_idx"
    ON "attendance_records" ("upload_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Monetary precision
-- ─────────────────────────────────────────────────────────────────────────────

-- DOUBLE PRECISION -> DECIMAL(12,2). Values already stored are rounded to 2dp on
-- conversion; this is the correction, not a loss.
ALTER TABLE "salary_configs"
    ALTER COLUMN "basic_salary" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "salary_configs"
    ADD COLUMN "housing_allowance"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "transport_allowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "other_allowances"    DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "other_deductions"    DECIMAL(12,2) NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Payroll runs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "payroll_runs" (
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

CREATE UNIQUE INDEX "payroll_runs_period_month_key"
    ON "payroll_runs" ("period_month");
CREATE UNIQUE INDEX "payroll_runs_idempotency_key_key"
    ON "payroll_runs" ("idempotency_key");
CREATE INDEX "payroll_runs_status_idx" ON "payroll_runs" ("status");
