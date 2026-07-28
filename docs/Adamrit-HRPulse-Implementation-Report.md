# Adamrit HRPulse Implementation Report

Generated on: 25 July 2026

This document explains the work added across HRPulse and Adamrit, how each part works, and how to verify the integration. It intentionally does not include passwords, service-role keys, OpenAI keys, webhook tokens, or other private credentials.

## 1. Purpose

Adamrit and HRPulse remain two separate production applications.

HRPulse is the master HR, attendance, leave, payroll, salary, rule, and notification system. Adamrit acts as the employee-facing Employee Self-Service portal inside the existing Tablet View Dashboard.

The main rule is:

- HRPulse calculates and owns HR data.
- Adamrit only displays employee-specific HR data.
- Adamrit does not duplicate attendance, payroll, salary, or HR business logic.
- Employees are mapped by a unique identifier such as email, employee id, employee code, or UUID, never by employee name.

## 2. High-Level Architecture

The integration has four layers:

1. HRPulse backend APIs expose secure ESS endpoints.
2. Adamrit serverless API routes proxy the logged-in employee request to HRPulse.
3. HRPulse stores and pushes employee notifications to Adamrit.
4. Adamrit HR tile displays HRPulse data, documents, payslips, leave, attendance, salary, alerts, and notification bell messages.

The workflow is:

Biometric machine -> Excel upload in HRPulse -> attendance processing -> rule/payroll calculation -> AI attendance alert generation -> HRPulse notification table -> Adamrit notification webhook -> Adamrit employee notification table -> Adamrit HR tile notification bell.

## 3. HRPulse Backend Additions

### 3.1 ESS API

File:

- `backend/src/routes/ess.ts`

Purpose:

Provides secure Employee Self-Service APIs that Adamrit can call. The ESS API always resolves the employee first and then returns only that employee's records.

Main endpoints:

- `GET /api/ess/profile`
- `GET /api/ess/attendance/today`
- `GET /api/ess/attendance/monthly?month=YYYY-MM`
- `GET /api/ess/attendance/history?month=YYYY-MM`
- `GET /api/ess/leaves`
- `POST /api/ess/leaves/request`
- `GET /api/ess/payroll/current?month=YYYY-MM`
- `GET /api/ess/payroll/history`
- `GET /api/ess/payslips/:periodMonth`
- `GET /api/ess/notifications`
- `POST /api/ess/notifications/read-all`
- `POST /api/ess/notifications/:id/read`
- `GET /api/ess/alerts?month=YYYY-MM`
- `GET /api/ess/documents`
- `POST /api/ess/documents`
- `GET /api/ess/documents/:documentId/download`

Security:

- Requires integration token headers.
- Resolves the current employee using the Adamrit identity passed by the server-side proxy.
- Does not allow the client to request another employee's data directly.
- Uses server-side validation before reading attendance, salary, leave, documents, or notifications.

### 3.2 Employee Matching

File:

- `backend/src/services/employeeMatch.ts`

Purpose:

Maps an Adamrit logged-in user to an HRPulse employee.

Matching strategy:

- Prefer exact email match.
- Support employee id/code where available.
- Avoid name-based matching because names are not unique and are unsafe for authorization.

Why this matters:

If `cmd@hopehospital.com` is logged into Adamrit, HRPulse must return only the employee record mapped to that email or unique identifier.

### 3.3 Attendance Excel Upload Processing

Files:

- `backend/src/routes/attendance.ts`
- `backend/src/routes/payroll.ts`
- `backend/src/services/excelParser.ts`
- `backend/src/services/attendanceRecordWriter.ts`

Purpose:

HRPulse can process daily or multi-day attendance Excel data. The uploaded file is analyzed by date, month, and year.

Important behavior:

- If the Excel sheet contains one day, only that day is processed.
- If the Excel sheet contains 4 to 10 days, all those dates are processed independently.
- If the Excel sheet contains data crossing into the next month, HRPulse separates those records under the correct month.
- Month-end payroll still calculates the full monthly salary summary using the processed daily attendance records.

Compatibility fix:

`attendanceRecordWriter.ts` handles batch attendance record writes safely, including fallback behavior when the database does not have the expected unique constraint. This avoids upload failures such as:

`there is no unique or exclusion constraint matching the ON CONFLICT specification`

### 3.4 Day-Wise Attendance Notification Engine

File:

- `backend/src/services/attendanceAlertService.ts`

Purpose:

After attendance upload and processing, HRPulse automatically analyzes each affected employee and each affected date.

Day-wise alerts generated:

- Late arrival
- Missing punch
- Missing punch-in
- Missing punch-out
- Absent
- Half day
- Early departure
- Insufficient working hours
- Overtime
- Holiday work
- Weekly off work

Pattern/month-level alerts still generated:

- Three consecutive late arrivals
- Three consecutive absences
- Low attendance percentage

Notification key format:

- `attendance:2026-06-09:missing_punch_alert`
- `attendance:2026-06-17:late_arrival_alert`
- `attendance:2026-06-20:overtime_alert`

Why this is important:

The same date-specific notification is not duplicated again and again for the same employee. HRPulse can update or replace the same notification using the notification key.

Example:

If Aniruddha is late on 17 June 2026, HRPulse creates a notification for that exact date. If the same sheet is uploaded again, HRPulse does not create an unlimited number of duplicate late messages for the same employee/date/type.

### 3.5 HR Notification Service

File:

- `backend/src/services/hrNotificationService.ts`

Purpose:

Central service for creating notifications in HRPulse and pushing them to Adamrit.

What it does:

- Saves notifications into HRPulse `hr_notifications`.
- Pushes notifications to Adamrit webhook when configured.
- Removes `employee_email` before inserting into HRPulse if the HRPulse table does not contain that column.
- Keeps `employee_email` for the Adamrit push because Adamrit needs it to route the message to the correct logged-in employee.
- Handles missing unique constraint fallback by delete-and-insert compatibility mode.

Supported notification fields:

- Employee id
- Employee email
- Notification key
- Type
- Title
- Message/body
- Severity
- Related date
- Source
- Metadata
- Read status

### 3.6 Manual and Rule-Based Notifications

Files:

- `backend/src/routes/notifications.ts`
- `backend/src/routes/rules.ts`
- `backend/src/services/ruleEngine.ts`
- `backend/src/services/ollamaService.ts`

Purpose:

HRPulse supports HR/admin-driven notifications and rule-triggered attendance communication.

Important clarification:

The attendance notification delivery to Adamrit does not depend on WhatsApp. The requested WhatsApp message behavior was removed from the HRPulse-to-Adamrit flow. Notifications now go to Adamrit's HR notification bell through the notification sync path.

### 3.7 Leave Request Flow

Files:

- `backend/src/routes/leaves.ts`
- `backend/src/routes/ess.ts`

Purpose:

Employees can submit leave from Adamrit. HRPulse remains the approval system.

Flow:

1. Employee submits leave request in Adamrit HR tile.
2. Adamrit sends it through the ESS proxy to HRPulse.
3. HRPulse creates a leave request.
4. HRPulse Super Admin approves or rejects it.
5. HRPulse creates or updates the notification.
6. Adamrit receives and displays the decision notification.

### 3.8 Employee Documents

Files:

- `backend/src/services/employeeDocumentService.ts`
- `backend/src/routes/ess.ts`
- `backend/src/routes/employees.ts`

Purpose:

Employees can upload documents from Adamrit. Those documents are stored through HRPulse and shown in the HRPulse Employee Master document section.

Flow:

1. Employee opens Adamrit HR tile.
2. Employee selects a document type.
3. Employee uploads a PDF/image/Word/text document.
4. Adamrit sends the file to HRPulse ESS document endpoint.
5. HRPulse saves the file and creates an employee document record.
6. HRPulse Employee Master can list/download the document.
7. Adamrit HR tile also shows uploaded employee documents.

Allowed file types:

- PDF
- PNG/JPG/JPEG
- Word documents
- Text documents

### 3.9 Overtime Calculation

Relevant files:

- `backend/src/services/payrollService.ts`
- `backend/src/routes/payroll.ts`
- Attendance/payroll calculation services

Business rule:

Overtime is calculated using punch-out time compared with assigned shift end time.

Example:

- Shift: 09:00 AM to 06:00 PM
- Punch out: 08:15 PM
- Overtime duration: 2 hours 15 minutes

Threshold:

- Overtime is payable only if the employee works more than 2 hours beyond shift end.
- If overtime is 2 hours or less, no overtime payment is generated.
- If overtime is more than 2 hours, the entire overtime duration beyond shift end is recorded as payable overtime.

Salary formula:

- Per Day Salary = Monthly Salary / 30
- Overtime Per Day = (Monthly Salary / 30) / 2

Adamrit display:

- Monthly summary shows overtime hours.
- Salary card shows overtime hours and overtime pay when returned by HRPulse.
- Adamrit does not calculate overtime itself.

### 3.10 Half-Day Attendance Rule

Relevant files:

- Attendance/payroll calculation services
- `backend/src/routes/payroll.ts`
- `backend/src/services/payrollService.ts`

Business rule:

- If total working hours are less than 4 hours, attendance is marked Half Day.
- If working hours are 4 hours or more, the record follows the organization's full-day policy.

Payroll effect:

- Payable day becomes `0.5`.
- Half Day Deduction = `(Monthly Salary / 30) / 2`

Display:

- Attendance records show Half Day.
- Payroll summary shows half days and half-day deduction.
- Payslip uses HRPulse payroll output.

## 4. Adamrit Additions

### 4.1 HR Tile in Tablet View

File:

- `adamrit/src/tablet/modules/hr/HrEssFlow.tsx`

Purpose:

Adds the employee HR portal inside Adamrit Tablet View.

Displayed data:

- Profile
- Employee ID/code
- Department
- Designation
- Shift
- Joining date
- Email
- Today's attendance
- Monthly attendance summary
- Attendance history
- Weekly attendance chart
- Leave balance
- Leave request form
- Leave history
- Current salary summary
- Previous salary history
- Payslip download
- Employee documents
- HRPulse notification bell

Important:

Adamrit only displays the data returned by HRPulse APIs. It does not calculate attendance, payroll, salary, overtime, half-day, or AI attendance rules.

### 4.2 Adamrit ESS Proxy

File:

- `adamrit/api/hrpulse-ess/[...path].ts`

Purpose:

Server-side proxy between Adamrit UI and HRPulse ESS APIs.

Why this exists:

The browser should not directly call HRPulse with private integration credentials. Adamrit's serverless API route adds the secure token and forwards the request to HRPulse.

Flow:

1. Employee logs into Adamrit.
2. Adamrit creates/restores a secure session.
3. HR tile calls `/api/hrpulse-ess/profile`, `/attendance/monthly`, etc.
4. Adamrit proxy forwards to HRPulse `/api/ess/...`.
5. HRPulse validates and returns only that employee's data.

### 4.3 Adamrit Session Bridge

File:

- `adamrit/api/adamrit-session.ts`

Purpose:

Maintains the Adamrit-side secure session used by the HR tile integration. This helps local development and production routes know which Adamrit employee is currently signed in.

### 4.4 Adamrit Notification Webhook and Store

File:

- `adamrit/api/hrpulse-notifications.ts`

Purpose:

Receives notification pushes from HRPulse and stores them in Adamrit.

Supported operations:

- `POST`: HRPulse pushes a new employee notification.
- `GET`: Adamrit HR tile reads employee notifications.
- `PATCH`: Marks notifications as read.

Security:

- HRPulse must send a configured webhook token.
- Adamrit validates the token before accepting pushed messages.
- Employees can only read notifications mapped to their own email/session.

### 4.5 Real-Time Notification Bell and Toasts

File:

- `adamrit/src/tablet/modules/hr/HrEssFlow.tsx`

Purpose:

Shows HRPulse notifications inside Adamrit.

How it works:

- On page load, HR tile fetches notifications from both HRPulse ESS and Adamrit mirrored notification table.
- It merges and de-duplicates notifications.
- It shows unread count on the notification bell.
- It supports mark one as read and mark all as read.
- It refreshes periodically.
- It subscribes to Supabase realtime inserts for `hrpulse_employee_notifications`.
- When a new notification arrives, Adamrit shows a toast message.

## 5. Database Tables and Migrations

Migration location:

- `backend/supabase/migrations/20260722_ess_integration.sql`

Main tables expected:

- `hr_notifications`
- `leave_requests`
- `leave_balances`
- `employee_documents`
- ESS audit-related tables where applicable

Adamrit database table expected:

- `hrpulse_employee_notifications`

Important:

If a Supabase table or unique constraint is missing, some fallback code exists, but production should still run the migrations properly.

## 6. How Day-Wise Notifications Work

Day-wise notification means every uploaded attendance date is analyzed separately.

Example Excel data:

- 09 June 2026: missing punch-out
- 10 June 2026: late arrival
- 11 June 2026: normal
- 12 June 2026: half day

Expected notifications:

- Missing punch notification for 09 June 2026
- Late arrival notification for 10 June 2026
- No alert for 11 June 2026 if normal
- Half day notification for 12 June 2026

If 4 to 10 days are uploaded together, HRPulse loops over those dates and creates date-wise notifications for each employee/date where a problem or payable event is detected.

## 7. When Notifications Are Sent

Notifications are generated after attendance processing completes.

Exact timing:

1. HR uploads Excel in HRPulse.
2. HRPulse parses the file.
3. Attendance records are inserted/updated.
4. HRPulse runs attendance alert analysis for affected uploaded dates.
5. HRPulse writes notifications.
6. HRPulse pushes notifications to Adamrit.
7. Adamrit stores them.
8. Adamrit HR tile bell updates after refresh/realtime event.
9. Employee sees bell count, notification panel item, and toast if the HR tile is open.

## 8. Why a Notification May Not Show

Common reasons:

- Employee email in HRPulse does not match Adamrit login email.
- HRPulse notification webhook URL/token is not configured.
- Adamrit local server is not running.
- Adamrit is running on HTTPS while HRPulse is pushing to HTTP, or the reverse.
- The uploaded sheet did not contain a qualifying late/missing/half-day/overtime event.
- The same notification key already exists and was updated instead of duplicated.
- Adamrit Supabase table `hrpulse_employee_notifications` is missing.
- Browser is logged in as a different Adamrit employee than the HRPulse employee being checked.
- Notification was created in HRPulse but Adamrit push failed.

## 9. How to Verify

### 9.1 Verify HRPulse Backend

Run HRPulse backend locally and confirm:

- Backend is running on `http://localhost:3001`
- Upload endpoint returns `attendanceAlerts`
- Console/logs do not show notification push errors

### 9.2 Verify Adamrit Locally

Run Adamrit locally and open:

- `http://localhost:8080/hr`

Login with the employee account that has the same email as the HRPulse employee record.

### 9.3 Verify Employee Mapping

Check HRPulse Employee Master:

- Employee email must match Adamrit login email.
- Employee ID/code should be unique.
- Do not rely on employee name.

### 9.4 Verify Notification Flow

After uploading attendance:

1. Open Adamrit HR tile.
2. Check the notification bell count.
3. Open notification panel.
4. Confirm notification title/body mentions the correct date.
5. Confirm it belongs to the logged-in employee only.

Example expected message:

`Late arrival on 17 Jun 2026`

or:

`Your attendance on 09 Jun 2026 has a missing punch-out. Please regularize it before payroll processing.`

### 9.5 Verify Day-Wise Behavior

Upload an Excel containing multiple dates. The notifications should mention specific dates, not only a monthly total.

Example:

- Upload 04 June to 10 June data.
- If 06 June is late and 09 June has missing punch, Adamrit should show separate messages for those dates.

## 10. Current UI State

Adamrit HR tile currently includes:

- Employee profile card
- Today's attendance card
- Monthly summary card
- Weekly attendance chart
- Salary card
- Leave card
- Documents section
- Attendance history
- HRPulse notification bell and notification drawer

The most recent wide premium dashboard redesign was reverted as requested. The layout was then adjusted to reduce excessive width and improve card arrangement while keeping the compact HR portal workflow.

## 11. Important Files Changed or Added

HRPulse backend:

- `backend/src/routes/ess.ts`
- `backend/src/routes/attendance.ts`
- `backend/src/routes/payroll.ts`
- `backend/src/routes/leaves.ts`
- `backend/src/routes/notifications.ts`
- `backend/src/routes/employees.ts`
- `backend/src/services/attendanceAlertService.ts`
- `backend/src/services/hrNotificationService.ts`
- `backend/src/services/attendanceRecordWriter.ts`
- `backend/src/services/employeeDocumentService.ts`
- `backend/src/services/employeeMatch.ts`
- `backend/src/services/payrollService.ts`
- `backend/src/services/salaryRules.ts`
- `backend/supabase/migrations/20260722_ess_integration.sql`

Adamrit:

- `adamrit/api/hrpulse-ess/[...path].ts`
- `adamrit/api/hrpulse-notifications.ts`
- `adamrit/api/adamrit-session.ts`
- `adamrit/src/tablet/modules/hr/HrEssFlow.tsx`

Documentation/session files:

- `SESSION-2026-07-22.md`
- `SESSION-2026-07-24.md`
- `docs/Adamrit-HRPulse-Implementation-Report.md`

## 12. What Adamrit Does Not Do

Adamrit does not:

- Calculate salary.
- Calculate overtime.
- Calculate half-day deductions.
- Decide attendance status.
- Generate AI attendance logic.
- Approve leave.
- Own HR master data.

Adamrit only:

- Authenticates the employee inside Adamrit.
- Calls secure server-side proxy routes.
- Displays HRPulse data.
- Receives HRPulse notifications.
- Lets the employee submit requests/documents that flow back to HRPulse.

## 13. Production Checklist

Before production use:

- Run HRPulse Supabase migrations.
- Run Adamrit Supabase table migration for `hrpulse_employee_notifications`.
- Configure HRPulse integration token.
- Configure Adamrit notification webhook token.
- Configure HRPulse backend URL in Adamrit server environment.
- Configure Adamrit notification webhook URL in HRPulse backend environment.
- Ensure employee emails match between HRPulse and Adamrit.
- Confirm Supabase RLS policies are active.
- Test one employee with late, missing punch, absent, half-day, and overtime records.
- Confirm notifications do not leak across users.

## 14. Summary

The integration now supports HRPulse as the single source of truth and Adamrit as the employee self-service portal.

The important completed capabilities are:

- Secure HRPulse ESS APIs.
- Adamrit HR tile.
- Employee-specific profile, attendance, salary, leave, payslip, documents, and notifications.
- Leave request from Adamrit to HRPulse.
- Document upload from Adamrit to HRPulse Employee Master.
- HRPulse to Adamrit notification sync.
- Real-time notification bell and toast support in Adamrit.
- Day-wise attendance alert generation after Excel upload.
- Overtime payroll logic display.
- Half-day payroll logic display.
- Compatibility fallback for missing upsert unique constraints.

HRPulse continues to own all HR logic. Adamrit displays the final employee-specific result.
