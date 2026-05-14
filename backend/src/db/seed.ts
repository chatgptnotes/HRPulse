import prisma from './prisma';

const DEFAULT_SETTINGS: [string, string][] = [
  ['smtp_host', process.env.SMTP_HOST || ''],
  ['smtp_port', process.env.SMTP_PORT || '587'],
  ['smtp_secure', 'false'],
  ['smtp_user', process.env.SMTP_USER || ''],
  ['smtp_pass', process.env.SMTP_PASS || ''],
  ['ollama_url', process.env.OLLAMA_URL || 'http://localhost:11434'],
  ['ollama_model', process.env.OLLAMA_MODEL || 'llama3.1:8b'],
  ['company_name', process.env.COMPANY_NAME || 'Your Company'],
  ['hr_name', process.env.HR_NAME || 'HR Department'],
  ['working_days', '26'],
  ['missed_swipe_weight', '0.5'],
];

const DEFAULT_TEMPLATES = [
  {
    type: 'initial',
    subject: 'Attendance Alert: {{flagged_count}} Record(s) Requiring Attention',
    body: `Dear {{employee_name}},

We have noticed the following attendance records in your data for {{period_month}}. Please review and take necessary action.

Attendance Summary:
{{records_table}}

If you have valid reasons for the above, kindly apply for leave or provide clarification at the earliest.

Thank you for your cooperation.

Best regards,
{{hr_name}}
{{company_name}}`,
  },
  {
    type: 'reminder',
    subject: 'Reminder: Attendance Records Still Pending — {{period_month}}',
    body: `Dear {{employee_name}},

This is a reminder regarding your attendance records for {{period_month}} that still require your attention. We had previously notified you, but the matter remains unresolved.

Outstanding Records:
{{records_table}}

Kindly apply for leave or provide clarification immediately to avoid further action.

Thank you,
{{hr_name}}
{{company_name}}`,
  },
  {
    type: 'escalation',
    subject: 'URGENT: Attendance Issue — Action Required',
    body: `Dear {{employee_name}},

Despite previous communications, your attendance records for {{period_month}} remain unaddressed. This is a formal notice that continued non-compliance may result in disciplinary action.

Records in Question:
{{records_table}}

Please contact HR immediately.

{{hr_name}}
{{company_name}}`,
  },
];

const DEFAULT_SOPS = [
  {
    title: 'Attendance Regularization Policy',
    category: 'Attendance',
    content: `## Attendance Regularization Policy

### Purpose
This SOP defines the process for employees to regularize their attendance records.

### Scope
Applies to all full-time, part-time, and contract employees.

### Procedure

**Step 1: Identify Issue**
- Employee reviews their attendance record in the system
- Identifies any missed punches, incorrect entries, or absences

**Step 2: Submit Request**
- Employee must submit regularization request within 3 working days
- Provide reason with supporting documentation if applicable

**Step 3: Manager Approval**
- Line manager reviews and approves/rejects within 2 working days
- Any rejection must include justification

**Step 4: HR Processing**
- HR processes approved requests within 1 working day
- Updates payroll deductions accordingly

### Escalation
Unresolved requests beyond 5 working days escalate to HR Head.`,
    tags: ['attendance', 'regularization', 'policy'],
  },
  {
    title: 'Late Coming & Early Leaving Policy',
    category: 'Attendance',
    content: `## Late Coming & Early Leaving Policy

### Standard Working Hours
- Official start time: 9:00 AM
- Official end time: 6:00 PM
- Grace period: 15 minutes

### Late Coming
- More than 15 minutes after start = Late Coming
- 3 late comings in a month = 0.5 day LOP
- 6 late comings in a month = 1 day LOP

### Early Leaving
- Leaving before official end time without approval
- Treated same as late coming for LOP calculation

### Exceptions
- Prior approval from manager required for exceptions
- Medical emergencies exempt with documentation`,
    tags: ['late-coming', 'early-leaving', 'LOP'],
  },
  {
    title: 'Email Notification SOP for HR',
    category: 'Communication',
    content: `## HR Email Notification Standard Operating Procedure

### Monthly Attendance Email Cycle

**Week 1 of each month:**
1. Download attendance data from GDHR SmartTime system
2. Upload to HRPulse Dispatcher
3. Review flagged records (absent, missed swipe, late, early)
4. Generate AI email drafts
5. Review and edit as needed
6. Dispatch all emails

**Follow-up (Day 7):**
- Check for unresolved cases
- Send reminder emails to employees who haven't responded

**Escalation (Day 14):**
- Employees with 3+ consecutive unresolved months
- Send escalation email with formal warning

### Email Templates
- Initial: Professional, empathetic tone
- Reminder: Firmer, action-required tone
- Escalation: Formal, disciplinary warning`,
    tags: ['email', 'notification', 'monthly-cycle'],
  },
];

const DEFAULT_RULES = [
  {
    name: 'Flag Absent Days',
    description: 'Mark employees as flagged when they have any absent days',
    ruleType: 'flagging',
    conditions: { status: 'Absent', threshold: 1 },
    actions: { flag: true, emailType: 'initial' },
    priority: 1,
  },
  {
    name: 'Missed Swipe Alert',
    description: 'Send alert when employee has 3+ missed swipes in a month',
    ruleType: 'alert',
    conditions: { status: 'Missed Swipe', threshold: 3 },
    actions: { flag: true, emailType: 'initial', notifyManager: true },
    priority: 2,
  },
  {
    name: 'Repeat Offender Escalation',
    description: 'Escalate to formal warning after 3 consecutive months',
    ruleType: 'escalation',
    conditions: { consecutiveMonths: 3 },
    actions: { emailType: 'escalation', notifyHRHead: true },
    priority: 10,
  },
];

export async function seedDatabase() {
  // Seed settings
  for (const [key, value] of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  // Seed email templates
  for (const template of DEFAULT_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { type: template.type },
      update: {},
      create: template,
    });
  }

  // Seed SOPs
  const sopCount = await prisma.sop.count();
  if (sopCount === 0) {
    for (const sop of DEFAULT_SOPS) {
      await prisma.sop.create({ data: sop });
    }
  }

  // Seed Rules
  const ruleCount = await prisma.attendanceRule.count();
  if (ruleCount === 0) {
    for (const rule of DEFAULT_RULES) {
      await prisma.attendanceRule.create({ data: rule });
    }
  }
}
