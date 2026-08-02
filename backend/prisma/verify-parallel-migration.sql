-- Reconciliation for the 20260802000000_adamrit_parallel_tables migration.
-- Read-only: every statement is a SELECT. Safe to run against production.
--
--   psql "$DATABASE_URL" -f backend/prisma/verify-parallel-migration.sql
--
-- Run this BEFORE trusting attendance_days, and keep the original tables until
-- the numbers below make sense to you.

\echo '=== 1. Row accounting: every original row is accounted for ==='
-- carried_over + unmigrated MUST equal original. If it does not, stop.
SELECT
    (SELECT count(*) FROM attendance_records)              AS original_rows,
    (SELECT count(*) FROM attendance_days)                 AS carried_over,
    (SELECT count(*) FROM attendance_records_unmigrated)   AS not_carried,
    (SELECT count(*) FROM attendance_days)
      + (SELECT count(*) FROM attendance_records_unmigrated) AS accounted_for,
    CASE WHEN (SELECT count(*) FROM attendance_records) =
              (SELECT count(*) FROM attendance_days)
            + (SELECT count(*) FROM attendance_records_unmigrated)
         THEN 'OK' ELSE '*** MISMATCH — INVESTIGATE ***' END AS verdict;

\echo ''
\echo '=== 2. Why rows were not carried over ==='
SELECT reason, count(*) AS rows
FROM attendance_records_unmigrated
GROUP BY reason
ORDER BY rows DESC;

\echo ''
\echo '=== 3. Unparseable dates — the ones needing a human decision ==='
-- Expect zero rows. Anything here is data the new table does not contain.
SELECT id, employee_id, record_date, status
FROM attendance_records_unmigrated
WHERE reason = 'unparseable record_date'
ORDER BY id
LIMIT 50;

\echo ''
\echo '=== 4. Distinct (employee, date) pairs must match exactly ==='
-- The copy deduplicates, so raw counts differ; distinct pairs must not.
SELECT
    (SELECT count(*) FROM (
        SELECT DISTINCT employee_id, record_date FROM attendance_records
        WHERE record_date ~ '^\d{4}-\d{2}-\d{2}$'
    ) s)                                                    AS original_distinct_pairs,
    (SELECT count(*) FROM attendance_days)                  AS new_rows,
    CASE WHEN (SELECT count(*) FROM (
        SELECT DISTINCT employee_id, record_date FROM attendance_records
        WHERE record_date ~ '^\d{4}-\d{2}-\d{2}$'
    ) s) = (SELECT count(*) FROM attendance_days)
    THEN 'OK' ELSE '*** MISMATCH (may be explained by invalid dates like 2026-02-30) ***' END AS verdict;

\echo ''
\echo '=== 5. Spot-check: statuses survived the copy unchanged ==='
SELECT status, count(*) AS new_rows FROM attendance_days GROUP BY status ORDER BY new_rows DESC;

\echo ''
\echo '=== 6. Date range covered ==='
SELECT min(record_date) AS earliest, max(record_date) AS latest, count(DISTINCT employee_id) AS employees
FROM attendance_days;

\echo ''
\echo '=== 7. Salary: row count and total must match to the cent ==='
SELECT
    (SELECT count(*) FROM salary_configs)                        AS original_rows,
    (SELECT count(*) FROM salary_structures)                     AS copied_rows,
    (SELECT ROUND(SUM(basic_salary)::numeric, 2) FROM salary_configs)    AS original_total,
    (SELECT SUM(basic_salary) FROM salary_structures)            AS copied_total,
    CASE WHEN (SELECT count(*) FROM salary_configs) = (SELECT count(*) FROM salary_structures)
         THEN 'OK' ELSE '*** ROW COUNT MISMATCH ***' END         AS verdict;

\echo ''
\echo '=== 8. Any salary value that changed by more than a rounding cent ==='
-- Expect zero rows. A float like 4999.999999 legitimately becomes 5000.00.
SELECT sc.id, sc.employee_id, sc.basic_salary AS original, ss.basic_salary AS copied,
       ABS(sc.basic_salary::numeric - ss.basic_salary) AS delta
FROM salary_configs sc
JOIN salary_structures ss ON ss.id = sc.id
WHERE ABS(sc.basic_salary::numeric - ss.basic_salary) > 0.005
ORDER BY delta DESC
LIMIT 50;

\echo ''
\echo '=== 9. Sequences are past the copied ids (new inserts will not collide) ==='
SELECT 'attendance_days'   AS tbl,
       (SELECT COALESCE(MAX(id), 0) FROM attendance_days)   AS max_id,
       (SELECT last_value FROM attendance_days_id_seq)      AS seq_value
UNION ALL
SELECT 'salary_structures',
       (SELECT COALESCE(MAX(id), 0) FROM salary_structures),
       (SELECT last_value FROM salary_structures_id_seq);

\echo ''
\echo '=== 10. Confirm the originals were not modified ==='
-- record_date must still be text, basic_salary must still be double precision.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_name = 'attendance_records' AND column_name IN ('record_date', 'time_in', 'time_out'))
   OR (table_name = 'salary_configs'     AND column_name = 'basic_salary')
ORDER BY table_name, column_name;
