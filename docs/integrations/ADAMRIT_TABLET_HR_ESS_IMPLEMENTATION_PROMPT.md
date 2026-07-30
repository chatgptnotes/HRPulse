# Adamrit Tablet HR Employee Self-Service Portal — Implementation Prompt

## Your task

Implement a production-quality **HR Employee Self-Service (ESS) portal** inside
the Adamrit/HIMS Tablet View.

Do not stop after producing a plan or documentation. Inspect the repository,
implement the database/API/UI changes, run the relevant tests and production
build, and report exactly what was completed and what still requires deployment
configuration.

This prompt is self-contained. Do not require access to the conversation that
created it.

---

## 1. Product outcome

Add a new **HR** tile to the Tablet View dashboard. When an authenticated
employee opens this tile, show a modern, responsive ESS portal containing only
that employee's own:

- employee profile;
- today's attendance;
- monthly attendance summary;
- attendance calendar and history;
- leave balances, requests, history, and decisions;
- current salary summary and previous salary history;
- downloadable PDF payslips;
- HR documents and authorized downloads where supported;
- HRPulse-generated HR notifications and alerts.

Employees must be able to submit leave from Adamrit. The request must go to
HRPulse, where the HRPulse Super Admin approves or rejects it. Adamrit then
displays the authoritative HRPulse decision and updated balance.

An employee must never be able to view or request another employee's attendance,
salary, leave, documents, notifications, or personal information.

### Completion definition

The work is complete only when:

1. the HR tile is visible in Tablet View for authenticated Hope Hospital staff;
2. the tile opens the responsive ESS interface;
3. the HIMS session is securely resolved to one mapped HRPulse employee;
4. all employee data is authorized on the server, not filtered only in React;
5. leave submission reaches HRPulse with idempotency and displays later
   decisions;
6. loading, empty, unmapped, unavailable, and error states work;
7. tests, TypeScript checks, and the production build pass.

---

## 2. Repository facts to verify before editing

The inspected Adamrit repository previously used:

- React 18, TypeScript, Vite, React Router, TanStack Query, Tailwind, and
  shadcn/Radix;
- Vercel TypeScript serverless functions under `api/`;
- Supabase PostgreSQL, Auth, Storage, PostgREST, RPC, and Edge Functions;
- a custom HIMS session through `POST|GET|DELETE /api/auth-session`;
- an HTTP-only `hmis_session` cookie;
- Tablet HR code at `src/tablet/modules/hr/HrFlow.tsx`;
- staff attendance at `src/pages/StaffAttendance.tsx`;
- existing HR staging tables including `hr_employee_profiles`,
  `hr_leave_requests`, `hr_payroll_slips`, and `hr_sync_events`.

Treat these as discovery hints, not assumptions. First:

1. read all applicable `AGENTS.md`/repository instructions;
2. inspect the current branch and working tree without overwriting unrelated
   changes;
3. locate the Tablet View dashboard/tile registry, routing, authentication
   middleware, `HrFlow.tsx`, current HR migrations, and test conventions;
4. confirm whether newer code already implements any requirement;
5. reuse the existing design system and HR flow rather than creating a parallel
   disconnected application.

If file names have changed, follow the current architecture.

---

## 3. Authority and data ownership

Use this ownership model:

| Domain | Authoritative system | Direction |
|---|---|---|
| Employee master | HRPulse | HRPulse → Adamrit |
| Raw attendance and daily punches | Adamrit/HIMS | Adamrit → HRPulse |
| Salary rules and payroll calculation | HRPulse | Internal to HRPulse |
| Finalized payroll and payslips | HRPulse | HRPulse → Adamrit |
| Leave request submission | Either system | Bidirectional |
| Leave approval/rejection and balances | HRPulse | HRPulse → Adamrit |
| HR notifications | HRPulse | HRPulse → employee through Adamrit |
| HR documents | HRPulse secure repository | Metadata/access to Adamrit |
| Identity mapping | Integration layer | HIMS user ↔ employee ↔ HRPulse UUID |

Adamrit must not independently approve or reject leave, recalculate salary, or
present a draft payroll as finalized.

Hope Hospital is the only enabled organization in this phase. Keep Ayushman
disabled and ensure every mapping, query, cache key, receiver, and audit event is
hospital-scoped.

---

## 4. Identity, authentication, and authorization

### Required identity chain

```text
Adamrit username/password
→ server validates hmis_session
→ server obtains immutable HIMS user ID and hospital
→ server loads one active employee mapping
→ mapping supplies HRPulse employee UUID/number
→ server calls HRPulse with server-held credentials
→ HRPulse independently resolves and authorizes that employee
→ response is returned only to the same authenticated session
```

Create or harden a database-enforced mapping with at least:

- immutable HIMS user UUID;
- immutable HIMS employee UUID;
- immutable HRPulse employee UUID;
- Hope organization/hospital identifier;
- employee number/code;
- mapping status (`active`, `conflict`, `inactive`);
- source version and updated timestamps;
- uniqueness on HIMS user, HIMS employee, and HRPulse employee within the
  organization.

### Non-negotiable security rules

- Derive employee identity from the verified server session. Never trust an
  employee ID, employee code, UUID, email, hospital, or role supplied by browser
  query parameters, headers, route parameters, local storage, or request bodies.
- Never match employees by name.
- Prefer HRPulse UUID or employee number. Email may be used only for an audited
  one-time mapping/reconciliation process and must resolve uniquely.
- All Adamrit browser calls must be same-origin calls to Adamrit server routes.
- Never expose `HRPULSE_ESS_TOKEN`, connector bearer tokens, HMAC secrets,
  Supabase service-role keys, or other machine credentials to Vite variables or
  browser bundles.
- Do not use direct browser Supabase queries for sensitive HR records.
- Do not rely on browser-side array filtering as authorization.
- Do not store salary, documents, access tokens, or identity headers in browser
  local storage.
- Scope every server query by session user, mapped employee, active status, and
  Hope organization.
- Stream payslips and documents through an authorized proxy or redirect only to
  a short-lived HRPulse signed URL.
- Log access without logging salary bodies, document contents, credentials, or
  sensitive leave reasons.
- Return `401` for no/expired session, `403` for cross-employee/role violations,
  and `404` for an unmapped or unavailable employee without leaking another
  employee's existence.

The ESS tile is employee self-service even when the logged-in account also has an
administrative role. It shows the employee linked to the current session only.
Keep any workforce-wide HR administration in a separate, explicitly authorized
admin surface.

---

## 5. Adamrit server adapter

Create a server-side ESS adapter using the HIMS session middleware. A recommended
same-origin API shape is:

```text
GET    /api/tablet/hr/profile
GET    /api/tablet/hr/attendance/today?date=YYYY-MM-DD
GET    /api/tablet/hr/attendance/monthly?month=YYYY-MM
GET    /api/tablet/hr/attendance/calendar?month=YYYY-MM
GET    /api/tablet/hr/attendance/history?month=YYYY-MM
GET    /api/tablet/hr/leaves
POST   /api/tablet/hr/leaves
PATCH  /api/tablet/hr/leaves/{requestUuid}
POST   /api/tablet/hr/leaves/{requestUuid}/cancel
GET    /api/tablet/hr/payroll/current?month=YYYY-MM
GET    /api/tablet/hr/payroll/history
GET    /api/tablet/hr/payslips/{periodMonth}
GET    /api/tablet/hr/notifications?limit=50
POST   /api/tablet/hr/notifications/{id}/read
POST   /api/tablet/hr/notifications/read-all
GET    /api/tablet/hr/alerts?month=YYYY-MM
GET    /api/tablet/hr/documents
GET    /api/tablet/hr/documents/{documentUuid}/download
```

Use the repository's existing API conventions if they require a different
layout, but preserve these capabilities and server-side invariants.

Every route must:

1. validate the HIMS session;
2. resolve its employee mapping server-side;
3. reject inactive/conflicted/missing mappings;
4. call HRPulse with only the resolved trusted identity;
5. validate the HRPulse response;
6. return a stable, sanitized response;
7. write a security/audit record.

Use explicit timeouts, bounded retries for safe reads, request IDs, structured
errors, and no unbounded response caching. Mutations must use idempotency rather
than automatic blind retry.

---

## 6. Existing HRPulse ESS read API

The HRPulse server currently exposes employee-scoped routes under `/api/ess`.
Adamrit must call them from its server, never directly from the browser.

Required server-only authentication:

```http
Authorization: Bearer <HRPULSE_ESS_TOKEN>
```

Send one trusted mapped identity, preferably:

```http
X-Employee-UUID: <mapped HRPulse/external UUID>
X-Adamrit-User-Id: <authenticated immutable HIMS user UUID>
```

Employee number may be used when UUID rollout is incomplete:

```http
X-Employee-Number: <mapped employee number>
```

Do not forward identity headers received from the browser.

Available HRPulse endpoints:

```text
GET  /api/ess/profile
GET  /api/ess/attendance/today?date=YYYY-MM-DD
GET  /api/ess/attendance/monthly?month=YYYY-MM
GET  /api/ess/attendance/history?month=YYYY-MM
GET  /api/ess/attendance/calendar?month=YYYY-MM
GET  /api/ess/payroll/current?month=YYYY-MM
GET  /api/ess/payroll/history
GET  /api/ess/payslips/{periodMonth}
GET  /api/ess/leaves
GET  /api/ess/notifications?limit=50
POST /api/ess/notifications/{id}/read
POST /api/ess/notifications/read-all
GET  /api/ess/alerts?month=YYYY-MM
GET  /api/ess/documents
GET  /api/ess/documents/{documentId}/download
```

HRPulse may return:

- `401` for invalid machine credentials;
- `404` for an unmapped employee or missing scoped resource;
- `409` for version/idempotency conflicts;
- `423` for a quarantined document;
- `429` for throttling;
- `5xx`/`503` when a required HR module is unavailable.

Map these to useful UI states without exposing raw internal errors.

---

## 7. Leave submission contract

Use the versioned HRPulse connector API for production leave creation, updates,
and cancellation so requests have stable UUIDs and idempotency.

Adamrit server-only headers:

```http
Authorization: Bearer <connector token>
X-Connector-Id: adamrit-hope
Content-Type: application/json
X-Request-Id: <UUID>
```

Create:

```http
POST /api/integrations/v1/leave-requests
```

```json
{
  "requestUuid": "client-generated-uuid",
  "externalRequestId": "stable-adamrit-request-id",
  "hrpulseEmployeeUuid": "mapped-hrpulse-employee-uuid",
  "leaveType": "CASUAL",
  "startDate": "2026-08-03",
  "endDate": "2026-08-04",
  "startDayPart": "full",
  "endDayPart": "full",
  "reason": "Employee-provided reason",
  "sourceVersion": 1,
  "sourceUpdatedAt": "2026-07-30T12:00:00.000Z"
}
```

Allowed leave types:

```text
CASUAL
SICK
EMERGENCY
```

Allowed day parts:

```text
full
first_half
second_half
```

Update a pending request:

```http
PATCH /api/integrations/v1/leave-requests/{requestUuid}
```

Include the changed fields plus a strictly increased `sourceVersion` and current
`sourceUpdatedAt`.

Cancel a pending request:

```http
POST /api/integrations/v1/leave-requests/{requestUuid}/cancel
```

```json
{
  "reason": "Optional cancellation reason",
  "sourceVersion": 2,
  "sourceUpdatedAt": "2026-07-30T12:05:00.000Z"
}
```

Rules:

- Generate the request UUID once before the first attempt and retain it for all
  retries.
- Store a local request/outbox row transactionally before delivery.
- A network timeout must not generate a new request UUID.
- Duplicate acknowledgement is success.
- A stale version is a visible conflict, not an overwrite.
- Only pending requests may be edited or cancelled.
- Adamrit must never set `approved` or `rejected` locally.
- HRPulse decisions, approver notes, and leave balances overwrite Adamrit
  projections only when the incoming version is newer.
- When HRPulse is unavailable, display `Pending sync` and retry through the
  outbox. Do not falsely display `Submitted to HR`.

If the current HRPulse environment exposes only the transitional
`POST /api/ess/leaves/request`, keep it behind a feature flag for development;
the versioned connector contract above is the production target.

---

## 8. Synchronization receivers

Implement the HIMS receiver/recovery routes expected by the HRPulse connector:

```text
POST /api/integrations/hrpulse/v1/employees
PUT  /api/integrations/hrpulse/v1/employees/{employeeUuid}
POST /api/integrations/hrpulse/v1/employees/{employeeUuid}/deactivate
GET  /api/integrations/hrpulse/v1/attendance-records
POST /api/integrations/hrpulse/v1/leave-requests
POST /api/integrations/hrpulse/v1/leave-requests/{requestUuid}/decision
POST /api/integrations/hrpulse/v1/leave-requests/{requestUuid}/cancel
PUT  /api/integrations/hrpulse/v1/employees/{employeeUuid}/leave-balances
POST /api/integrations/hrpulse/v1/payroll-runs
POST /api/integrations/hrpulse/v1/employee-documents
```

Validate:

```http
Authorization: Bearer <server-only token>
Idempotency-Key: <event UUID>
X-HRPulse-Event-Id: <event UUID>
X-HRPulse-Timestamp: <Unix seconds>
X-HRPulse-Signature: v1=<HMAC-SHA256(timestamp + "." + exact raw JSON body)>
```

Reject signatures older than five minutes. Store event UUIDs in an inbox with a
unique constraint. Valid duplicates return `2xx` without reapplying the change.
Use monotonic versions, append-only delivery attempts, retry scheduling, dead
letters, and reconciliation checkpoints.

For near-real-time ESS updates, apply inbound leave decisions, balances,
notifications, payroll metadata, and employee changes to server-side
projections, then invalidate only the affected employee's cache/query. Also poll
the authoritative HRPulse read endpoints on window focus and at a reasonable
interval so webhooks are not the only recovery mechanism.

---

## 9. Tablet UI specification

Match the reference direction:

- deep navy/charcoal background;
- compact dark cards with subtle borders;
- emerald accent for positive states and primary actions;
- cyan/blue for profile and attendance;
- amber for warnings, missing records, and pending states;
- rose/red for absence, rejection, and errors;
- large touch targets and readable text;
- responsive two-column desktop/tablet layout that becomes one column on narrow
  screens;
- no horizontal scrolling for primary content.

### Tablet dashboard tile

- Label: `HR`
- Supporting text: `Attendance, leave, payroll & documents`
- Use the existing icon system with a recognizable employee/badge icon.
- Show a small unread-notification badge when applicable.
- Use the current Tablet View tile size, hover/focus behavior, keyboard support,
  and role-aware navigation.
- Opening it must preserve the Tablet shell and provide a clear back action.

### HR header

Show:

- `HR` title;
- signed-in employee email or employee number;
- notification bell and unread count;
- refresh action;
- last successful refresh/sync state;
- offline/pending-sync indicator when relevant.

### Profile card

Show:

- profile photo or initials fallback;
- employee name;
- employee ID/number;
- department;
- designation;
- shift name and start/end times;
- joining date;
- email.

Never render another employee selector in the employee ESS view.

### Overview

At the top, show today's:

- punch in;
- punch out;
- working hours;
- normalized status.

Show a selected-month summary:

- present days;
- absent days;
- half days;
- late count;
- missing punches;
- overtime hours;
- working days;
- attendance percentage.

Use skeletons while loading, `No record` for genuine empty attendance, and an
error/retry card for failed requests. Do not render zeroes when the request
failed.

### Attendance

Provide:

- month picker;
- accessible calendar with status legend;
- history list/table with date, in, out, hours, status, late/missing/overtime
  markers;
- summary cards;
- pagination or virtualization for long history;
- consistent Asia/Kolkata date/time display.

### Leave

Provide:

- available, used, and pending balance cards by leave type;
- `Apply for leave` action;
- start date and end date;
- start/end day-part selection;
- calculated duration;
- leave type;
- reason;
- submit confirmation;
- grouped or filtered history for pending, approved, rejected, and cancelled;
- approver notes and decision date;
- edit/cancel actions only while pending;
- visible `Pending sync`, `Pending approval`, `Approved`, `Rejected`,
  `Cancelled`, and `Sync failed` states.

Disable duplicate submission while a request is in flight, but retain the same
idempotency UUID if the employee retries after an ambiguous timeout.

### Payroll

Show only finalized/authorized employee payroll:

- period month;
- gross salary;
- total deductions;
- net salary;
- payable days;
- working days;
- present/absent/half-day counts where returned;
- overtime hours/pay;
- status;
- previous salary periods;
- `Download payslip` button.

The payslip action must proxy/stream the HRPulse PDF with safe
`Content-Disposition`. Do not regenerate salary in Adamrit and do not expose
unfinalized payroll as final.

### Notifications

Display all HRPulse notification types returned by the API, including:

- missing punch reminders;
- late-attendance warnings;
- low-attendance summaries;
- payroll/salary processed notifications;
- leave submitted, approved, or rejected updates;
- holiday reminders;
- birthday wishes;
- work-anniversary messages;
- monthly attendance summaries;
- company announcements.

Provide:

- unread count;
- severity/type icon;
- title, body, timestamp;
- unread styling;
- mark one read;
- mark all read;
- filters;
- empty state.

Do not use AI to invent employee HR facts in Adamrit. Render notifications
created and stored by HRPulse.

### Documents

Where enabled, show employee-owned HR document metadata and status. Download
only through the authorized server endpoint. Handle `423 quarantined` clearly.
Never reuse public patient-document buckets or persist signed URLs.

---

## 10. Data states and error behavior

Implement distinct UI states for:

- initial loading;
- partial section loading;
- empty data;
- no attendance record;
- employee not mapped;
- ambiguous/conflicting mapping;
- inactive employee;
- wrong hospital;
- HRPulse unavailable;
- machine credential rejected;
- session expired;
- stale leave version;
- duplicate acknowledged;
- pending synchronization;
- retry scheduled;
- document quarantined;
- payroll not finalized;
- unexpected server error.

Do not silently substitute mock data, another employee's data, or zeros for an
error. Mock fixtures may exist only in tests and Storybook/development fixtures
that are impossible to enable accidentally in production.

Use error boundaries or section isolation so one unavailable module does not
blank the whole ESS portal.

---

## 11. Accessibility and responsive requirements

- Meet WCAG AA contrast for text and meaningful status colors.
- Do not communicate status by color alone.
- Support keyboard navigation, visible focus, semantic headings, labels, and
  accessible dialogs.
- Use touch targets of at least 44×44 CSS pixels.
- Announce async success/error messages through an ARIA live region.
- Preserve employee-entered form values after a recoverable failure.
- Confirm destructive cancellation.
- Test common tablet landscape/portrait widths, 1366px desktop, and narrow
  mobile widths.

---

## 12. Testing requirements

Add unit, component, integration, and contract tests following repository
conventions.

### Authorization

- Unauthenticated requests return `401`.
- An employee can retrieve their own records.
- Tampering with any employee ID/email/UUID/query/body/header cannot switch the
  resolved employee.
- Employee A cannot access Employee B's profile, attendance, leave, payroll,
  payslip, notification, or document.
- A Hope user cannot access Ayushman data.
- Inactive/conflicted/missing mappings fail closed.
- Browser bundles contain no HRPulse machine credentials.

### Leave

- Whole-day and half-day duration calculations are correct.
- End before start is rejected.
- Duplicate clicks/timeouts produce one request UUID.
- Duplicate identical delivery is acknowledged.
- Conflicting or stale versions return a visible conflict.
- Only pending requests can be edited/cancelled.
- HIMS cannot locally approve/reject.
- HRPulse decision and balance events update only the mapped employee.
- HRPulse downtime produces `pending_sync` and later successful retry.

### ESS data

- Today's attendance, monthly summary, calendar, and history render correct
  mapped results.
- Empty attendance differs from failed attendance.
- Salary displays only returned/finalized HRPulse data.
- Payslip download has correct content type and filename.
- Notification read/read-all updates only the current employee.
- Quarantined document access is blocked.

### Integration resilience

- Invalid/expired HMAC signatures fail.
- Replay inside/outside the window is handled correctly.
- Duplicate event UUID is idempotent.
- Out-of-order lower versions are ignored/rejected.
- `429` and retryable `5xx` follow bounded backoff.
- Non-retryable validation errors go to reconciliation/dead-letter state.

### UI

- Tile navigation and back action work.
- Responsive layout works at tablet, desktop, and mobile sizes.
- Loading, empty, error, offline, and pending-sync states are tested.
- Keyboard and accessible names are verified.

Run:

- targeted automated tests;
- TypeScript typecheck;
- lint without rewriting unrelated files;
- production build;
- existing repository test suite relevant to changed modules.

---

## 13. Rollout and operational safety

1. Add migrations additively; never delete current HR data during rollout.
2. Backfill mappings with an explicit review report. Do not automatically accept
   name-based matches.
3. Enable only Hope Hospital.
4. Run HRPulse connector delivery in shadow/sandbox mode first.
5. Test at least one mapped employee end to end with fabricated/non-sensitive
   data.
6. Reconcile employee mapping, leave states, notification counts, and finalized
   payroll before active mode.
7. Add operational visibility for last success, last error, pending outbox,
   dead letters, and mapping conflicts.
8. Retain a feature flag that can hide the HR tile without deleting data if the
   adapter is unavailable.

Do not commit credentials, real employee data, generated access tokens, signed
URLs, logs containing HR details, or production database exports.

---

## 14. Required implementation report

When finished, report:

- tile/dashboard changes;
- reused/refactored HR components;
- HIMS session-to-employee mapping implementation;
- Adamrit server proxy endpoints;
- migrations and RLS/authorization changes;
- leave submission/outbox/decision flow;
- notification, payroll, payslip, attendance, and document behavior;
- tests/build commands and results;
- required environment-variable names only;
- migration/deployment order;
- any external HRPulse configuration still needed.

Clearly distinguish implemented code from items that require deployment,
credentials, migrations, or HRPulse connector activation.
