# Adamrit HRPulse Complete System Guide

Generated on: 28 July 2026

This document explains the HRPulse and Adamrit HR integration in simple language. It covers the full flow from employee master setup, attendance Excel upload, payroll rules, salary calculation, notifications, Adamrit HR tile display, and how both applications are connected.

This document does not include passwords, service-role keys, API keys, or private tokens.

## 1. Big Picture

There are two separate applications:

- HRPulse
- Adamrit

HRPulse is the master HR system. It owns employee master data, attendance, leave, salary, payroll, rules, payslips, documents, and HR notifications.

Adamrit is the hospital management system. Employees already log in to Adamrit every day. Adamrit now also works as an Employee Self-Service portal for HR data.

The important rule is:

- HRPulse calculates everything.
- Adamrit displays employee-specific HR data.
- Adamrit does not calculate salary, payroll, attendance, leave balance, or HR rules.
- Adamrit never becomes the master HR database.

## 2. Full Integration Flow

The full flow is:

```text
Employee Master in HRPulse
        ↓
Daily / bulk biometric Excel upload in HRPulse
        ↓
HRPulse parses attendance date-wise
        ↓
HRPulse saves attendance records
        ↓
HRPulse fills missing month dates as Not Attempted for payroll
        ↓
HRPulse applies attendance policy
        ↓
HRPulse calculates salary and deductions
        ↓
HRPulse generates HR notifications
        ↓
Notifications are saved in HRPulse
        ↓
Notifications are synchronized to Adamrit
        ↓
Employee opens HR tile in Adamrit
        ↓
Employee sees profile, attendance, salary, leaves, documents, payslips, and notifications
```

## 3. Employee Mapping Between HRPulse And Adamrit

Employees are connected between both systems using a unique identifier.

Preferred matching order:

- Employee ID
- Employee Code / Employee Number
- UUID / External UUID
- Email address

Employee name is not used for secure matching because names can be duplicate or misspelled.

Example:

```text
Adamrit logged-in user email = cmd@hopehospital.com
HRPulse employee email = cmd@hopehospital.com
Result = Adamrit can show only this employee's HRPulse data
```

If the email or employee identifier does not match, Adamrit HR tile cannot load that employee's HR profile.

## 4. Employee Master In HRPulse

HRPulse Employee Master stores important employee data:

- Employee name
- Employee number
- Email
- Mobile number
- Department
- Designation
- Shift
- Shift start time
- Shift end time
- Monthly salary
- Paid leave related values
- Overtime eligibility
- Status

The email is very important because Adamrit uses it to connect the logged-in Adamrit user with the HRPulse employee record.

## 5. Adamrit HR Tile

Inside Adamrit Tablet View Dashboard there is an HR tile.

When employee opens HR tile:

- Adamrit checks the logged-in employee session.
- Adamrit creates/refreshes secure employee identity.
- Adamrit calls its own server-side API route.
- Adamrit server-side API calls HRPulse ESS API.
- HRPulse returns only that employee's data.

The employee can see:

- Profile
- Today's attendance
- Monthly attendance summary
- Attendance calendar
- Attendance history
- Salary summary
- Payroll history
- Payslip download
- Leave balance
- Leave request form
- Leave history
- Documents
- HRPulse notifications

## 6. Security Flow

The browser does not directly call HRPulse with private server credentials.

Secure flow:

```text
Adamrit browser
        ↓
Adamrit serverless API route
        ↓
HRPulse ESS API with integration token
        ↓
HRPulse validates employee identity
        ↓
HRPulse returns only that employee's records
```

This protects employees from seeing another employee's salary, attendance, leave, or personal data.

## 7. Attendance Excel Upload

HR uploads biometric attendance Excel in HRPulse.

The Excel can be:

- Daily attendance
- 4-5 days together
- Half month
- Full month
- Multiple months in one sheet

HRPulse analyzes each row date-wise.

If the sheet contains multiple months, HRPulse groups records by month and saves each date under the correct month.

Example:

```text
Excel contains:
2026-07-24
2026-07-25
2026-08-01

HRPulse saves:
July records under 2026-07
August records under 2026-08
```

## 8. Attendance Status Detection

HRPulse reads attendance status and punch timing from Excel.

Common statuses:

- Present
- Normal
- Late Coming
- Early Leaving
- Missing Punch
- Missed Swipe
- Incomplete
- Half Day
- Absent
- Paid Leave
- Weekly Off
- Holiday
- Not Attempted

Punch timing examples:

```text
09:00 - 18:00 = Present / Normal
09:30 - 18:00 = Late
09:00 - blank = Missing punch-out
blank - 18:00 = Missing punch-in
blank - blank with no uploaded row = Not Attempted
```

## 9. Not Attempted Logic

When payroll detail is opened, HRPulse shows the full month.

If July has 31 days, HRPulse shows:

```text
01 July to 31 July
```

If attendance was uploaded only until 25 July:

```text
26 July to 31 July = Not Attempted
```

Not Attempted means:

- Attendance was not uploaded for that date.
- Employee is not marked present.
- For payroll calculation, Not Attempted counts as absence.

When remaining attendance is uploaded later:

```text
Not Attempted date gets replaced by real attendance data
```

Example:

```text
Before upload:
26 July = Not Attempted = absence for salary

After upload:
26 July = Present = no absent deduction
```

## 10. Monthly Payroll Calculation

Salary is monthly, but attendance is analyzed date-wise.

HRPulse reads every date, counts the month totals, then calculates salary.

The salary formula now is:

```text
Gross Salary = Monthly Salary + Overtime Pay
Total Deductions = Absent Deduction + Half-Day Deduction + Late Deduction + Rule Deduction
Final Net Salary = Gross Salary - Total Deductions
```

Missing punch does not deduct salary.

## 11. Per Day Salary Rule

The final payroll policy uses fixed 26 days.

```text
Per Day Salary = Monthly Salary / 26
```

Example:

```text
Monthly Salary = INR 15,000
Per Day Salary = 15,000 / 26
Per Day Salary = INR 577 approximately
```

This per-day salary is used for:

- Absent deduction
- Late deduction
- Half-day deduction

## 12. Department-Based Leave And Sunday Policy

### IT Department

IT employees get:

- Sundays as weekly off
- 2 casual paid leaves per month

For IT:

```text
Sunday = Weekly Off
Sunday Not Attempted = No salary deduction
```

If IT employee has 2 absences in the month:

```text
Paid Leave Used = 2
Unpaid Absence = 0
Absent Deduction = INR 0
```

If IT employee has 4 absences:

```text
Paid Leave Used = 2
Unpaid Absence = 2
Absent Deduction = 2 x Per Day Salary
```

### Non-IT Departments

All departments except IT get:

- 4 paid leaves per month
- Sundays are working days

For non-IT:

```text
Sunday = Working Day
Sunday Not Attempted = Absence
Sunday Absent can be covered by paid leave
```

If non-IT employee has 4 absences:

```text
Paid Leave Used = 4
Unpaid Absence = 0
Absent Deduction = INR 0
```

If non-IT employee has 6 absences:

```text
Paid Leave Used = 4
Unpaid Absence = 2
Absent Deduction = 2 x Per Day Salary
```

## 13. Absence Calculation

HRPulse now shows absence clearly in payroll detail.

It separates:

- Total Absences
- Paid Leaves
- Unpaid Absences
- Absent Salary Impact

Example:

```text
Total Absences = 6
Paid Leaves = 4
Unpaid Absences = 2
Per Day Salary = INR 577
Absent Deduction = 2 x 577 = INR 1,154
```

If paid leave covers all absence:

```text
Total Absences = 2
Paid Leaves = 2
Unpaid Absences = 0
Absent Deduction = INR 0
```

## 14. Missing Punch Logic

Missing punch means attendance has incomplete punch data.

Examples:

```text
Punch-in exists but punch-out missing
Punch-out exists but punch-in missing
Status is Missed Swipe / Missing Punch / Incomplete
```

Current rule:

```text
Missing Punch Deduction = INR 0
```

Missing punch is shown in:

- Attendance summary
- Day-by-day records
- Adamrit attendance calendar
- Notifications if count is more than 2

If missing punches are 1 or 2:

```text
Only shown as count
No salary deduction
No Adamrit warning notification
```

If missing punches are more than 2:

```text
HRPulse creates warning notification
Adamrit notification bell shows the warning
```

## 15. Late Coming Logic

Late coming is detected using shift start time and grace minutes.

Default example:

```text
Shift Start = 09:00
Grace = 15 minutes
Punch-in after 09:15 = Late
```

Salary deduction rule:

```text
Every 3 late arrivals = 1 salary day deduction
```

Example:

```text
Monthly Salary = INR 15,000
Per Day Salary = 15,000 / 26 = INR 577
Late Count = 8
Late Deduction Days = floor(8 / 3) = 2
Late Deduction = 2 x 577 = INR 1,154
```

Remaining late arrivals that do not complete a group of 3 do not create an extra deduction.

Example:

```text
Late Count = 2
Late Deduction Days = 0

Late Count = 3
Late Deduction Days = 1

Late Count = 5
Late Deduction Days = 1

Late Count = 6
Late Deduction Days = 2
```

## 16. Half-Day Logic

Half day is based on actual working hours.

Rule:

```text
If working hours are less than 4 hours, mark Half Day
```

Half-day deduction:

```text
Half-Day Deduction = Per Day Salary / 2
```

Example:

```text
Monthly Salary = INR 15,000
Per Day Salary = INR 577
Half Day Deduction = 577 / 2 = INR 289 approximately
```

If employee has 2 half days:

```text
Half-Day Deduction = 2 x 289 = INR 578 approximately
```

## 17. Overtime Logic

Overtime does not apply to every employee automatically.

Employee Master has overtime eligibility.

Only employees marked eligible for overtime can receive overtime calculation.

Rule:

```text
Overtime is based on punch-out time after shift end time.
Overtime applies only if employee works more than 2 hours after shift end.
```

Example:

```text
Shift End = 18:00
Punch Out = 20:15
Overtime Duration = 2 hours 15 minutes
Overtime is payable because it is more than 2 hours
```

If punch out is 20:00 or earlier:

```text
Overtime Duration = 2 hours or less
Overtime Pay = INR 0
```

Overtime pay policy:

```text
Overtime Per Day = (Monthly Salary / 30) / 2
```

## 18. Paid Leave Request Flow

Employees can submit leave requests from Adamrit HR tile.

Flow:

```text
Employee opens Adamrit HR tile
        ↓
Employee submits leave request
        ↓
Adamrit sends request to HRPulse ESS API
        ↓
HRPulse saves leave request
        ↓
HRPulse Super Admin reviews request
        ↓
Approved / Rejected status is available to employee in Adamrit
```

Adamrit does not approve leave. HRPulse remains the approval system.

## 19. Documents Flow

Employees can upload documents from Adamrit HR tile.

Flow:

```text
Employee uploads document in Adamrit
        ↓
Adamrit sends document through secure HRPulse ESS API
        ↓
HRPulse stores the document
        ↓
Document appears in HRPulse Employee Master document section
        ↓
Employee can also see document in Adamrit HR tile
```

Examples:

- Identity document
- Address proof
- Education certificate
- Experience letter
- Medical certificate
- Bank document
- Other document

## 20. Payroll Detail Screen

Payroll detail shows:

- Monthly salary
- Per-day salary
- Final net salary
- Payable days
- Profile details
- Salary breakdown
- Attendance summary
- Salary calculation formula
- Deductions
- Final payable
- Payroll rules applied
- Day-by-day records
- Punch timing PDF button

The Day-by-Day Records table shows:

- Date
- Punch in
- Punch out
- Working hours
- Status

Statuses include:

- Present
- Absent
- Late
- Missing Punch
- Half Day
- Weekly Off
- Not Attempted

## 21. Attendance Rules Page

Attendance Rules page is for salary-effect rules and HR automation rules.

Rules can affect:

- Absence
- Late coming
- Missing punch
- Half day
- Overtime
- Shift
- Leave
- Payroll
- AI notifications
- Custom rules

Important:

- Default payroll logic is not always created from the Rules page.
- Some policies are system payroll logic.
- Salary-effect rules created in Rules page show under `Payroll Rules Applied`.

Example:

```text
Rule: If late arrivals are 3 or more, deduct 1 salary day
Effect: Rule deduction appears in Payroll Rules Applied
```

If no salary-effect rule matched:

```text
Payroll Rules Applied (0)
No active salary-effect rule from the Rules tab matched this employee.
```

## 22. Default Payroll Logic Versus Rules Page Logic

There are two kinds of logic.

### System Payroll Logic

This is built into HRPulse payroll engine:

- Per-day salary = Monthly Salary / 26
- Department-based paid leaves
- IT Sunday weekly off
- Non-IT Sunday working day
- Not Attempted counts as absence
- Missing punch no salary deduction
- Every 3 late arrivals = 1 salary day deduction
- Half day = per-day salary / 2

### Rules Page Logic

This is created/configured in the Rules page:

- Custom salary deduction rules
- Custom salary allowance rules
- Custom attendance triggers
- Custom notification behavior

Rules page results appear under:

```text
Payroll Rules Applied
```

## 23. Notification Flow From HRPulse To Adamrit

HRPulse creates notifications. Adamrit displays them.

Full flow:

```text
Attendance Excel uploaded in HRPulse
        ↓
Attendance records saved
        ↓
HRPulse Attendance Alert Service analyzes records
        ↓
Notifications are created in HRPulse notification table
        ↓
Notification sync sends message to Adamrit
        ↓
Adamrit stores employee notification
        ↓
Adamrit HR tile notification bell shows unread count
        ↓
Employee opens notification drawer
```

Notifications are employee-specific.

Employee A cannot see Employee B notifications.

## 24. Notification Timing

Notifications are generated at these times:

### Immediately after Excel upload

When HR uploads attendance Excel:

```text
Excel processed
Attendance records saved
Attendance alerts generated
Notifications saved
Notifications synced to Adamrit
```

This is the main timing.

### When Adamrit HR tile refreshes

Adamrit also fetches notifications when:

- Employee opens HR tile
- Employee refreshes HR tile
- Adamrit periodic refresh runs
- Realtime notification event arrives

### Realtime behavior

Adamrit listens for employee notification inserts in its notification table.

When a new notification arrives:

- Bell count increases
- Toast can appear
- Notification drawer shows the message

## 25. Notification Types

Notification examples:

- Late arrival alert
- Missing punch warning
- Multiple missing punches
- Half-day alert
- Absent alert
- Insufficient working hours
- Overtime alert
- Holiday work alert
- Weekly off attendance
- Three consecutive late arrivals
- Three consecutive absences
- Low attendance percentage
- Payroll processed
- Salary generated
- Payslip available
- Leave approved
- Leave rejected
- Holiday reminder
- Birthday wish
- Work anniversary
- Company announcement

## 26. Missing Punch Notification Example

If employee has 3 missing punches:

```text
Title: Multiple missing punches
Message: You have 3 missing punch records. Please regularize them with HR. No salary deduction has been applied for missing punches.
Severity: Warning
```

If employee has 1 missing punch:

```text
Shown in attendance summary
No salary deduction
No Adamrit warning notification
```

## 27. Late Notification Example

If employee is late 3 consecutive working days:

```text
Title: Three consecutive late arrivals
Message: You reported late for 3 consecutive working days. Please ensure timely attendance.
Severity: Critical
```

If employee is late on one day:

```text
Title: Late arrival alert
Message: You were late on 24 Jul 2026. Punch-in: 09:30, shift start: 09:00.
Severity: Warning
```

## 28. Adamrit Notification Bell

Adamrit HR tile has a notification bell.

It shows:

- Unread count
- Notification title
- Message body
- Severity color
- Created time
- Mark as read
- Mark all read
- Refresh

When a new notification arrives:

- Bell count updates
- Toast can appear
- Employee can open drawer to read details

## 29. Payslip And PDF Flow

Employees can download payslips from Adamrit.

Flow:

```text
Employee clicks Payslip in Adamrit
        ↓
Adamrit calls HRPulse ESS payslip endpoint
        ↓
HRPulse generates/downloads PDF
        ↓
Employee receives payslip PDF
```

Adamrit does not create salary PDF by itself.

## 30. Example: Partial Month Upload

Scenario:

```text
Month = July
July has 31 days
HR uploads attendance from 1 July to 25 July
26 July to 31 July are not uploaded
```

HRPulse shows:

```text
01-25 = real attendance
26-31 = Not Attempted
```

Payroll:

```text
Not Attempted dates count as absence
Paid leaves cover them first
Remaining unpaid absence deducts salary
```

Later:

```text
HR uploads 26-31 attendance
Real records replace Not Attempted
Payroll recalculates full month
```

## 31. Example: IT Employee Salary

Employee:

```text
Department = IT
Monthly Salary = INR 15,000
Per Day Salary = 15,000 / 26 = INR 577
Sundays = Weekly Off
Paid Leaves = 2
```

Attendance:

```text
Total Absences = 3
2 absences covered by paid leave
1 unpaid absence remains
Late Count = 4
Missing Punch = 1
Half Day = 0
Overtime = 0
```

Calculation:

```text
Absent Deduction = 1 x 577 = INR 577
Late Deduction = floor(4 / 3) x 577 = 1 x 577 = INR 577
Missing Punch Deduction = INR 0
Half-Day Deduction = INR 0
Total Deduction = 577 + 577 = INR 1,154
Final Salary = 15,000 - 1,154 = INR 13,846
```

## 32. Example: Non-IT Employee Salary

Employee:

```text
Department = Reception
Monthly Salary = INR 15,000
Per Day Salary = 15,000 / 26 = INR 577
Sundays = Working Days
Paid Leaves = 4
```

Attendance:

```text
Total Absences = 6
Paid Leave Used = 4
Unpaid Absences = 2
Late Count = 8
Missing Punch = 1
Half Day = 0
```

Calculation:

```text
Absent Deduction = 2 x 577 = INR 1,154
Late Deduction = floor(8 / 3) x 577 = 2 x 577 = INR 1,154
Missing Punch Deduction = INR 0
Total Deductions = 1,154 + 1,154 = INR 2,308
Final Salary = 15,000 - 2,308 = INR 12,692
```

## 33. What Adamrit Shows From HRPulse

Adamrit HR tile shows the final processed HRPulse data:

- Profile
- Shift
- Department
- Designation
- Attendance today
- Monthly summary
- Attendance calendar
- Attendance history
- Leave balance
- Leave requests
- Current salary
- Salary history
- Payslips
- Documents
- Notifications

Adamrit is not calculating these values.

## 34. What HRPulse Super Admin Controls

HRPulse Super Admin controls:

- Employee Master
- Attendance upload
- Attendance correction
- Shift setup
- Leave approval/rejection
- Salary and payroll calculation
- Rules
- Notifications
- Payslips
- Documents
- Reports

Adamrit employee users cannot change HRPulse payroll logic.

## 35. Important Files

Main HRPulse payroll logic:

- `backend/src/services/payrollService.ts`

Attendance alert and notification generation:

- `backend/src/services/attendanceAlertService.ts`

HRPulse ESS API:

- `backend/src/routes/ess.ts`

HRPulse payroll API:

- `backend/src/routes/payroll.ts`

Adamrit HR tile:

- `adamrit/src/tablet/modules/hr/HrEssFlow.tsx`

Adamrit HRPulse proxy:

- `adamrit/api/hrpulse-ess/[...path].ts`

Adamrit HRPulse notifications API:

- `adamrit/api/hrpulse-notifications.ts`

Payroll detail modal:

- `frontend/src/components/payroll/PayrollDetailModal.tsx`

## 36. What To Check After Uploading Excel

After uploading attendance Excel:

1. Open HRPulse Payroll page.
2. Load the payroll month.
3. Open an employee salary detail.
4. Check Day-by-Day Records.
5. Confirm all dates of month are visible.
6. Confirm missing dates show Not Attempted.
7. Confirm Not Attempted affects absence.
8. Confirm paid leaves are applied.
9. Confirm unpaid absences deduct salary.
10. Confirm missing punch does not deduct salary.
11. Confirm late deduction appears correctly.
12. Open Adamrit HR tile.
13. Check notifications and salary summary.

## 37. Simple Final Summary

HRPulse is the brain.

Adamrit is the employee screen.

Attendance is uploaded date-wise.

Salary is calculated monthly.

Not Attempted dates count as absence.

IT gets Sundays off and 2 paid leaves.

Non-IT works Sundays and gets 4 paid leaves.

Per-day salary is monthly salary divided by 26.

Missing punch does not cut salary.

More than 2 missing punches creates Adamrit notification.

Late deduction is every 3 late arrivals equals 1 salary day.

All final HR/payroll data comes from HRPulse and is shown securely in Adamrit.
