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

// Dubai Government HR Rules — based on UAE Federal Law No. 11 of 2008 (Civil Service) and Dubai Government HR Policy
const DEFAULT_RULES = [
  // ── ABSENCE RULES ──
  {
    name: 'Unexcused Absence — First Notice',
    description: 'Any unexcused absence triggers an initial notification per Dubai Government attendance policy.',
    ruleType: 'absence_threshold',
    conditions: { absentDays: { gte: 1 } },
    actions: { templateType: 'initial', severity: 'notice', lopMultiplier: 1 },
    priority: 1,
    isActive: true,
  },
  {
    name: 'Repeated Absence — Formal Warning (3+ Days)',
    description: 'Three or more absent days in a month requires a formal written warning under Article 78 of Federal Law No. 11.',
    ruleType: 'absence_threshold',
    conditions: { absentDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', lopMultiplier: 1, notifyManager: true },
    priority: 2,
    isActive: true,
  },
  {
    name: 'Critical Absence — Escalation to HR Director (5+ Days)',
    description: 'Five or more absent days in a month: disciplinary committee referral risk. Escalation mandatory per Dubai Gov HR circular.',
    ruleType: 'absence_threshold',
    conditions: { absentDays: { gte: 5 } },
    actions: { templateType: 'escalation', severity: 'critical', notifyHRDirector: true, disciplinaryRisk: true },
    priority: 3,
    isActive: true,
  },
  {
    name: 'AWOL — Consecutive Absence (3 Days)',
    description: 'Three or more consecutive absent days = Absence Without Official Leave (AWOL). Triggers formal investigation under Article 79.',
    ruleType: 'absence_threshold',
    conditions: { absentDays: { gte: 3 }, consecutive: true },
    actions: { templateType: 'escalation', severity: 'critical', awol: true, notifyHRDirector: true, initiateInvestigation: true },
    priority: 4,
    isActive: true,
  },

  // ── LATE COMING RULES ──
  {
    name: 'Late Coming — Reminder (1–3 Times)',
    description: 'Grace period is 15 minutes. 1–3 late arrivals per month trigger a courtesy reminder.',
    ruleType: 'late_coming',
    conditions: { lateComingDays: { gte: 1, lte: 3 } },
    actions: { templateType: 'initial', severity: 'notice', gracePeriodMinutes: 15 },
    priority: 5,
    isActive: true,
  },
  {
    name: 'Late Coming — Half-Day LOP Warning (4–6 Times)',
    description: '4–6 late arrivals per month = 0.5 day Loss of Pay deduction per Dubai Government payroll policy.',
    ruleType: 'late_coming',
    conditions: { lateComingDays: { gte: 4, lte: 6 } },
    actions: { templateType: 'reminder', severity: 'warning', lopDays: 0.5, notifyManager: true },
    priority: 6,
    isActive: true,
  },
  {
    name: 'Late Coming — Full-Day LOP + Formal Notice (7+ Times)',
    description: '7 or more late arrivals per month = 1 full-day LOP deduction and formal written warning. Disciplinary risk.',
    ruleType: 'late_coming',
    conditions: { lateComingDays: { gte: 7 } },
    actions: { templateType: 'escalation', severity: 'critical', lopDays: 1, notifyHRDirector: true, disciplinaryRisk: true },
    priority: 7,
    isActive: true,
  },

  // ── MISSED SWIPE RULES ──
  {
    name: 'Missed Biometric — Initial Notice (1–2 Times)',
    description: 'Failure to register biometric attendance (fingerprint/face scan) = half-day absence per Dubai Smart Government policy.',
    ruleType: 'missed_swipe',
    conditions: { missedSwipeDays: { gte: 1, lte: 2 } },
    actions: { templateType: 'initial', severity: 'notice', lopMultiplier: 0.5 },
    priority: 8,
    isActive: true,
  },
  {
    name: 'Missed Biometric — Formal Warning (3+ Times)',
    description: 'Three or more missed biometric registrations in a month. Repeated pattern may indicate buddy-punching or time fraud.',
    ruleType: 'missed_swipe',
    conditions: { missedSwipeDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', lopMultiplier: 0.5, notifyManager: true, integrityFlag: true },
    priority: 9,
    isActive: true,
  },

  // ── EARLY LEAVING RULES ──
  {
    name: 'Early Leaving — Reminder (1–2 Times)',
    description: 'Leaving before official end time without prior approval. Treated as partial absence.',
    ruleType: 'early_leaving',
    conditions: { earlyLeavingDays: { gte: 1, lte: 2 } },
    actions: { templateType: 'initial', severity: 'notice', lopMultiplier: 0.5 },
    priority: 10,
    isActive: true,
  },
  {
    name: 'Early Leaving — Formal Warning (3+ Times)',
    description: 'Three or more early departures in a month triggers a formal written warning and manager notification.',
    ruleType: 'early_leaving',
    conditions: { earlyLeavingDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', lopMultiplier: 0.5, notifyManager: true },
    priority: 11,
    isActive: true,
  },

  // ── COMBINED / ESCALATION RULES ──
  {
    name: 'Combined Attendance Issues — High Risk',
    description: 'Total flagged incidents (absent + missed swipe + late + early) ≥ 8 in a month. Escalation mandatory.',
    ruleType: 'escalation',
    conditions: { totalFlagged: { gte: 8 } },
    actions: { templateType: 'escalation', severity: 'critical', notifyHRDirector: true, disciplinaryRisk: true },
    priority: 12,
    isActive: true,
  },
  {
    name: 'Salary Deduction Notice — LOP Exceeds 3 Days',
    description: 'When calculated LOP exceeds 3 working days, employee must receive official deduction notice per UAE WPS requirements.',
    ruleType: 'lop_threshold',
    conditions: { lopDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', includeLopDetails: true, wpsNotice: true },
    priority: 13,
    isActive: true,
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
