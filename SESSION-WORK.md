# HRPulse — Session Work & Decisions Log

> Complete record of everything discussed, built, fixed, and decided during this session.
> Last updated: 14 July 2026

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [How to Run Locally](#2-how-to-run-locally)
3. [Features Built This Session](#3-features-built-this-session)
4. [Bugs Fixed](#4-bugs-fixed)
5. [The Cross-Tab Excel Format (DUTY 05)](#5-the-cross-tab-excel-format-duty-05)
6. [Salary Calculation Formula](#6-salary-calculation-formula)
7. [Punch In / Punch Out View](#7-punch-in--punch-out-view)
8. [Attendance Status Handling Decisions](#8-attendance-status-handling-decisions)
9. [Current Data State](#9-current-data-state)
10. [Known Gaps & Pending Decisions](#10-known-gaps--pending-decisions)
11. [Complete File Change List](#11-complete-file-change-list)

---

## 1. Project Overview

**HRPulse** is an on-premises, AI-powered HR attendance & email-dispatch system for UAE/GCC organizations.

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL via **Supabase** (service_role key, snake_case tables) |
| AI | Local Ollama (llama3.1:8b) |
| Excel | SheetJS (xlsx) |

**Existing modules (before this session):** Dispatcher (attendance upload + email drafts), Employees, Salary/LOP, Email History, Rules Engine, SOPs, AI Insights, Analytics.

---

## 2. How to Run Locally

```bash
cd C:\Users\hope4\hrpulse\HRPulse

# Start backend (port 3001) — detached, logs to temp
npm run dev --workspace=backend

# Start frontend (port 5173) — detached, logs to temp
npm run dev --workspace=frontend
```

Or run both together: `npm run dev`

**Open:** http://localhost:5173

### Stable detached launch (PowerShell)
Use this form so the process survives (redirection **inside** `cmd /c` — avoids the parent hanging):
```powershell
$log = "$env:TEMP\opencode\hrpulse-be.log"
$cmd = "npm run dev --workspace=backend > `"$log`" 2>&1"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","$cmd" -WorkingDirectory "C:\Users\hope4\hrpulse\HRPulse" -WindowStyle Hidden
```

### Known operational note — backend stability
- The backend crashed repeatedly from a **transient Supabase "JWT issued at future"** error (clock skew) becoming an unhandled rejection.
- **Fixed:** added `process.on('unhandledRejection')` + `process.on('uncaughtException')` handlers in `backend/src/index.ts` → they now **log and keep serving** instead of crashing.
- **Root cause still open:** the Windows time service (`W32Time`) is not running, so the clock can drift. To fix at source (admin terminal):
  ```
  net start W32Time
  w32tm /resync /force
  ```

---

## 3. Features Built This Session

### A. Process Attendance & Calculate Salary (Payroll page) — `/payroll`
Full payroll processing page with attendance computation and salary calculation.
- **Backend:**
  - `services/payrollService.ts` — computation engine: classifies each day (present/half/absent/late/missing-punch/weekly-off/holiday), working hours, overtime, payable days, daily/hourly rate, gross, deductions, net.
  - `routes/payroll.ts` — `POST /process`, `GET /runs/:uploadId`, `GET /employee/:uploadId/:employeeId`, `GET /history`, `GET /filters`.
- **Frontend:**
  - `pages/PayrollPage.tsx` — drag-drop upload, filters (month/year/department/shift/employee), buttons (Process/Calculate/Reset/History), 6 summary cards, 18-column salary table, View Details action.
  - `components/payroll/PayrollDetailModal.tsx` — full salary breakdown popup.

### B. Cross-Tab (Pivot) Excel Parser
Parses biometric exports where employees are rows and days are columns. See [§5](#5-the-cross-tab-excel-format-duty-05).
- Added to `services/excelParser.ts`: `convertCrossTab()`, `parseCellPunches()`, `detectDayColumn()`, `detectPeriod()`, `inspectAttendanceExcel()`.

### C. Inspect Excel feature (no-DB diagnostic)
Reads an Excel and shows its contents + column-match report **without saving**.
- Backend: `POST /api/attendance/inspect`, `inspectAttendanceExcel()`.
- Frontend: `components/attendance/InspectExcelModal.tsx`. Auto-opens on upload failure + a manual "Inspect any Excel" button on the Dashboard.

### D. Attendance Sheet + Punch In / Punch Out view
Shows every member with their daily punch in/out in **two separate sections**.
- Backend: `GET /api/attendance/sheet/:uploadId` (paginated — see [§4](#4-bugs-fixed)).
- Frontend: `components/attendance/AttendanceSheetModal.tsx` — three tabs: **Punch In** (green), **Punch Out** (indigo), **All**. Searchable. Opened via the green "Punch In / Out" button on the Dashboard.

### E. Bulk upload optimization
Re-wrote the upload route to **bulk-insert** employees + records (500/batch) instead of one-by-one. Upload time for 8,460 records dropped from **timeout (>2 min)** to **~3–8 seconds**.

### F. Resilience + pagination (scale fixes)
- Backend no longer crashes on transient errors (unhandled-rejection handlers).
- Read endpoints paginate past PostgREST's 1000-row default cap (`fetchAllRecords()`).

---

## 4. Bugs Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | Seed failed on startup: `Could not find the 'isActive' column of 'attendance_rules'` (camelCase keys vs snake_case DB) | `seed.ts`: converted `isActive`→`is_active`, `ruleType`→`rule_type` |
| 2 | Backend kept dying — `JWT issued at future` unhandled rejection crashed the process | `index.ts`: added `unhandledRejection`/`uncaughtException` handlers (log, don't crash) |
| 3 | `TypeError: ... .not.in is not a function` (invalid supabase chaining) in `analytics.ts` + `emails.ts` (3 places) — would 500/crash those routes | Replaced `.not.in('status', X)` with chained `.neq('status','Normal').neq(...).neq(...)` |
| 4 | Upload timed out for large files (per-row inserts, ~3000 DB calls) | Bulk insert in batches of 500 |
| 5 | **"All entries are not coming"** — PostgREST caps a single SELECT at 1000 rows, so the sheet/summary only saw ~12% of records | Added `fetchAllRecords()` (paginated) to `/sheet`, `/summary`, and payroll `computeForUpload` |
| 6 | Cross-tab files produced 0 records ("No valid records found") | Built `convertCrossTab()` — see [§5](#5-the-cross-tab-excel-format-duty-05) |
| 7 | "No email" warning fired once per record (1618×) | Moved warning into the employee-dedup block (fires once per employee) |
| 8 | Salary latest-by-month selection had a self-compare bug | Fixed in `payroll.ts` + `salary.ts` (compare against stored month) |

---

## 5. The Cross-Tab Excel Format (DUTY 05)

Your biometric export (`DUTY 05 (15).xls`) is a **cross-tab / pivot** layout:

```
R1:  "List of Logs"                                    (title, merged)
R2:  "Duration: 01/06/2026 ~ 30/06/2026"               (period → June 2026)
R3:  No. | Name | 1 | 2 | 3 | ... | 30                 (header: day numbers)
R4:  (empty) | (empty) | Mo | Tu | We | ...            (weekday sub-row)
R5+: <emp#> | <name> | <day cells>                     (employee data)
```

**Cell formats handled:**
| Cell content | Parsed as |
|--------------|-----------|
| `"10:00\n18:13\n"` (newline-separated) | Punch In 10:00 / Out 18:13 → **Normal** |
| `"12:00"` (single time) | Single punch → **Missed Swipe** |
| `"00:00\n"` (lone midnight) | No-data marker → **Absent** (per latest decision) |
| `"A"`, `"WO"`, `"P"`, `"L"` | Status codes → Absent / Weekend / Normal / Late |
| blank | see [§8](#8-attendance-status-handling-decisions) |

**Auto-detects:**
- Header row (finds NAME column + ≥5 day-number columns, skips title rows).
- Period month/year from a `Duration:` or month-name cell.
- Skips pre-block rows whose "Name" cell is actually punch data.

**Result on your file:** 8,460 records, 278 employees, June 2026.

---

## 6. Salary Calculation Formula

Implemented in `services/payrollService.ts`.

```
daily_salary   = monthly_salary ÷ working_days            (working_days = 26)
hourly_rate    = daily_salary ÷ standard_working_hours     (standard = 9)
payable_days   = present_days + (half_days × 0.5) + weekly_offs + holidays + paid_leave
                 (absent days are EXCLUDED — unpaid)
overtime_pay   = overtime_hours × hourly_rate × ot_multiplier   (ot_multiplier = 1.5)
gross_salary   = round(daily_salary × payable_days + overtime_pay)
deductions     = round(missed_swipes × daily × missed_swipe_weight       (0.5)
                        + late_days × daily × late_penalty_days)         (0)
net_salary     = gross_salary − deductions
```

**Payroll settings (in Settings page, seeded by default):**
| Key | Default | Meaning |
|-----|---------|---------|
| `working_days` | 26 | working days used to derive daily rate |
| `missed_swipe_weight` | 0.5 | fraction of a day's LOP per missed swipe |
| `standard_working_hours` | 9 | for hourly rate + OT threshold |
| `ot_threshold_hours` | 9 | OT begins beyond this many hours/day |
| `ot_multiplier` | 1.5 | OT pay multiplier |
| `late_grace_minutes` | 15 | grace after shift start before "late" |
| `shift_start` | 09:00 | for late inference |
| `half_day_hours` | 4 | working hours below this = half day |
| `late_penalty_days` | 0 | LOP days per late arrival |

### Worked example (test-run, sample salaries)
Real attendance from upload #19:

| | Praful WB | ravina.balvir | abhishek |
|---|---|---|---|
| Monthly (sample) | 8,000 | 6,000 | 7,000 |
| Daily (÷26) | 307.69 | 230.77 | 269.23 |
| Present / Absent / Missed | 26/2/0 | 26/3/14 | 19/7/3 |
| Weekend | 2 | 1 | 4 |
| OT hours | 0 | 9.9 | 12.7 |
| Payable days | 28 | 27 | 23 |
| Gross | 8,615 | 6,612 | 6,762 |
| Deductions | 0 | 1,615 | 404 |
| **Net** | **8,615** | **4,997** | **6,358** |

### Software-dept example (15,000, 2 paid leaves)
- Daily = 15,000 ÷ 26 = **576.92/day**
- 2 **paid** leave days → no deduction → **Net = 15,000** (full salary).
- If those 2 days were **unpaid** absence → LOP = 2 × 576.92 = 1,154 → **Net = 13,846**.
- ⚠️ The system currently **cannot distinguish paid leave from unpaid absence** (both are blank cells) — see [§10](#10-known-gaps--pending-decisions).

### Two policy points (UNRESOLVED — need your decision)
1. **Payable days can exceed `working_days`** because Sundays (your day off) are counted as paid → a perfect attender's gross can be slightly *higher* than monthly salary. Options: (a) keep as-is, or (b) cap payable days at 26.
2. **Missed swipe = 0.5 day LOP** — ravina loses 1,615 for 14 missed swipes. Adjustable via `missed_swipe_weight`.

---

## 7. Punch In / Punch Out View

- **Button:** green "Punch In / Out" (top-right of Dashboard records panel).
- **Endpoint:** `GET /api/attendance/sheet/:uploadId` — paginated, returns every employee × every day with `timeIn`, `timeOut`, `status`, `workingHours`.
- **Modal tabs:** Punch In (green) / Punch Out (indigo) / All. Searchable by name/number/department.
- **Current data (upload #19):** 1,618 punch-in records, 1,316 punch-out records, 278 members.

---

## 8. Attendance Status Handling Decisions

For your **Monday–Saturday work week (Sunday off)**:

| Cell | Day | Status | Flagged? |
|------|-----|--------|----------|
| Two times `10:00\n18:13` | any | **Normal** | no |
| Single time `12:00` | any | **Missed Swipe** | yes |
| `00:00` lone marker | any | **Absent** | yes |
| **blank** | **Sunday** | **Weekend** (off) | no |
| **blank** | **Mon–Sat** | **Absent** | yes ← current (reverted from "No Punch") |

### Decision history (what we tried)
1. Initially: blank weekday → skipped (no record) → "all entries not coming" (217 no-punch employees invisible).
2. Changed: blank weekday → **Absent** → everyone (271/278) showed Absent → looked like everyone absent all month.
3. Tried: blank weekday → **"No Punch"** (neutral, no badge) → fixed the display (0 Absent badges).
4. **Reverted** per your request ("revert this remove absent vala part") → blank weekday → **Absent** again (272/278 show Absent) — **this is the current state.**

> The "Absent on every name" issue is a direct consequence of blank cells being counted as Absent. If you want it changed back to neutral ("No Punch") or hidden, say so.

### Weekend setting
- **Current:** weekend = **Sunday only** (`dow === 0`), matching your Mon–Sat schedule.
- Saturdays are workdays; Sundays are off.

---

## 9. Current Data State

- **Upload #19** (latest): `DUTY05.xls`, period **2026-06**, **8,460 records**, **278 employees**.
- Status mix: Normal, Missed Swipe, Absent (blank Mon–Sat), Weekend (Sundays).
- **272 of 278** employees show at least one Absent day (because blank workdays = Absent).
- **59 employees** have real missed-swipe flags.
- **Salaries:** only 3 test employees (Ahmed, Sara, John) have salary configs. The 278 real employees have **no salary** → Payroll page shows them as "No Salary Config".
- All earlier test uploads were cleaned up.

---

## 10. Known Gaps & Pending Decisions

### 🔴 Paid leave handling (BLOCKING correct salary)
- `paidLeave` is hardcoded to `0` in `payrollService.ts`.
- Blank days (leave or absence) are all treated as unpaid Absent.
- **Needed:** either (a) mark leave days with a code (`PL`/`L`) in the Excel → parser maps to "Paid Leave" (paid), or (b) build a small Leaves feature in-app / department policy.
- **Decision pending.**

### 🔴 Salary data entry (278 employees, varying amounts)
- No salaries set for real employees.
- **Planned:** bulk salary Excel import (`POST /api/salary/import` — Employee No. → Monthly Salary) + "Bulk Import" button on Salary page. **Not yet built.**

### 🟡 Payable-days capping policy
- Should payable days be capped at `working_days` (26) so gross never exceeds monthly? **Decision pending.**

### 🟡 Missed-swipe penalty weight
- Currently 0.5 day LOP per missed swipe. May be too harsh (e.g. ravina: −1,615). **Adjustable.**

### 🟢 Operational
- Windows `W32Time` service not running → occasional Supabase JWT clock-skew errors (now non-fatal, but should resync).

---

## 11. Complete File Change List

### Backend — new files
- `backend/src/services/payrollService.ts` — payroll computation engine
- `backend/src/routes/payroll.ts` — payroll endpoints
- `backend/supabase/migrations/20260713_payroll.sql` — optional migration (biometric_id, shift, uploaded_by, payroll_runs table)

### Backend — modified files
- `backend/src/services/excelParser.ts` — added cross-tab converter, punch-cell parser, inspect function, day/period detection
- `backend/src/routes/attendance.ts` — `/inspect`, `/sheet` endpoints, bulk-insert upload, paginated `fetchAllRecords()`
- `backend/src/routes/analytics.ts` — fixed `.not.in` → `.neq` chains
- `backend/src/routes/emails.ts` — fixed `.not.in` → `.neq` chains (2 places)
- `backend/src/db/seed.ts` — camelCase→snake_case fix + payroll settings seed
- `backend/src/index.ts` — mounted `/api/payroll`, added unhandled-rejection handlers

### Frontend — new files
- `frontend/src/pages/PayrollPage.tsx`
- `frontend/src/components/payroll/PayrollDetailModal.tsx`
- `frontend/src/components/attendance/InspectExcelModal.tsx`
- `frontend/src/components/attendance/AttendanceSheetModal.tsx`

### Frontend — modified files
- `frontend/src/api/index.ts` — payroll + inspect + sheet API functions
- `frontend/src/App.tsx` — `/payroll` route
- `frontend/src/components/layout/Sidebar.tsx` — "Payroll" nav item
- `frontend/src/pages/Dashboard.tsx` — "Punch In / Out" button, "Inspect any Excel" button, auto-open inspector on upload failure

### Database (Supabase) — applied
- Snake_case tables already existed. No DDL applied this session (the optional payroll migration is written but not run).

---

## Quick Reference — Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/attendance/upload` | Upload + parse + bulk-store attendance |
| POST | `/api/attendance/inspect` | Read Excel, return diagnostic (no DB write) |
| GET | `/api/attendance/sheet/:uploadId` | Full punch in/out grid (paginated) |
| GET | `/api/attendance/summary/:uploadId` | Per-employee flag counts (paginated) |
| GET | `/api/payroll/runs/:uploadId` | Compute payroll on-demand |
| GET | `/api/payroll/employee/:uploadId/:employeeId` | Salary breakdown for the modal |
| GET | `/api/payroll/history` | Upload history |
| PUT | `/api/salary/configs/bulk` | Bulk-set salary configs |

---

*Nothing is committed to git — all changes are local and uncommitted, ready for review.*
