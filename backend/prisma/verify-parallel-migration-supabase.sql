-- Reconciliation for 20260802000000_adamrit_parallel_tables — SUPABASE EDITOR VERSION.
-- Single query, one result grid, read-only. Paste and Run.
--
-- The psql version (verify-parallel-migration.sql) uses \echo, which the
-- Supabase SQL editor does not support.
--
-- Read the `verdict` column first. Anything that is not 'OK' needs attention.

WITH counts AS (
    SELECT
        (SELECT count(*) FROM attendance_records)            AS orig_rows,
        (SELECT count(*) FROM attendance_days)               AS new_rows,
        (SELECT count(*) FROM attendance_records_unmigrated) AS unmigrated,
        (SELECT count(*) FROM salary_configs)                AS orig_salary,
        (SELECT count(*) FROM salary_structures)             AS new_salary
)
SELECT * FROM (

    -- 1. Every original attendance row must be accounted for.
    SELECT 1 AS seq,
           'attendance: rows accounted for' AS check_name,
           format('original=%s  copied=%s  unmigrated=%s  sum=%s',
                  orig_rows, new_rows, unmigrated, new_rows + unmigrated) AS detail,
           CASE WHEN orig_rows = new_rows + unmigrated
                THEN 'OK' ELSE '*** MISMATCH — INVESTIGATE ***' END AS verdict
    FROM counts

    UNION ALL
    -- 2. Distinct (employee, date) pairs must survive the dedup exactly.
    SELECT 2,
           'attendance: distinct employee-days preserved',
           format('original_distinct=%s  copied=%s',
                  (SELECT count(*) FROM (SELECT DISTINCT employee_id, record_date
                                         FROM attendance_records) s),
                  new_rows),
           CASE WHEN (SELECT count(*) FROM (SELECT DISTINCT employee_id, record_date
                                            FROM attendance_records) s) = new_rows
                THEN 'OK' ELSE 'CHECK — may be explained by invalid dates' END
    FROM counts

    UNION ALL
    -- 3. Why anything was left behind.
    SELECT 3,
           'attendance: not carried over — ' || reason,
           count(*)::text || ' row(s)',
           CASE WHEN reason = 'unparseable record_date'
                THEN '*** NEEDS A DECISION ***' ELSE 'expected' END
    FROM attendance_records_unmigrated
    GROUP BY reason

    UNION ALL
    -- 4. Salary rows must copy one-for-one.
    SELECT 4,
           'salary: row count',
           format('original=%s  copied=%s', orig_salary, new_salary),
           CASE WHEN orig_salary = new_salary THEN 'OK' ELSE '*** MISMATCH ***' END
    FROM counts

    UNION ALL
    -- 5. Salary total must match to the cent.
    SELECT 5,
           'salary: total value',
           format('original=%s  copied=%s',
                  COALESCE((SELECT ROUND(SUM(basic_salary)::numeric, 2) FROM salary_configs), 0),
                  COALESCE((SELECT SUM(basic_salary) FROM salary_structures), 0)),
           CASE WHEN COALESCE((SELECT ROUND(SUM(basic_salary)::numeric, 2) FROM salary_configs), 0)
                   = COALESCE((SELECT SUM(basic_salary) FROM salary_structures), 0)
                THEN 'OK' ELSE '*** MISMATCH ***' END

    UNION ALL
    -- 6. Any individual salary that moved by more than a rounding cent.
    SELECT 6,
           'salary: values changed beyond rounding',
           (SELECT count(*)::text FROM salary_configs sc
             JOIN salary_structures ss ON ss.id = sc.id
            WHERE ABS(sc.basic_salary::numeric - ss.basic_salary) > 0.005) || ' row(s)',
           CASE WHEN (SELECT count(*) FROM salary_configs sc
                       JOIN salary_structures ss ON ss.id = sc.id
                      WHERE ABS(sc.basic_salary::numeric - ss.basic_salary) > 0.005) = 0
                THEN 'OK' ELSE '*** VALUES CHANGED ***' END

    UNION ALL
    -- 7. PROOF the originals were not modified — types must be unchanged.
    SELECT 7,
           'original untouched: ' || table_name || '.' || column_name,
           'type is ' || data_type,
           CASE
             WHEN table_name = 'attendance_records' AND column_name = 'record_date'
                  AND data_type = 'text' THEN 'OK'
             WHEN table_name = 'attendance_records' AND column_name IN ('time_in','time_out')
                  AND data_type = 'text' THEN 'OK'
             WHEN table_name = 'salary_configs' AND column_name = 'basic_salary'
                  AND data_type = 'double precision' THEN 'OK'
             ELSE '*** ORIGINAL WAS ALTERED ***' END
    FROM information_schema.columns
    WHERE (table_name = 'attendance_records' AND column_name IN ('record_date','time_in','time_out'))
       OR (table_name = 'salary_configs' AND column_name = 'basic_salary')

    UNION ALL
    -- 8. Coverage sanity check.
    SELECT 8,
           'attendance_days: coverage',
           COALESCE(format('%s to %s across %s employee(s)',
                  (SELECT min(record_date) FROM attendance_days),
                  (SELECT max(record_date) FROM attendance_days),
                  (SELECT count(DISTINCT employee_id) FROM attendance_days)),
                  'TABLE IS EMPTY'),
           CASE WHEN (SELECT count(*) FROM attendance_days) > 0
                THEN 'OK' ELSE 'EMPTY — was the source table empty too?' END

) checks
ORDER BY seq, check_name;
