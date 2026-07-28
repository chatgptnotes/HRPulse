# HRPulse — Full Session Log

**Date:** 15 July 2026
**Project:** HRPulse (Node/Express backend + Vite/React frontend, Supabase DB)
**Scope:** All local changes, edits, fixes, and features built during this session.

---

## Table of Contents
1. [Environment & Servers](#1-environment--servers)
2. [Rules Page Render Fix](#2-rules-page-render-fix)
3. [Payroll — Salary Column & Layout](#3-payroll--salary-column--layout)
4. [Sunday = Weekly Off + Monthly Paid Leaves](#4-sunday--weekly-off--monthly-paid-leaves)
5. [Payroll Divisor = 30 & Overtime Removed](#5-payroll-divisor--30--overtime-removed)
6. [Currency AED → INR](#6-currency-aed--inr)
7. [Employee Master (Major Feature)](#7-employee-master-major-feature)
8. [Paid-Leave Eligibility (Per Employee)](#8-paid-leave-eligibility-per-employee)
9. [Late Penalty (3 Lates = 1 Day) & 9:30 AM Cutoff](#9-late-penalty-3-lates--1-day--930-am-cutoff)
10. [Paid Leave Excuses Actual Absences](#10-paid-leave-excuses-actual-absences)
11. [Upload History Delete](#11-upload-history-delete)
12. [No-Punch Filter](#12-no-punch-filter)
13. [Supabase Migrations & Settings](#13-supabase-migrations--settings)
14. [Files Changed (Index)](#14-files-changed-index)

---

## 1. Environment & Servers

- **Backend:** Express on `http://localhost:3001` (`npm run dev --workspace=backend`, ts-node-dev with `--respawn`).
- **Frontend:** Vite on `http://localhost:5173` (`npm run dev --workspace=frontend`), proxies `/api` → backend.
- **DB:** Supabase project `lhqalhmlamdyjmeinozo`.
- Run both: `npm run dev` (concurrently).

---

## 2. Rules Page Render Fix

**Problem:** The Rules page was blank / not opening.
**Root cause:** Backend returns **snake_case** fields (`rule_type`, `is_active`, `created_at`) but the page read **camelCase** (`ruleType`, `isActive`), so `rule.ruleType.replace(...)` threw `Cannot read properties of undefined`, crashing the render.

**Fix:** Aligned the `Rule` interface and all reads with the actual API shape.

**File:** `frontend/src/pages/RulesPage.tsx`
- Changed interface: `ruleType → rule_type`, `isActive → is_active`, `createdAt → created_at`.
- Updated all `rule.*` reads and the `openEdit()` mapper.
- Internal form `ruleType` kept camelCase (the POST body sends `ruleType`, read by backend).

Verified: `GET /api/rules` returned 200 with data; `tsc --noEmit` passed.

---

## 3. Payroll — Salary Column & Layout

- Added an **editable Salary** input column in the Payroll table (saved via `PUT /salary/configs`, refetched the run).
- **Swapped** the **Salary** and **Department** column positions (Salary now after *Absent*).
- Later reverted the inline editing: salary is now **read-only** and sourced from the **Employee Master** (`employees.monthly_salary`).

**File:** `frontend/src/pages/PayrollPage.tsx`

---

## 4. Sunday = Weekly Off + Monthly Paid Leaves

**Backend:** `backend/src/services/payrollService.ts`

- Added `isSunday(recordDate)` helper (parses `YYYY-MM-DD`, checks `getDay() === 0`).
- Any record on a Sunday is classified as `weekly_off` (paid) in:
  - `computeEmployeePayroll` (table calculation)
  - `buildEmployeeDetail` (modal day-by-day breakdown)
- Added `paidLeaveDays` to `PayrollSettings` (default **2**), parsed from setting `paid_leave_days`.
- `paidLeave` is now passed into `computeEmployeePayroll` as a parameter (per-employee).

---

## 5. Payroll Divisor = 30 & Overtime Removed

**Divisor = 30 (UAE/WPS standard):**
- `DEFAULT_PAYROLL_SETTINGS.workingDays` changed from 26 → **30**.
- DB setting `working_days` updated to `30` via `PUT /api/settings`.
- Daily salary = `monthlySalary / 30`.

**Overtime fully removed:**
- Stopped accumulating `overtimeHours`.
- `overtimePay = 0`; `grossSalary = dailySalary * payableDays` (no OT add).
- Mirrored in `buildEmployeeDetail`.
- Removed OT rows/columns from the View Details modal and the day-by-day table.

**Files:** `backend/src/services/payrollService.ts`, `frontend/src/components/payroll/PayrollDetailModal.tsx`

---

## 6. Currency AED → INR

Replaced every **AED** with **INR** in payroll money labels:
- **View Details modal:** Monthly Salary, Daily, Hourly, Earned, Gross, Deductions, Net Salary.
- **Payroll page:** "Total Salary Payable" summary card.
- **Salary/LOP page:** "Basic Salary (INR)", "LOP Amount (INR)" column headers.

Left the Landing page marketing text ("0 AED" cloud cost) untouched.

**Files:** `frontend/src/components/payroll/PayrollDetailModal.tsx`, `frontend/src/pages/PayrollPage.tsx`, `frontend/src/pages/SalaryPage.tsx`

---

## 7. Employee Master (Major Feature)

Converted the Employees page into a full **Employee Master** with manual management.

**Stored fields:** Employee ID, Name, Mobile, Department, Designation, Shift, Monthly Salary, Status (Active/Inactive), Paid-Leave eligibility.

### DB migration (new columns)
`mobile`, `shift`, `monthly_salary`, `status` added to `employees` (see §13).

### Backend — `backend/src/routes/employees.ts` (full rewrite)
- `GET /` (list), `GET /:id`, `POST /` (create), `PATCH /:id` (update), `DELETE /:id`, photo upload.
- **Resilient column probing:** `ensureMasterColsKnown()` lazily detects whether the new columns exist, so the API works before the migration is applied. Called in every handler (fixed a bug where POST before GET skipped master fields).
- Auto-generates an email for legacy schema when not supplied.

### Payroll reads salary from the master
`backend/src/routes/payroll.ts`:
- Added `monthly_salary` to `EMP_FULL_COLS` (dropped `biometric_id` which doesn't exist in this DB).
- `monthly = emp.monthly_salary || salary_configs fallback || 0`.
- Mirrored in the employee detail endpoint.

### Attendance import no longer creates employees
New `backend/src/services/employeeMatch.ts`:
- `matchEmployees()` loads the master once, resolves each parsed record by **Employee ID → Name**, skips unmatched rows with a warning.
- Wired into both `POST /api/attendance/upload` and `POST /api/payroll/process` (replaced the old `upsert` logic). No more junk employees (e.g. "08:32 16:10").

### Frontend
- `frontend/src/api/index.ts`: added `createEmployee`, `deleteEmployee`, `EmployeeMaster` type.
- `frontend/src/pages/EmployeesPage.tsx`: full rewrite — modern HRMS table, **"+ Add Employee"** button, stat cards, search + filters, edit/delete with confirm dialogs, photo upload.

---

## 8. Paid-Leave Eligibility (Per Employee)

**Rule:** Only employees explicitly marked **Yes** get 2 paid leaves. Default = **No** (nobody gets it unless selected).

### DB migration
Added `paid_leaves_eligible boolean DEFAULT false` (see §13).

### Backend — `backend/src/routes/employees.ts`
- Separate independent probe for `paid_leaves_eligible` (so a missing column never regresses core master fields).
- Mapping defaults to `false` (`paidLeavesEligible: e.paid_leaves_eligible === true`).
- Payload writes it only when the column exists.

### Backend — payroll (`routes/payroll.ts`)
- Added `paid_leaves_eligible` to `EMP_FULL_COLS`.
- `paidLeaveDays = emp.paid_leaves_eligible === true ? settings.paidLeaveDays : 0`.

### Frontend — `frontend/src/pages/EmployeesPage.tsx`
- Add/Edit modal: **"Eligible for 2 Paid Leaves"** Yes/No option.
- Table: **Paid Leaves** column ("Yes (2)" / "No" badge).
- **"Paid Leaves" button** filters the list to eligible employees only.
- (A standalone "Paid Leave Configuration" page was built then removed/consolidated into Employee Master per request.)

---

## 9. Late Penalty (3 Lates = 1 Day) & 9:30 AM Cutoff

**Late cutoff = 9:30 AM** (via settings):
- `shift_start` stays `09:00`, `late_grace_minutes` set to **30** → cutoff = 9:00 + 30 = 9:30.
- A punch after 9:30 AM, **or** an Excel "Late Coming" status, counts as a late day.

**Deduction rule (hardcoded at 3):**
```ts
const lateDeductionDays = Math.floor(lateDays / 3);
const latePenalty = dailySalary * lateDeductionDays;
```
| Late days | Days deducted |
|:-:|:-:|
| 1–2 | 0 |
| 3–5 | 1 |
| 6–8 | 2 |
| 9–11 | 3 |

- Added `lateDeductionDays` to `PayrollRow` and the return object.
- Mirrored in `buildEmployeeDetail`.
- **Modal visibility:** a "Late deduction (N lates ÷ 3 = M days) · −INR X" line.

**Files:** `backend/src/services/payrollService.ts`, `frontend/src/components/payroll/PayrollDetailModal.tsx`

---

## 10. Paid Leave Excuses Actual Absences

Eligible employees: paid leave now **excuses up to 2 actual absent days** (paid). Remaining absences stay unpaid.

```ts
const paidLeave = Math.min(paidLeaveDays, absentDays);
const unpaidAbsent = absentDays - paidLeave;
```
- The row's `absentDays` returns the **unpaid remainder**.
- Example: 3 absences → **2 paid leave + 1 absent**.
- View Details modal shows the split: "Paid Leaves (monthly)" + "Absent Days (unpaid)".

**Verified:**
- Praful WB (2 absences, eligible): absent=0, paidLeave=2, payableDays=30.
- admin (26 absences, eligible): absent=24, paidLeave=2.

**File:** `backend/src/services/payrollService.ts`

---

## 11. Upload History Delete

Added a delete option in **Payroll → Upload History**.

- **Trash button** next to each upload's *Load* button + a confirm dialog.
- Backend `DELETE /api/attendance/uploads/:id` removes `email_drafts` → `attendance_records` → `attendance_uploads` (FK-safe order, no orphans).
- Refreshes history/filters; clears the view if the active upload was deleted; toast confirmation.

**Files:** `frontend/src/pages/PayrollPage.tsx`, `backend/src/routes/attendance.ts`
*(This was built once, reverted, then re-added per request.)*

---

## 12. No-Punch Filter

A **"No Punch"** button next to the Employee search filters the Payroll table to show only employees with **zero in/out punches** in the period.

**Backend:** `payrollService.ts`
- Added `punchCount` to `PayrollRow`.
- In the loop: `if (day.timeIn || day.timeOut) punchCount++;`

**Frontend:** `PayrollPage.tsx`
- `onlyNoPunch` filter state; button toggles it (turns amber when active).
- Filter: `if (onlyNoPunch && r.punchCount > 0) return false`.
- Reset clears it; context-aware empty state.

---

## 13. Supabase Migrations & Settings

### Migration SQL (run in Supabase SQL Editor) — `backend/src/db/migrations/employee_master.sql`
```sql
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mobile text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_salary numeric(12,2) DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS paid_leaves_eligible boolean DEFAULT false;
```

### Runtime settings tuned via `PUT /api/settings`
| Key | Value | Effect |
|-----|-------|--------|
| `working_days` | `30` | Daily rate divisor |
| `late_grace_minutes` | `30` | Late cutoff = 9:30 AM |
| `paid_leave_days` | `2` | Paid-leave allowance |

### Note on column probing
The backend caches a one-time schema probe per process. After running a migration, **restart the backend** so it re-detects the new columns (verified during testing — paid-leave choices didn't persist until restart).

---

## 14. Photo Upload Removed from Employee Master

Removed the photo-upload feature entirely from the Employee Master.

**Removed:**
- The hover **"photo_camera" upload button** and hidden `<input type="file">` on each employee row.
- `handlePhotoUpload()` function, `photoInputRef`, and `uploadingPhotoFor` state.
- `useRef` import (no longer needed).
- `uploadEmployeePhoto` API helper (`api/index.ts`) — no longer used anywhere.

**Kept:** the avatar display itself (gradient with the employee's initial, or an existing photo if one was already set) — just no upload action.

The backend `/employees/:id/photo` route still exists but is no longer called from the UI.

**Files:** `frontend/src/pages/EmployeesPage.tsx`, `frontend/src/api/index.ts`

---

## 15. Cleared Uploaded Photo (aasha.take)

An employee photo had been uploaded earlier (via the now-removed function) and needed to be deleted.

**Employee:** aasha.take (id 4166) — `photo_url` was `/uploads/photos/emp-4166-1784121247355.jpg`.

**Actions performed (one-off script via Supabase client):**
- Set `employees.photo_url = null` for id 4166.
- Deleted the image file from disk: `backend/uploads/photos/emp-4166-1784121247355.jpg`.

**Verified:** before `{"photo_url":"/uploads/photos/..."}` → after `{"photo_url":null}`. The employee now shows the default gradient avatar with their initial.

---

## 16. Files Changed (Index)

### Backend
- `backend/src/services/payrollService.ts` — Sunday weekly off, divisor 30, overtime removed, per-employee paid leave, late deduction, paid-leave-excuses-absence, punchCount.
- `backend/src/routes/payroll.ts` — reads salary from master, per-employee paid leave, matcher integration.
- `backend/src/routes/employees.ts` — full Employee Master CRUD + resilient probes.
- `backend/src/routes/attendance.ts` — matcher integration, delete cleanup.
- `backend/src/services/employeeMatch.ts` — **new** file (attendance → master matcher).
- `backend/src/db/migrations/employee_master.sql` — **new** file (migration).

### Frontend
- `frontend/src/pages/RulesPage.tsx` — snake_case fix.
- `frontend/src/pages/PayrollPage.tsx` — salary column, delete upload, No-Punch filter, INR.
- `frontend/src/pages/EmployeesPage.tsx` — full Employee Master rewrite + Paid Leaves.
- `frontend/src/pages/SalaryPage.tsx` — INR headers.
- `frontend/src/components/payroll/PayrollDetailModal.tsx` — INR, OT removed, late-deduction line, paid-leave split.
- `frontend/src/api/index.ts` — create/delete employee + EmployeeMaster type.

### Removed
- `frontend/src/pages/PaidLeavePage.tsx` (standalone page consolidated into Employee Master).

---

*End of session log — all changes are local to the backend and frontend workspaces.*
