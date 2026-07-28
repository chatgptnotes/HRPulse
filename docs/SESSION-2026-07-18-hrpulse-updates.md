# HR Pulse Session Log - 2026-07-18

## Summary

This session focused on improving HR Pulse payroll, salary, dispatcher, shifts, and payslip workflows while keeping the existing app structure and design language. Most changes were frontend UI/UX improvements, with one database-backed feature added for persistent salary payment statuses.

## Payroll / Salary Calculation Page

- Simplified the Payroll / Salary Calculation page after the richer chart-heavy redesign.
- Removed unnecessary attendance charts and graph-heavy analytics from the payroll page.
- Kept the current HR Pulse visual style: dark sidebar, purple theme, rounded cards, soft shadows, and clean SaaS layout.
- Kept the existing upload card and payroll backend/API behavior.
- Reduced the main metrics to practical HR-facing cards:
  - Total Employees
  - Present Employees
  - Pending Employees
  - Salary Payable
- Replaced charts with a simple Payroll Summary section:
  - Gross Salary
  - Total Deductions
  - Net Payable
  - Processed Employees
  - Pending Employees
- Added a Quick Actions panel:
  - Generate Payslips
  - Send Salary Emails
  - Export Excel
  - Process Salary
- Verified with `npm run build` in `frontend`.

## Salary Dashboard

- Clarified that salary amount should come directly from the Employee section, not manual entry in Salary Dashboard.
- Removed manual salary editing from the Salary Dashboard table.
- Removed the old frontend-only salary override behavior.
- Salary amount now reads from Employee Master salary data.
- LOP/deductions continue to come from attendance calculation.

## Saved Paid / Pending / On Hold / Resigned Status

- Planned and implemented persistent month-wise salary payment statuses.
- Added new Supabase table:
  - `salary_payments`
- Added migration:
  - `backend/supabase/migrations/20260718_salary_payments.sql`
- Updated schema:
  - `backend/supabase/schema.sql`
- Added backend endpoints:
  - `GET /api/salary/payments?month=YYYY-MM`
  - `PUT /api/salary/payments/:employeeId`
- Updated frontend API helpers:
  - `getSalaryPayments`
  - `saveSalaryPayment`
- Updated Salary Dashboard behavior:
  - Default status is `Pending` if no saved record exists.
  - `Mark as Paid` saves paid status, paid amount, and payment date.
  - `Hold Payment` saves on-hold status with a reason.
  - `Mark Pending` saves pending status.
  - `Mark Resigned` saves resigned status.
- Applied the Supabase migration using the Supabase Management API.
- Verified `salary_payments` table exists in Supabase.
- Verified local backend endpoint:
  - `/api/salary/payments?month=2026-07`
- Restarted backend after migration.
- Security note: Supabase access token was not saved to `.env`; it should be rotated because it was pasted into chat.

## Salary Action Menu and Payslip

- Fixed the Salary Dashboard three-dot action menu clipping issue.
- Menu now uses fixed viewport positioning so it opens properly near bottom rows.
- Menu closes on scroll or resize.
- Separated Salary action behavior:
  - `Generate Payslip` opens a payslip preview modal.
  - `Download PDF` downloads the PDF directly.
  - Preview modal also includes a Download PDF button.
- Improved downloaded payslip PDF design:
  - HRPulse header band
  - Employee identity section
  - Status badge
  - Monthly salary, gross salary, and net payable cards
  - Earnings section
  - Deductions section
  - Final net salary highlight
  - Payment and attendance details
  - Footer text
- Renamed generated file format to:
  - `payslip-employee-month.pdf`
- Verified with frontend build.

## Dispatcher Page

- Redesigned the existing Dispatcher page as a compact attendance command center.
- Kept existing backend, APIs, database, and project structure.
- Added compact left control panel with:
  - Upload attendance file
  - Verification status
  - Process Attendance button
  - Workflow steps
  - Quick actions
  - AI Summary
- Added workflow:
  - Upload File
  - Verify Data
  - Apply HR Rules
  - Calculate Attendance
  - Ready to Dispatch
- Added quick actions:
  - Apply HR Rules
  - Check Missing Punch
  - Export Excel
  - Dispatch Emails
- Added AI Summary:
  - Missing punches
  - Duplicate records
  - Absent employees
  - Pending dispatch
- Added summary cards:
  - Total Employees
  - Missing Punch
  - Absent
  - Late
  - Ready to Dispatch
- Added filters:
  - Department
  - Shift
  - Status
  - Missing Punch
  - Employee Search
- Added modern employee table with:
  - Employee avatar
  - Employee name
  - Department
  - Shift
  - In Time
  - Out Time
  - Status badge
  - Actions
- Kept existing email draft preview, send, bulk dispatch, inspect Excel, and punch sheet behavior.
- Fixed Dispatcher Department dropdown to show the full shared department list like Payroll:
  - Doctor
  - Nurse
  - Pharmacist
  - Lab Technician
  - Radiology
  - Reception
  - Administration
  - HR
  - Finance
  - IT
  - Operations
  - Housekeeping
  - Security
  - plus custom employee departments.
- Verified with frontend build.

## Shared Shift List

- Added shared shift constant:
  - `frontend/src/constants/shifts.ts`
- Added default hospital-focused shifts:
  - General Shift
  - Morning Shift
  - Afternoon Shift
  - Evening Shift
  - Night Shift
  - Day Shift
  - Weekend Shift
  - Split Shift
  - Rotational Shift
  - On Call
  - 12 Hour Day
  - 12 Hour Night
- Wired shared shift list into:
  - Employee Master add/edit form
  - Employee Master shift filter
  - Dispatcher shift filter
  - Payroll shift filter
- Kept support for custom shift values already saved on employees.
- Added normalization to avoid duplicate options:
  - `General` becomes `General Shift`
  - `Morning` becomes `Morning Shift`
  - Similar cleanup for Afternoon, Evening, Night, Day, Weekend, Split, Rotational, and On Call.
- Verified with frontend build.

## Attendance Punch Timing PDF

- Updated punch timing PDF behavior earlier in the session to show two sections:
  - Late Punch-Ins
  - Other Punch Records
- This keeps after-9:00 punch timing separate while still showing other punch timing details.

## WhatsApp / DoubleTick Template Guidance

- Discussed WhatsApp alert templates for late coming.
- Suggested template structure for DoubleTick approval:
  - Template title/name
  - Body text
  - Variables such as employee name, period month, late count, company name
  - Sample variable values for Meta review
- Explained that DoubleTick sample variable values can be realistic dummy values and should not contain actual customer/private data.
- Recommended no buttons for simple HR attendance warning templates unless an acknowledgement or contact action is required.

## Verification Completed

- Frontend build was run multiple times after changes:
  - `npm run build` in `frontend`
- Backend build was run after salary status API changes:
  - `npm run build` in `backend`
- Supabase migration was applied and verified:
  - `salary_payments` table exists.
  - Local backend salary payments endpoint returns successfully.

## Important Notes

- Salary payment status is now saved month-wise in `salary_payments`.
- Uploading a new attendance Excel updates attendance/LOP-related salary calculation data.
- Uploading a new Excel does not automatically mark employees Paid or Hold.
- HR controls Paid / Pending / On Hold / Resigned from the Salary Dashboard action menu.
- Employee Master remains the source for salary amount.
- Previous uploaded attendance files remain available unless deleted.
- Previous month salary can be recalculated from saved attendance and current rules/salary unless a future payroll snapshot/finalization feature is added.

## Main Files Changed Today

- `frontend/src/pages/PayrollPage.tsx`
- `frontend/src/pages/SalaryPage.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/EmployeesPage.tsx`
- `frontend/src/components/employees/EmployeeFormModal.tsx`
- `frontend/src/components/attendance/punchTimingPdf.ts`
- `frontend/src/api/index.ts`
- `frontend/src/constants/shifts.ts`
- `backend/src/routes/salary.ts`
- `backend/supabase/schema.sql`
- `backend/supabase/migrations/20260718_salary_payments.sql`

