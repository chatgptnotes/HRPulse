import { supabase } from './supabase';

const DEFAULT_SETTINGS: [string, string][] = [
  ['smtp_host', process.env.SMTP_HOST || ''],
  ['smtp_port', process.env.SMTP_PORT || '587'],
  ['smtp_secure', 'false'],
  ['smtp_user', process.env.SMTP_USER || ''],
  ['smtp_pass', process.env.SMTP_PASS || ''],
  ['ollama_url', process.env.OLLAMA_URL || 'http://localhost:11434'],
  ['ollama_model', process.env.OLLAMA_MODEL || 'llama3.2:3b'],
  ['company_name', process.env.COMPANY_NAME || 'Your Company'],
  ['hr_name', process.env.HR_NAME || 'HR Department'],
  ['working_days', '30'],
  ['missed_swipe_weight', '0.5'],
  ['standard_working_hours', '9'],
  ['half_day_hours', '4'],
  ['late_grace_minutes', '30'],
  ['shift_start', '09:00'],
  ['ot_threshold_hours', '2'],
  ['ot_multiplier', '1.5'],
  ['late_penalty_days', '0'],
  ['late_days_per_deduction', '3'],
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
- Grace period: 30 minutes after the employee's assigned shift start

### Late Coming
- More than 30 minutes after shift start = Late Coming
- Every 3 late comings in a month = 1 full duty day deduction
- 3-5 late days = 1 day, 6-8 = 2 days, and 9-11 = 3 days

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
    rule_type: 'absence_threshold',
    conditions: { absentDays: { gte: 1 } },
    actions: { templateType: 'initial', severity: 'notice', lopMultiplier: 1 },
    priority: 1,
    is_active: true,
  },
  {
    name: 'Repeated Absence — Formal Warning (3+ Days)',
    description: 'Three or more absent days in a month requires a formal written warning under Article 78 of Federal Law No. 11.',
    rule_type: 'absence_threshold',
    conditions: { absentDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', lopMultiplier: 1, notifyManager: true },
    priority: 2,
    is_active: true,
  },
  {
    name: 'Critical Absence — Escalation to HR Director (5+ Days)',
    description: 'Five or more absent days in a month: disciplinary committee referral risk. Escalation mandatory per Dubai Gov HR circular.',
    rule_type: 'absence_threshold',
    conditions: { absentDays: { gte: 5 } },
    actions: { templateType: 'escalation', severity: 'critical', notifyHRDirector: true, disciplinaryRisk: true },
    priority: 3,
    is_active: true,
  },
  {
    name: 'AWOL — Consecutive Absence (3 Days)',
    description: 'Three or more consecutive absent days = Absence Without Official Leave (AWOL). Triggers formal investigation under Article 79.',
    rule_type: 'absence_threshold',
    conditions: { absentDays: { gte: 3 }, consecutive: true },
    actions: { templateType: 'escalation', severity: 'critical', awol: true, notifyHRDirector: true, initiateInvestigation: true },
    priority: 4,
    is_active: true,
  },

  // ── LATE COMING RULES ──
  {
    name: 'Late Coming — Reminder (1–2 Times)',
    description: 'The grace period is 30 minutes after the assigned shift start. One or two late arrivals trigger a courtesy reminder.',
    rule_type: 'late_coming',
    conditions: { lateComingDays: { gte: 1, lte: 2 } },
    actions: { templateType: 'initial', severity: 'notice', gracePeriodMinutes: 30 },
    priority: 5,
    is_active: true,
  },
  {
    name: 'Late Coming — One-Day Deduction (3–5 Times)',
    description: 'Three to five late arrivals in a month deduct one full duty day.',
    rule_type: 'late_coming',
    conditions: { lateComingDays: { gte: 3, lte: 5 } },
    actions: { templateType: 'reminder', severity: 'warning', notifyManager: true },
    priority: 6,
    is_active: true,
  },
  {
    name: 'Late Coming — Repeated Duty Deduction (6+ Times)',
    description: 'Six or more late arrivals deduct one duty day for every completed group of three late days and trigger a formal warning.',
    rule_type: 'late_coming',
    conditions: { lateComingDays: { gte: 6 } },
    actions: { templateType: 'escalation', severity: 'critical', notifyHRDirector: true, disciplinaryRisk: true },
    priority: 7,
    is_active: true,
  },

  // ── MISSED SWIPE RULES ──
  {
    name: 'Missed Biometric — Initial Notice (1–2 Times)',
    description: 'Failure to register biometric attendance (fingerprint/face scan) = half-day absence per Dubai Smart Government policy.',
    rule_type: 'missed_swipe',
    conditions: { missedSwipeDays: { gte: 1, lte: 2 } },
    actions: { templateType: 'initial', severity: 'notice', lopMultiplier: 0.5 },
    priority: 8,
    is_active: true,
  },
  {
    name: 'Missed Biometric — Formal Warning (3+ Times)',
    description: 'Three or more missed biometric registrations in a month. Repeated pattern may indicate buddy-punching or time fraud.',
    rule_type: 'missed_swipe',
    conditions: { missedSwipeDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', lopMultiplier: 0.5, notifyManager: true, integrityFlag: true },
    priority: 9,
    is_active: true,
  },

  // ── EARLY LEAVING RULES ──
  {
    name: 'Early Leaving — Reminder (1–2 Times)',
    description: 'Leaving before official end time without prior approval. Treated as partial absence.',
    rule_type: 'early_leaving',
    conditions: { earlyLeavingDays: { gte: 1, lte: 2 } },
    actions: { templateType: 'initial', severity: 'notice', lopMultiplier: 0.5 },
    priority: 10,
    is_active: true,
  },
  {
    name: 'Early Leaving — Formal Warning (3+ Times)',
    description: 'Three or more early departures in a month triggers a formal written warning and manager notification.',
    rule_type: 'early_leaving',
    conditions: { earlyLeavingDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', lopMultiplier: 0.5, notifyManager: true },
    priority: 11,
    is_active: true,
  },

  // ── COMBINED / ESCALATION RULES ──
  {
    name: 'Combined Attendance Issues — High Risk',
    description: 'Total flagged incidents (absent + missed swipe + late + early) ≥ 8 in a month. Escalation mandatory.',
    rule_type: 'escalation',
    conditions: { totalFlagged: { gte: 8 } },
    actions: { templateType: 'escalation', severity: 'critical', notifyHRDirector: true, disciplinaryRisk: true },
    priority: 12,
    is_active: true,
  },
  {
    name: 'Salary Deduction Notice — LOP Exceeds 3 Days',
    description: 'When calculated LOP exceeds 3 working days, employee must receive official deduction notice per UAE WPS requirements.',
    rule_type: 'lop_threshold',
    conditions: { lopDays: { gte: 3 } },
    actions: { templateType: 'reminder', severity: 'warning', includeLopDetails: true, wpsNotice: true },
    priority: 13,
    is_active: true,
  },
];

async function seedSettings() {
  for (const [key, value] of DEFAULT_SETTINGS) {
    const { error } = await supabase
      .from('settings')
      .upsert({ key, value }, { onConflict: 'key', ignoreDuplicates: true });
    if (error) console.error(`[seed] settings ${key}:`, error.message);
  }
}

async function seedTemplates() {
  for (const template of DEFAULT_TEMPLATES) {
    const { error } = await supabase
      .from('email_templates')
      .upsert(template, { onConflict: 'type', ignoreDuplicates: true });
    if (error) console.error(`[seed] template ${template.type}:`, error.message);
  }
}

async function seedSops() {
  const { count, error } = await supabase
    .from('sops')
    .select('*', { count: 'exact', head: true });
  if (error) { console.error('[seed] sop count:', error.message); return; }
  if ((count || 0) > 0) return;
  for (const sop of DEFAULT_SOPS) {
    const { error } = await supabase.from('sops').insert(sop);
    if (error) console.error(`[seed] sop ${sop.title}:`, error.message);
  }
}

async function seedRules() {
  const { count, error } = await supabase
    .from('attendance_rules')
    .select('*', { count: 'exact', head: true });
  if (error) { console.error('[seed] rule count:', error.message); return; }
  if ((count || 0) > 0) return;
  for (const rule of DEFAULT_RULES) {
    const { error } = await supabase.from('attendance_rules').insert(rule);
    if (error) console.error(`[seed] rule ${rule.name}:`, error.message);
  }
}

export async function seedDatabase() {
  await seedSettings();
  await seedTemplates();
  await seedSops();
  await seedRules();
}
