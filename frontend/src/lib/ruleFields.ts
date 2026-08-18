/**
 * Rules Engine — field catalog, operators and action metadata.
 *
 * Shared by the Visual Rule Builder, the AI generator preview, the testing
 * sandbox and the evaluator. Everything the UI needs to render a no-code
 * condition/action row lives here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// OPERATORS
// ─────────────────────────────────────────────────────────────────────────────

export const OPERATORS = [
  { value: 'eq', label: 'Equal To', short: '=' },
  { value: 'ne', label: 'Not Equal To', short: '≠' },
  { value: 'gt', label: 'Greater Than', short: '>' },
  { value: 'lt', label: 'Less Than', short: '<' },
  { value: 'gte', label: 'Greater Than or Equal', short: '≥' },
  { value: 'lte', label: 'Less Than or Equal', short: '≤' },
  { value: 'contains', label: 'Contains', short: 'contains' },
  { value: 'notContains', label: 'Does Not Contain', short: '!contains' },
  { value: 'startsWith', label: 'Starts With', short: 'starts' },
  { value: 'endsWith', label: 'Ends With', short: 'ends' },
  { value: 'in', label: 'In List', short: 'in' },
  { value: 'notIn', label: 'Not In List', short: 'not in' },
  { value: 'between', label: 'Between Range', short: 'between' },
] as const;

export type Operator = (typeof OPERATORS)[number]['value'];

export const operatorLabel = (op: string) =>
  OPERATORS.find((o) => o.value === op)?.label ?? op;

// Numeric comparison operators — value input renders a number box for these.
const NUMERIC_OPS = new Set(['gt', 'lt', 'gte', 'lte']);

// ─────────────────────────────────────────────────────────────────────────────
// VALUE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const VALUE_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'True/False' },
  { value: 'date', label: 'Date' },
  { value: 'list', label: 'List' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION FIELD CATALOG (grouped, dot-notation paths into the context)
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldDef {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  group: string;
  options?: string[];
  hint?: string;
}

export const CONDITION_FIELDS: FieldDef[] = [
  // Employee
  { path: 'employee.name', label: 'Employee Name', type: 'string', group: 'Employee' },
  { path: 'employee.designation', label: 'Designation', type: 'string', group: 'Employee' },
  { path: 'employee.department', label: 'Department', type: 'string', group: 'Employee' },
  { path: 'employee.organisation', label: 'Organisation', type: 'string', group: 'Employee' },
  { path: 'employee.branch', label: 'Branch', type: 'string', group: 'Employee' },
  { path: 'employee.status', label: 'Employment Status', type: 'string', group: 'Employee', options: ['Active', 'Inactive'] },
  { path: 'employee.shiftName', label: 'Shift Name', type: 'string', group: 'Employee' },
  { path: 'employee.monthlySalary', label: 'Monthly Salary (₹)', type: 'number', group: 'Employee' },
  { path: 'employee.joiningDate', label: 'Joining Date', type: 'date', group: 'Employee' },

  // Attendance — per day
  { path: 'attendance.workingHours', label: 'Working Hours (day)', type: 'number', group: 'Attendance' },
  { path: 'attendance.status', label: 'Attendance Status', type: 'string', group: 'Attendance', options: ['Normal', 'Half Day', 'Late Coming', 'Early Leaving', 'Absent', 'Missed Swipe', 'Weekend', 'Holiday', 'Paid Leave', 'Official'] },
  { path: 'attendance.dayOfWeek', label: 'Day of Week', type: 'string', group: 'Attendance', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
  { path: 'attendance.isWeekend', label: 'Is Weekend', type: 'boolean', group: 'Attendance' },
  { path: 'attendance.isHoliday', label: 'Is Holiday', type: 'boolean', group: 'Attendance' },
  { path: 'attendance.lateMinutes', label: 'Late Minutes', type: 'number', group: 'Attendance' },
  { path: 'attendance.earlyMinutes', label: 'Early Leaving Minutes', type: 'number', group: 'Attendance' },
  { path: 'attendance.overtimeHours', label: 'Overtime Hours (day)', type: 'number', group: 'Attendance' },

  // Attendance — month aggregates
  { path: 'attendance.lateCount', label: 'Late Count (month)', type: 'number', group: 'Attendance (Monthly)' },
  { path: 'attendance.absentDays', label: 'Absent Days (month)', type: 'number', group: 'Attendance (Monthly)' },
  { path: 'attendance.missedSwipeCount', label: 'Missed Swipes (month)', type: 'number', group: 'Attendance (Monthly)' },
  { path: 'attendance.halfDays', label: 'Half Days (month)', type: 'number', group: 'Attendance (Monthly)' },
  { path: 'attendance.presentDays', label: 'Present Days (month)', type: 'number', group: 'Attendance (Monthly)' },
  { path: 'attendance.totalFlagged', label: 'Total Flagged Records (month)', type: 'number', group: 'Attendance (Monthly)' },

  // Payroll
  { path: 'payroll.basicSalary', label: 'Basic Salary (₹)', type: 'number', group: 'Payroll' },
  { path: 'payroll.grossSalary', label: 'Gross Salary (₹)', type: 'number', group: 'Payroll' },
  { path: 'payroll.netSalary', label: 'Net Salary (₹)', type: 'number', group: 'Payroll' },
  { path: 'payroll.deductions', label: 'Total Deductions (₹)', type: 'number', group: 'Payroll' },
  { path: 'payroll.lostPayDays', label: 'Loss of Pay Days', type: 'number', group: 'Payroll' },
  { path: 'payroll.period', label: 'Payroll Period (yyyy-MM)', type: 'string', group: 'Payroll' },

  // Leave
  { path: 'leave.balance', label: 'Leave Balance', type: 'number', group: 'Leave' },
  { path: 'leave.takenThisMonth', label: 'Leave Taken (month)', type: 'number', group: 'Leave' },
  { path: 'leave.pendingRequests', label: 'Pending Leave Requests', type: 'number', group: 'Leave' },
  { path: 'leave.type', label: 'Leave Type', type: 'string', group: 'Leave', options: ['Casual', 'Sick', 'Earned', 'Unpaid'] },
];

export const FIELD_GROUPS = [...new Set(CONDITION_FIELDS.map((f) => f.group))];

export const fieldDef = (path: string) => CONDITION_FIELDS.find((f) => f.path === path);

/** The input type a value editor should render for a field + operator combo. */
export function valueInputKind(fieldPath: string, op: string, valueType: string): 'number' | 'boolean' | 'date' | 'text' | 'list' {
  if (op === 'in' || op === 'notIn') return 'list';
  if (op === 'between') return 'list';
  if (valueType === 'number' || valueType === 'boolean' || valueType === 'date') return valueType as any;
  const def = fieldDef(fieldPath);
  if (def && NUMERIC_OPS.has(op) && def.type === 'number') return 'number';
  return 'text';
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_TYPES = [
  { value: 'set', label: 'Set Field To Value', icon: 'edit', description: 'Assign a value to a field' },
  { value: 'add', label: 'Add To Field', icon: 'add_circle', description: 'Increase a numeric field' },
  { value: 'subtract', label: 'Subtract From Field', icon: 'remove_circle', description: 'Decrease a numeric field (e.g. salary deduction)' },
  { value: 'multiply', label: 'Multiply Field', icon: 'close', description: 'Multiply a numeric field' },
  { value: 'divide', label: 'Divide Field', icon: 'percent', description: 'Divide a numeric field' },
  { value: 'calculate', label: 'Calculate Formula', icon: 'functions', description: 'Evaluate a formula like {attendance.overtimeHours} * 2' },
  { value: 'sendNotification', label: 'Send Notification', icon: 'notifications', description: 'Trigger a notification' },
  { value: 'approve', label: 'Approve Entity', icon: 'check_circle', description: 'Approve the entity being evaluated' },
  { value: 'reject', label: 'Reject Entity', icon: 'cancel', description: 'Reject the entity being evaluated' },
  { value: 'validate', label: 'Validate / Flag', icon: 'rule', description: 'Flag the entity for review' },
] as const;

export type ActionTypeValue = (typeof ACTION_TYPES)[number]['value'];
export const actionTypeMeta = (t: string) => ACTION_TYPES.find((a) => a.value === t);

export const ACTION_TARGET_FIELDS = [
  'attendance.status',
  'attendance.flag',
  'salary.deductions',
  'salary.overtimeMultiplier',
  'salary.bonus',
  'salary.allowance',
  'payroll.netSalary',
  'payroll.deductions',
  'leave.balance',
  'employee.riskLevel',
];

export const NOTIFICATION_RECIPIENTS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Reporting Manager' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'hr_director', label: 'HR Director' },
  { value: 'payroll_team', label: 'Payroll Team' },
  { value: 'admin', label: 'System Administrator' },
];

// ─────────────────────────────────────────────────────────────────────────────
// RULE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export const RULE_TYPES = [
  { value: 'attendance', label: 'Attendance', color: 'bg-blue-100 text-blue-700' },
  { value: 'payroll', label: 'Payroll', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'leave', label: 'Leave', color: 'bg-purple-100 text-purple-700' },
  { value: 'hr', label: 'HR', color: 'bg-pink-100 text-pink-700' },
  { value: 'hospital', label: 'Hospital', color: 'bg-red-100 text-red-700' },
  { value: 'incentive', label: 'Incentive', color: 'bg-amber-100 text-amber-700' },
  { value: 'notification', label: 'Notification', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'compliance', label: 'Compliance', color: 'bg-teal-100 text-teal-700' },
  { value: 'custom', label: 'Custom', color: 'bg-slate-100 text-slate-700' },
] as const;

export const ruleTypeMeta = (t: string) => RULE_TYPES.find((r) => r.value === t) ?? RULE_TYPES[RULE_TYPES.length - 1];

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL EXAMPLES (shown as one-click templates in the builder)
// ─────────────────────────────────────────────────────────────────────────────

export interface BuilderCondition {
  key: string;
  logicalOperator: 'AND' | 'OR' | null;
  field: string;
  operator: Operator;
  value: string;
  valueType: 'string' | 'number' | 'boolean' | 'date' | 'list';
}

export interface BuilderAction {
  key: string;
  actionType: ActionTypeValue;
  targetField?: string;
  value?: string;
  amount?: number;
  percent?: number;
  formula?: string;
  notificationTemplate?: string;
  notificationRecipients?: string;
}

export const RULE_TEMPLATES: Array<{
  name: string;
  description: string;
  ruleType: string;
  priority: number;
  conditions: Omit<BuilderCondition, 'key'>[];
  actions: Omit<BuilderAction, 'key'>[];
}> = [
  {
    name: 'Half Day — Working Hours Below 4',
    description: 'IF Working Hours < 4 THEN Mark Attendance = Half Day',
    ruleType: 'attendance', priority: 30,
    conditions: [{ logicalOperator: null, field: 'attendance.workingHours', operator: 'lt', value: '4', valueType: 'number' }],
    actions: [{ actionType: 'set', targetField: 'attendance.status', value: 'Half Day' }],
  },
  {
    name: 'Late Arrival — ₹500 Salary Deduction',
    description: 'IF Late Count > 3 THEN Salary Deduction = ₹500',
    ruleType: 'payroll', priority: 20,
    conditions: [{ logicalOperator: null, field: 'attendance.lateCount', operator: 'gt', value: '3', valueType: 'number' }],
    actions: [{ actionType: 'subtract', targetField: 'salary.deductions', amount: 500 }],
  },
  {
    name: 'Sunday Overtime — 2x Multiplier',
    description: 'IF Day = Sunday AND Overtime > 0 THEN Overtime Multiplier = 2',
    ruleType: 'payroll', priority: 25,
    conditions: [
      { logicalOperator: null, field: 'attendance.dayOfWeek', operator: 'eq', value: 'Sunday', valueType: 'string' },
      { logicalOperator: 'AND', field: 'attendance.overtimeHours', operator: 'gt', value: '0', valueType: 'number' },
    ],
    actions: [{ actionType: 'set', targetField: 'salary.overtimeMultiplier', value: '2' }],
  },
  {
    name: 'Low Leave Balance — Notify',
    description: 'IF Leave Balance <= 2 THEN Send Notification',
    ruleType: 'notification', priority: 10,
    conditions: [{ logicalOperator: null, field: 'leave.balance', operator: 'lte', value: '2', valueType: 'number' }],
    actions: [{ actionType: 'sendNotification', notificationTemplate: 'low_leave_balance', notificationRecipients: '["employee","hr_manager"]' }],
  },
  {
    name: 'Repeated Absence — Escalate',
    description: 'IF Absent Days >= 3 THEN escalate to HR Director',
    ruleType: 'attendance', priority: 40,
    conditions: [{ logicalOperator: null, field: 'attendance.absentDays', operator: 'gte', value: '3', valueType: 'number' }],
    actions: [{ actionType: 'sendNotification', notificationTemplate: 'escalation', notificationRecipients: '["hr_director","manager"]' }],
  },
  {
    name: 'Overtime Pay — Formula',
    description: 'IF Overtime Hours > 2 THEN bonus = overtime hours × daily rate',
    ruleType: 'payroll', priority: 15,
    conditions: [{ logicalOperator: null, field: 'attendance.overtimeHours', operator: 'gt', value: '2', valueType: 'number' }],
    actions: [{ actionType: 'calculate', targetField: 'salary.bonus', formula: '{attendance.overtimeHours} * ({payroll.basicSalary} / 30)' }],
  },
];