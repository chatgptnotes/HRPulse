# HRPulse Session Log - 2026-07-20

## Summary

This note captures the local, uncommitted work present in the repository on 2026-07-20. The changes continue the HRPulse migration away from Prisma toward Supabase-backed routes, expand Employee Master fields, improve attendance upload behavior, add payroll processing, refine salary/payment workflows, and add punch-timing inspection/export tools.

No commits were found for today. All items below are working-tree changes.

## Backend Changes

### Supabase Database Access

- Added `backend/src/db/supabase.ts` with a shared Supabase client and `getSettings()` helper.
- Removed the old Prisma database module from `backend/src/db/prisma.ts`.
- Updated multiple backend routes/services to use Supabase row names and snake_case columns.
- Changed health output from `db: postgresql` to `db: supabase`.
- Added backend process guards for unhandled rejections and uncaught exceptions so transient Supabase or network errors are logged instead of crashing the server.

### Attendance Upload and Sheet Handling

- Updated attendance upload to match parsed attendance rows against existing Employee Master records.
- Added `backend/src/services/employeeMatch.ts`.
- Attendance upload now skips unknown employees instead of creating placeholder Employee Master rows.
- Added paginated record fetching to avoid PostgREST's 1000-row select cap.
- Added `POST /api/attendance/inspect` for no-database Excel diagnostics.
- Added `GET /api/attendance/sheet/:uploadId` to return a full punch in/out grid.
- Added large-file bulk insert behavior for attendance records.

### Payroll Processing

- Added payroll route mounting in `backend/src/index.ts`.
- Added `backend/src/routes/payroll.ts`.
- Added `backend/src/services/payrollService.ts`.
- Added payroll APIs for processing, history, filters, run lookup, and employee-level details.
- Added optional payroll database migration:
  - `backend/supabase/migrations/20260713_payroll.sql`

### Salary and Payment Status

- Updated salary routes to use Supabase.
- Added persistent salary payment APIs:
  - `GET /api/salary/payments?month=YYYY-MM`
  - `PUT /api/salary/payments/:employeeId`
- Added salary payment statuses:
  - pending
  - paid
  - on_hold
  - resigned
- Salary deductions now prefer Employee Master `monthly_salary`, with salary config fallback.
- Added salary-affecting rule support in `backend/src/services/salaryRules.ts`.

### Employee Master

- Reworked employee CRUD routes to use Supabase.
- Added support for Employee Master fields:
  - employee number
  - name
  - email
  - mobile
  - department
  - designation
  - shift
  - monthly salary
  - status
  - photo URL
  - paid leave eligibility
  - shift start time
  - shift end time
- Added defensive schema probing so the API can still respond if newer optional columns are not yet migrated.
- Added employee delete endpoint.
- Added migration for employee shift timing:
  - `backend/supabase/migrations/20260720_employee_shift_timing.sql`

### Rules, Emails, Analytics, AI, SOPs, Settings

- Updated routes to follow the Supabase-backed data access pattern.
- Fixed or continued migration of snake_case/camelCase mapping across route responses.
- Updated related services including:
  - `backend/src/services/emailService.ts`
  - `backend/src/services/excelParser.ts`
  - `backend/src/services/ollamaService.ts`
  - `backend/src/services/ruleEngine.ts`

## Frontend Changes

### Payroll Page

- Added `/payroll` route to `frontend/src/App.tsx`.
- Added `frontend/src/pages/PayrollPage.tsx`.
- Added payroll UI components:
  - `frontend/src/components/payroll/PayrollDetailModal.tsx`
  - `frontend/src/components/payroll/AttendanceCharts.tsx`
  - `frontend/src/components/payroll/SalarySummaryCard.tsx`
  - `frontend/src/components/payroll/UploadCard.tsx`
  - `frontend/src/components/payroll/format.ts`
- Added payroll API helpers in `frontend/src/api/index.ts`.

### Dashboard / Dispatcher

- Redesigned Dashboard as a richer attendance dispatch view.
- Added attendance sheet modal integration.
- Added Excel inspect modal integration.
- Added filters for department, shift, status, and missing-punch-only views.
- Added pagination and better summary/status handling.
- Updated action text from email-generation language toward dispatch/processing language.

### Employee Master UI

- Expanded `frontend/src/pages/EmployeesPage.tsx`.
- Added employee UI components:
  - `EmployeeActionMenu.tsx`
  - `EmployeeAvatar.tsx`
  - `EmployeeFormModal.tsx`
  - `EmployeeProfileDrawer.tsx`
  - `EmployeeStatCard.tsx`
  - `employeeCsv.ts`
  - `types.ts`
- Employee forms now include salary, shift, shift timing, status, paid leave eligibility, and contact fields.
- Added employee create/update/delete API helpers.

### Salary Dashboard

- Reworked `frontend/src/pages/SalaryPage.tsx` into a payment-status dashboard.
- Salary amount is sourced from Employee Master rather than manual salary editing.
- Added month-wise payment status actions.
- Added payslip preview/download behavior.
- Added salary budget summary and payment status filtering.

### Punch Timing Tools

- Added `frontend/src/utils/punchTiming.ts` for time parsing and formatting.
- Added `frontend/src/components/attendance/punchTimingPdf.ts` for per-employee punch timing PDF export.
- Added attendance components:
  - `AttendanceSheetModal.tsx`
  - `InspectExcelModal.tsx`

### Shared Constants and Styling

- Added shared department and shift constants:
  - `frontend/src/constants/departments.ts`
  - `frontend/src/constants/shifts.ts`
- Updated global CSS and Vite config.
- Updated frontend dependencies.

## Database / Migration Files

New or changed database files present locally:

- `backend/supabase/schema.sql`
- `backend/supabase/migrations/20260713_payroll.sql`
- `backend/supabase/migrations/20260718_salary_payments.sql`
- `backend/supabase/migrations/20260720_employee_shift_timing.sql`
- `backend/src/db/migrations/employee_master.sql`

## Scripts and Local Test Files

New local diagnostic/test files under `backend/scripts/`:

- `crosstab.xlsx`
- `diag.mjs`
- `test-crosstab.mjs`
- `test-html-xls.cjs`
- `test-html-xls.ts`
- `test-html.xls`
- `test-upload-html-xls.ts`
- `test-xls-upload.ts`
- `test.xls`

Runtime log files currently present:

- `backend-prod.log`
- `backend-run.log`
- `backend-run2.log`
- `backend-startup.log`
- `backend.log`
- `frontend.log`
- `server.log`

These appear to be local runtime/debug artifacts, not source code.

## Git Working Tree Snapshot

Tracked files changed:

- `backend/package.json`
- `backend/src/db/prisma.ts` deleted
- `backend/src/db/seed.ts`
- `backend/src/index.ts`
- `backend/src/routes/ai.ts`
- `backend/src/routes/analytics.ts`
- `backend/src/routes/attendance.ts`
- `backend/src/routes/emails.ts`
- `backend/src/routes/employees.ts`
- `backend/src/routes/rules.ts`
- `backend/src/routes/salary.ts`
- `backend/src/routes/settings.ts`
- `backend/src/routes/sops.ts`
- `backend/src/services/emailService.ts`
- `backend/src/services/excelParser.ts`
- `backend/src/services/ollamaService.ts`
- `backend/src/services/ruleEngine.ts`
- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/api/index.ts`
- `frontend/src/components/layout/Sidebar.tsx`
- `frontend/src/index.css`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/EmployeesPage.tsx`
- `frontend/src/pages/RulesPage.tsx`
- `frontend/src/pages/SalaryPage.tsx`
- `frontend/vite.config.ts`
- `package-lock.json`

New untracked source/doc files include:

- `SESSION-WORK.md`
- `backend/src/db/supabase.ts`
- `backend/src/routes/payroll.ts`
- `backend/src/services/employeeMatch.ts`
- `backend/src/services/payrollService.ts`
- `backend/src/services/salaryRules.ts`
- `frontend/src/pages/PayrollPage.tsx`
- `frontend/src/components/attendance/*`
- `frontend/src/components/employees/*`
- `frontend/src/components/payroll/*`
- `frontend/src/constants/*`
- `frontend/src/utils/*`
- `docs/*`

## Verification Status

- `git status --short` was checked.
- `git diff --stat` was checked.
- No build or test command was run while creating this note.

## Open Follow-ups

- Decide whether runtime log files should be ignored or deleted before committing.
- Decide whether diagnostic Excel/script files under `backend/scripts/` should be committed.
- Apply any pending Supabase migrations before relying on new Employee Master or salary payment fields in production.
- Run backend and frontend builds/tests before committing.

