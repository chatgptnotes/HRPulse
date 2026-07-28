# HRPulse and Adamrit Integration Report

Generated on: July 22, 2026

## 1. Purpose

This report explains the integration work completed between HRPulse and Adamrit.

The main goal was to keep both applications independent while allowing Adamrit employees to view their own HR information from HRPulse.

The important rule is:

- HRPulse remains the master system for HR, attendance, leave, payroll, salary, payslips, notifications, and HR business logic.
- Adamrit remains the hospital management system.
- Adamrit does not calculate salary, payroll, attendance, leave balance, deductions, or alerts.
- Adamrit only displays employee-specific results that come from HRPulse.
- The two databases were not merged.

## 2. High-Level Architecture

The integration now follows this flow:

1. An employee logs into Adamrit using the existing Adamrit login.
2. Adamrit shows the Tablet View Dashboard.
3. If the user has access to the HR tile, Adamrit shows the HR tile.
4. The employee opens the HR tile.
5. Adamrit shows a button: Load My HR Data.
6. When the employee clicks the button, Adamrit prepares a secure server session.
7. Adamrit server calls HRPulse server through a proxy.
8. HRPulse verifies the integration token.
9. HRPulse identifies the employee by a unique identifier, currently email by default.
10. HRPulse returns only that employee's data.
11. Adamrit displays the data in the Employee Self-Service portal.

The browser does not receive HRPulse service keys or Supabase service-role keys.

## 3. HRPulse Work Completed

### 3.1 New ESS API Route

A new HRPulse backend route was added:

`backend/src/routes/ess.ts`

It is mounted in:

`backend/src/index.ts`

The route is available under:

`/api/ess`

This is the HRPulse Employee Self-Service API layer that Adamrit consumes.

### 3.2 HRPulse ESS Endpoints

The new HRPulse route supports employee-scoped access for:

- profile details
- today's attendance
- monthly attendance summary
- attendance history
- attendance calendar data
- current payroll summary
- payroll history
- payslip PDF download
- leave balances
- leave request submission
- HR notifications
- intelligent attendance alerts
- ESS audit logging

Example endpoint group:

`/api/ess/profile`

`/api/ess/attendance/today`

`/api/ess/attendance/monthly`

`/api/ess/attendance/history`

`/api/ess/payroll/current`

`/api/ess/payroll/history`

`/api/ess/payslips/:periodMonth`

`/api/ess/leaves`

`/api/ess/leaves/request`

`/api/ess/notifications`

`/api/ess/alerts`

### 3.3 HRPulse Security

The HRPulse ESS API requires a server-to-server token.

Environment variable:

`HRPULSE_ESS_TOKEN`

Adamrit must send this token from its backend only. It must not be exposed in Adamrit frontend code.

The HRPulse route accepts employee identity from server-side headers such as:

- `x-employee-email`
- `x-employee-id`
- `x-employee-number`
- `x-employee-code`
- `x-employee-uuid`

The default matching method is email.

Employee name is not used for matching.

### 3.4 HRPulse Business Logic Reuse

The integration reuses HRPulse's existing payroll and attendance services.

Adamrit does not copy the payroll formulas.

Adamrit does not calculate:

- gross salary
- deductions
- net salary
- payable days
- working days
- late deductions
- missing punch deductions
- attendance percentage
- intelligent attendance alerts

These values are produced by HRPulse and then displayed by Adamrit.

### 3.5 HRPulse Database Migration

A new Supabase migration was added:

`backend/supabase/migrations/20260722_ess_integration.sql`

It adds support for:

- optional employee external UUID mapping
- leave balances
- leave requests
- HR notifications
- ESS audit logs

The migration is additive. It does not remove existing HRPulse tables.

It adds these major tables:

- `leave_balances`
- `leave_requests`
- `hr_notifications`
- `ess_audit_logs`

It also adds:

- `employees.external_uuid`

This supports future mapping if email or employee code is not enough.

## 4. Adamrit Work Completed

Adamrit was cloned inside the HRPulse workspace:

`C:\Users\hope4\hrpulse\HRPulse\adamrit`

### 4.1 New HR Tile

A new HR tile was added to Adamrit Tablet View.

Files changed:

- `adamrit/src/tablet/config/modules.ts`
- `adamrit/src/config/tileAccess.ts`

The tile id is:

`hr`

The access-control tile id is:

`t-hr`

### 4.2 HR Tile Access Control

The HR tile is now permission-based.

Files changed:

- `adamrit/src/tablet/config/modules.ts`
- `adamrit/src/tablet/screens/TabletHome.tsx`
- `adamrit/src/tablet/shell/TabletBottomNav.tsx`
- `adamrit/src/tablet/screens/TabletModuleHost.tsx`

Behavior:

- If a user has access to `t-hr`, the HR tile can appear.
- If a user does not have access to `t-hr`, the HR tile is hidden.
- If a user manually opens `/hr` without access, Adamrit redirects back to the tablet home page.

This means HR access can be controlled from Adamrit's existing tile access system.

### 4.3 HR Employee Portal UI

A new HR portal screen was added:

`adamrit/src/tablet/modules/hr/HrEssFlow.tsx`

The page shows:

- employee profile
- today's attendance
- monthly summary
- salary summary
- payslip download button
- leave balance
- leave request form
- leave request history
- notifications
- alerts
- attendance history

### 4.4 Manual Load Button

The HR portal no longer loads data automatically.

It now first shows:

`Load My HR Data`

Only after clicking this button does Adamrit call HRPulse.

This makes the behavior easier to understand and avoids showing immediate errors before the user asks to load the data.

### 4.5 Adamrit Server Session API

A new Adamrit API route was added:

`adamrit/api/adamrit-session.ts`

Purpose:

- create a secure HTTP-only Adamrit session cookie
- clear the secure session cookie on logout
- support the HRPulse proxy authorization flow

This cookie is separate from the visible frontend localStorage login.

The reason this is needed:

- localStorage proves the frontend knows a user is logged in
- but the backend proxy needs a trusted server-readable session
- HTTP-only cookies are readable by the server, not by browser JavaScript

### 4.6 Adamrit HRPulse Proxy API

A new Adamrit API route was added:

`adamrit/api/hrpulse-ess/[...path].ts`

Purpose:

- receive HR requests from Adamrit frontend
- verify Adamrit secure session
- call HRPulse server with `HRPULSE_ESS_TOKEN`
- pass only the logged-in employee's identity
- return HRPulse response back to Adamrit UI

This prevents the browser from directly calling HRPulse with privileged credentials.

### 4.7 Local Dev Middleware

Adamrit is a Vite app. Vite local development does not automatically serve Vercel `api/` functions.

To make local testing work, a dev-only middleware was added in:

`adamrit/vite.config.ts`

It handles:

- `/api/adamrit-session`
- `/api/hrpulse-ess/*`

This is only for local development.

In production, Vercel functions handle these routes.

## 5. Environment Variables Required

### 5.1 HRPulse

Required:

`HRPULSE_ESS_TOKEN`

This is the shared secret that HRPulse uses to trust Adamrit.

### 5.2 Adamrit

Required:

`ADAMRIT_SESSION_SECRET`

`HRPULSE_API_URL`

`HRPULSE_ESS_TOKEN`

`SUPABASE_URL`

`SUPABASE_SERVICE_ROLE_KEY`

Meaning:

- `ADAMRIT_SESSION_SECRET` signs the Adamrit server session cookie.
- `HRPULSE_API_URL` points Adamrit to the HRPulse backend.
- `HRPULSE_ESS_TOKEN` must match the HRPulse token.
- `SUPABASE_URL` points to Adamrit Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` is used server-side only by Adamrit API routes.

No real secret values should be stored in this report.

## 6. Local URLs

Adamrit local URL:

`http://localhost:8080`

Adamrit HR page:

`http://localhost:8080/hr`

HRPulse backend health:

`http://localhost:3001/health`

HRPulse ESS base:

`http://localhost:3001/api/ess`

## 7. How To See The HR Portal

1. Open Adamrit locally:

`http://localhost:8080`

2. Log in to Adamrit.

3. Open Tablet View.

4. Make sure the user has access to tile:

`t-hr`

5. Click the HR tile.

6. Click:

`Load My HR Data`

7. Adamrit will call HRPulse and show data if the Adamrit user is linked to an HRPulse employee.

## 8. Why Data May Not Appear

If the page says:

`Adamrit secure session is missing`

It means:

- Adamrit frontend login exists
- but the backend secure cookie was not created
- clicking Load My HR Data should now try to refresh this session locally

If the page says:

`HR profile is not linked`

It means:

- Adamrit successfully called HRPulse
- but HRPulse could not find an employee matching the Adamrit user

Example from local testing:

`cmd@hopehospital.com`

For data to appear, HRPulse employee master must contain the same email address.

## 9. Employee Mapping Rule

Current default:

- Adamrit user email maps to HRPulse employee email

Supported future options:

- employee id
- employee number
- employee code
- external UUID

Not allowed:

- employee name

Names are not unique and must not be used for security-sensitive employee mapping.

## 10. Leave Request Flow

Adamrit employee submits leave request from HR portal.

Adamrit sends the request to:

`/api/hrpulse-ess/leaves/request`

Adamrit proxy forwards it to HRPulse:

`/api/ess/leaves/request`

HRPulse stores it in:

`leave_requests`

The request status starts as:

`pending`

HRPulse Super Admin should approve or reject it in HRPulse.

Adamrit only displays the final status.

## 11. Notification And Alert Flow

HRPulse owns notifications and alerts.

Adamrit displays them.

Examples:

- missing punch reminder
- late attendance warning
- payroll processed message
- salary generated message
- leave approval or rejection message
- holiday reminder
- birthday message
- work anniversary message
- company announcement
- low attendance alert
- multiple missing punch alert
- three consecutive late arrival alert

Adamrit does not generate these HR alerts.

## 12. Security Notes

The integration was designed so:

- HRPulse service-role key is not exposed to Adamrit frontend.
- Adamrit service-role key is not exposed to Adamrit frontend.
- HRPulse ESS token is server-side only.
- Adamrit browser calls only Adamrit local/proxy APIs.
- HRPulse validates token and employee identity.
- Employees cannot type another employee id into the HR UI.
- The HR UI uses the logged-in Adamrit user's identity.

Important:

Some real secrets were pasted during the conversation. Those should be treated as exposed and rotated in Supabase, OpenAI, Gemini, and DoubleTick dashboards.

## 13. Verification Done

The following checks were run successfully:

- HRPulse backend TypeScript check
- Adamrit TypeScript check
- HRPulse backend health check
- Adamrit local page response check

Confirmed local services:

- Adamrit responding on port `8080`
- HRPulse backend responding on port `3001`

## 14. Remaining Setup Needed

To fully see real employee data:

1. Apply HRPulse migration:

`backend/supabase/migrations/20260722_ess_integration.sql`

2. Set matching `HRPULSE_ESS_TOKEN` in both applications.

3. Set Adamrit production environment variables.

4. Ensure the Adamrit logged-in user email exists in HRPulse employee master.

5. Allow `t-hr` tile access for the selected Adamrit user role.

## 15. Simple Explanation

HRPulse is the HR office.

Adamrit is the hospital work app.

The new HR tile in Adamrit is like a window into HRPulse.

When the employee clicks Load My HR Data, Adamrit asks HRPulse:

`Show me only this logged-in employee's HR data.`

HRPulse checks the request and sends back only that employee's information.

Adamrit displays it.

Adamrit does not calculate or own the HR data.
