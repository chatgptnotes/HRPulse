import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationEnvelope } from '../services/connectorService';
import { sha256 } from '../middleware/auth';
import { buildEmployeeDetail, computeEmployeePayroll, DEFAULT_PAYROLL_SETTINGS } from '../services/payrollService';
import { duplicatesBuiltInPayrollPolicy, evaluatePayrollSalaryRules, type SalaryRule } from '../services/salaryRules';

test('integration envelopes retain caller idempotency identifiers', () => {
  const envelope = integrationEnvelope({
    eventUuid: '00000000-0000-4000-8000-000000000001',
    eventType: 'attendance.daily.upserted',
    entityUuid: '00000000-0000-4000-8000-000000000002',
    organizationId: '00000000-0000-4000-8000-000000000003',
    data: { sourceRecordId: 'ATT-1' },
  });
  assert.equal(envelope.event_uuid, '00000000-0000-4000-8000-000000000001');
  assert.equal(envelope.entity_uuid, '00000000-0000-4000-8000-000000000002');
  assert.equal(envelope.event_version, 1);
  assert.equal(envelope.source_system, 'hrpulse');
  assert.equal(envelope.destination_system, 'hims');
});

test('connector credentials are represented by deterministic SHA-256 hashes', () => {
  assert.equal(
    sha256('hrpulse-test-token'),
    'd1e05585b6813dd9dd33771de9dcdb803471709fba37d0b6556fa4c697e46773',
  );
  assert.notEqual(sha256('hrpulse-test-token'), 'hrpulse-test-token');
});

const employee = {
  id: 1,
  employee_number: 'EMP-1',
  name: 'Test Employee',
  department: 'IT',
  overtime_eligible: false,
  paid_leaves_eligible: true,
};

test('eligible employees automatically receive paid leave on their first absence', () => {
  const result = computeEmployeePayroll(
    employee,
    [{ recordDate: '2026-07-01', status: 'Absent', timeIn: null, timeOut: null }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.absentDeduction, 0);
  assert.equal(result.paidLeave, 1);
  assert.equal(result.paidLeaveRemaining, 1);
});

test('an approved paid half day covers only half of an otherwise absent day', () => {
  const result = computeEmployeePayroll(
    employee,
    [{
      recordDate: '2026-07-02',
      status: 'Absent',
      timeIn: null,
      timeOut: null,
      approvedLeaveFraction: 0.5,
      approvedLeavePaid: true,
    }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 0.5);
  assert.equal(result.absentDays, 0.5);
  assert.equal(result.absentDeduction, 500);
});

test('approved leave is unpaid when Employee Master says Paid Leaves: No', () => {
  const result = computeEmployeePayroll(
    { ...employee, paid_leaves_eligible: false },
    [{
      recordDate: '2026-07-03', status: 'Absent', timeIn: null, timeOut: null,
      approvedLeaveFraction: 1, approvedLeavePaid: true,
    }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 0);
  assert.equal(result.unpaidApprovedLeave, 1);
  assert.equal(result.absentDeduction, 1000);
  assert.equal(result.paidLeaveEligible, false);
});

test('eligible employees receive only the configured monthly paid-leave limit', () => {
  const result = computeEmployeePayroll(
    employee,
    ['03', '01', '02'].map(day => ({
      recordDate: `2026-07-${day}`, status: 'Absent', timeIn: null, timeOut: null,
      approvedLeaveFraction: 1, approvedLeavePaid: true,
    })),
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 2);
  assert.equal(result.paidLeaveRemaining, 0);
  assert.equal(result.unpaidApprovedLeave, 1);
  assert.equal(result.absentDeduction, 1000);
});

test('half-day leave uses only half a day of the allowance', () => {
  const result = computeEmployeePayroll(
    employee,
    [
      { recordDate: '2026-07-01', status: 'Absent', timeIn: null, timeOut: null, approvedLeaveFraction: 1, approvedLeavePaid: true },
      { recordDate: '2026-07-02', status: 'Present', timeIn: '09:00', timeOut: '12:00', approvedLeaveFraction: 0.5, approvedLeavePaid: true },
      { recordDate: '2026-07-03', status: 'Absent', timeIn: null, timeOut: null, approvedLeaveFraction: 1, approvedLeavePaid: true },
    ],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 2);
  assert.equal(result.unpaidApprovedLeave, 0.5);
  assert.equal(result.absentDeduction, 500);
});

test('an explicitly unpaid approved leave never consumes paid allowance', () => {
  const result = computeEmployeePayroll(
    employee,
    [{
      recordDate: '2026-07-04', status: 'Absent', timeIn: null, timeOut: null,
      approvedLeaveFraction: 1, approvedLeavePaid: false,
    }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 0);
  assert.equal(result.paidLeaveRemaining, 2);
  assert.equal(result.unpaidApprovedLeave, 1);
});

test('approved leave on a holiday does not consume the paid allowance', () => {
  const result = computeEmployeePayroll(
    employee,
    [{
      recordDate: '2026-07-06', status: 'Holiday', timeIn: null, timeOut: null,
      approvedLeaveFraction: 1, approvedLeavePaid: true,
    }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.holidays, 1);
  assert.equal(result.paidLeave, 0);
  assert.equal(result.paidLeaveRemaining, 2);
  assert.equal(result.absentDeduction, 0);
});

test('every non-IT employee receives four paid leaves regardless of the eligibility switch', () => {
  const nonItEmployee = { ...employee, department: 'Reception', paid_leaves_eligible: false };
  const result = computeEmployeePayroll(
    nonItEmployee,
    ['01', '02', '03', '04', '06'].map(day => ({
      recordDate: `2026-07-${day}`, status: 'Absent', timeIn: null, timeOut: null,
    })),
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeaveEligible, true);
  assert.equal(result.paidLeaveLimit, 4);
  assert.equal(result.paidLeave, 4);
  assert.equal(result.paidLeaveRemaining, 0);
  assert.equal(result.absentDays, 1);
  assert.equal(result.absentDeduction, 1000);
});

test('a non-IT Sunday absence uses the four-day paid-leave allowance', () => {
  const nonItEmployee = { ...employee, department: 'Reception', paid_leaves_eligible: false };
  const days = [
    { recordDate: '2026-07-05', status: 'Weekend', timeIn: null, timeOut: null },
    { recordDate: '2026-07-06', status: 'Absent', timeIn: null, timeOut: null },
  ];
  const result = computeEmployeePayroll(
    nonItEmployee,
    days,
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  const detail = buildEmployeeDetail(result, nonItEmployee, days, DEFAULT_PAYROLL_SETTINGS);
  assert.equal(result.weeklyOffs, 0);
  assert.equal(result.paidLeave, 2);
  assert.equal(result.paidLeaveRemaining, 2);
  assert.equal(result.absentDays, 0);
  assert.equal(result.absentDeduction, 0);
  assert.deepEqual(detail.paidLeaveDates, ['2026-07-05', '2026-07-06']);
});

test('a non-IT weekday marked Weekend uses one paid leave day', () => {
  const nonItEmployee = { ...employee, department: 'Reception', paid_leaves_eligible: false };
  const result = computeEmployeePayroll(
    nonItEmployee,
    [{ recordDate: '2026-07-04', status: 'Weekend', timeIn: null, timeOut: null }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.weeklyOffs, 0);
  assert.equal(result.paidLeave, 1);
  assert.equal(result.paidLeaveRemaining, 3);
  assert.equal(result.absentDeduction, 0);
});

test('Nisha Reception gets paid leave for weekday and Sunday absences', () => {
  const nisha = {
    ...employee,
    id: 1647,
    name: 'nisha recep',
    department: 'Reception',
    paid_leaves_eligible: false,
  };
  const lateDates = ['01', '02', '03', '05', '11', '17', '19', '21', '22', '24', '26', '27'];
  const days = [
    ...lateDates.map(day => ({
      recordDate: `2026-07-${day}`, status: 'Late Coming', timeIn: '10:00', timeOut: '18:00',
    })),
    { recordDate: '2026-07-07', status: 'Absent', timeIn: null, timeOut: null },
    { recordDate: '2026-07-12', status: 'Weekend', timeIn: null, timeOut: null },
  ];
  const result = computeEmployeePayroll(nisha, days, 13_000, 2, DEFAULT_PAYROLL_SETTINGS);
  assert.equal(result.paidLeave, 2);
  assert.equal(result.paidLeaveRemaining, 2);
  assert.equal(result.absentDays, 0);
  assert.equal(result.absentDeduction, 0);
  assert.equal(result.lateDays, 12);
  assert.equal(result.lateDeductionDays, 4);
  assert.equal(result.totalDeductions, 2000);
  assert.equal(result.netSalary, 11_000);
});

test('payroll uses the assigned shift plus 30 minutes and deducts every third late day', () => {
  const shiftedEmployee = { ...employee, shift_start_time: '08:30' };
  const result = computeEmployeePayroll(
    shiftedEmployee,
    [
      { recordDate: '2026-07-01', status: 'Normal', timeIn: '09:00', timeOut: '18:00' },
      { recordDate: '2026-07-02', status: 'Normal', timeIn: '09:01', timeOut: '18:00' },
      { recordDate: '2026-07-03', status: 'Normal', timeIn: '09:05', timeOut: '18:00' },
      { recordDate: '2026-07-04', status: 'Late Coming', timeIn: '09:20', timeOut: '18:00' },
    ],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.lateDays, 3);
  assert.equal(result.lateDeductionDays, 1);
  assert.equal(result.totalDeductions, 1_000);
});

test('eligible overtime starts only after more than two hours beyond shift end and pays half a duty day', () => {
  const overtimeEmployee = { ...employee, overtime_eligible: true, shift_end_time: '18:00' };
  const result = computeEmployeePayroll(
    overtimeEmployee,
    [
      { recordDate: '2026-07-01', status: 'Normal', timeIn: '09:00', timeOut: '20:00' },
      { recordDate: '2026-07-02', status: 'Normal', timeIn: '09:00', timeOut: '20:01' },
      { recordDate: '2026-07-03', status: 'Missed Swipe', timeIn: null, timeOut: '21:00' },
      { recordDate: '2026-07-04', status: 'Holiday', timeIn: '09:00', timeOut: '21:00' },
    ],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.overtimeHours, 2);
  assert.equal(result.overtimePay, 500);
  assert.equal(result.missingPunches, 1);
});

test('an overtime-ineligible employee never receives overtime pay', () => {
  const result = computeEmployeePayroll(
    { ...employee, overtime_eligible: false, shift_end_time: '18:00' },
    [{ recordDate: '2026-07-01', status: 'Normal', timeIn: '09:00', timeOut: '21:00' }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.overtimeHours, 0);
  assert.equal(result.overtimePay, 0);
});

test('half day, unpaid absence, missing punch, and the configured working-days divisor apply together', () => {
  const result = computeEmployeePayroll(
    { ...employee, paid_leaves_eligible: false },
    [
      { recordDate: '2026-07-01', status: 'Normal', timeIn: '10:00', timeOut: '13:59' },
      { recordDate: '2026-07-02', status: 'Absent', timeIn: null, timeOut: null },
      { recordDate: '2026-07-03', status: 'Missed Swipe', timeIn: '09:00', timeOut: null },
    ],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.dailySalary, 1_000);
  assert.equal(result.halfDays, 1);
  assert.equal(result.halfDayDeduction, 500);
  assert.equal(result.absentDeduction, 1_000);
  assert.equal(result.missingPunches, 1);
  assert.equal(result.totalDeductions, 1_500);
});

test('Sunday is a weekly off only for IT employees', () => {
  const sunday = [{ recordDate: '2026-07-05', status: 'Absent', timeIn: null, timeOut: null }];
  const itResult = computeEmployeePayroll(
    { ...employee, department: 'IT', paid_leaves_eligible: false },
    sunday,
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  const nonItResult = computeEmployeePayroll(
    { ...employee, department: 'Reception', paid_leaves_eligible: false },
    sunday,
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(itResult.weeklyOffs, 1);
  assert.equal(itResult.absentDeduction, 0);
  assert.equal(nonItResult.weeklyOffs, 0);
  assert.equal(nonItResult.paidLeave, 1);
  assert.equal(nonItResult.absentDeduction, 0);
});

test('attendance overrides overlapping approved leave and does not consume allowance', () => {
  const result = computeEmployeePayroll(
    employee,
    [{
      recordDate: '2026-07-24', status: 'Normal', timeIn: '08:56', timeOut: '18:01',
      approvedLeaveFraction: 1, approvedLeavePaid: true,
    }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.presentDays, 1);
  assert.equal(result.paidLeave, 0);
  assert.equal(result.paidLeaveRemaining, 2);
  assert.equal(result.absentDeduction, 0);
});

test('a third automatic absence is unpaid after the monthly limit is exhausted', () => {
  const result = computeEmployeePayroll(
    employee,
    ['01', '02', '03'].map(day => ({
      recordDate: `2026-07-${day}`, status: 'Absent', timeIn: null, timeOut: null,
    })),
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 2);
  assert.equal(result.absentDays, 1);
  assert.equal(result.unpaidApprovedLeave, 0);
  assert.equal(result.absentDeduction, 1000);
});

test('day 31 is ignored by the fixed 30-day payroll period', () => {
  const result = computeEmployeePayroll(
    employee,
    [{ recordDate: '2026-07-31', status: 'Absent', timeIn: null, timeOut: null }],
    26_000,
    2,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 0);
  assert.equal(result.absentDays, 0);
  assert.equal(result.absentDeduction, 0);
});

test('Palak July attendance uses 21 and 23 as paid leave and keeps 24 and 25 present', () => {
  const palak = { ...employee, id: 275, name: 'Palak Dongare', department: 'IT' };
  const days = [
    { recordDate: '2026-07-21', status: 'Absent', timeIn: null, timeOut: null },
    { recordDate: '2026-07-23', status: 'Absent', timeIn: null, timeOut: null, approvedLeaveFraction: 1, approvedLeavePaid: true },
    { recordDate: '2026-07-24', status: 'Normal', timeIn: '08:56', timeOut: '18:01', approvedLeaveFraction: 1, approvedLeavePaid: true },
    { recordDate: '2026-07-25', status: 'Normal', timeIn: '09:17', timeOut: '18:32', approvedLeaveFraction: 1, approvedLeavePaid: true },
    { recordDate: '2026-07-26', status: 'Weekend', timeIn: null, timeOut: null, approvedLeaveFraction: 1, approvedLeavePaid: true },
    { recordDate: '2026-07-31', status: 'Absent', timeIn: null, timeOut: null },
  ];
  const row = computeEmployeePayroll(palak, days, 13_000, 2, DEFAULT_PAYROLL_SETTINGS);
  const detail = buildEmployeeDetail(row, palak, days, DEFAULT_PAYROLL_SETTINGS);
  assert.equal(row.paidLeave, 2);
  assert.equal(row.presentDays, 2);
  assert.equal(row.weeklyOffs, 1);
  assert.equal(row.absentDays, 0);
  assert.equal(row.absentDeduction, 0);
  assert.deepEqual(detail.paidLeaveDates, ['2026-07-21', '2026-07-23']);
  assert.deepEqual(detail.unpaidAbsenceDates, []);
  assert.equal(detail.days.find(day => day.date === '2026-07-21')?.classification, 'paid_leave');
  assert.equal(detail.days.find(day => day.date === '2026-07-24')?.classification, 'present');
  assert.equal(detail.days.some(day => day.date === '2026-07-31'), false);
});

const salaryRule = (overrides: Partial<SalaryRule>): SalaryRule => ({
  id: 1,
  name: 'Test salary rule',
  department: null,
  shift: null,
  conditions: {},
  deductDays: 0,
  deductAmount: 0,
  deductPercent: 0,
  allowanceAmount: 0,
  allowancePercent: 0,
  overtimeHalfDayAllowance: false,
  repeat: false,
  priority: 1,
  ...overrides,
});

test('custom every-three-lates deduction is excluded because core payroll already applies it', () => {
  assert.equal(duplicatesBuiltInPayrollPolicy(salaryRule({
    conditions: { lateComingDays: { gte: 3 } },
    deductDays: 1,
    repeat: true,
  })), true);
});

test('custom half-day overtime allowance is excluded because core payroll already applies it', () => {
  assert.equal(duplicatesBuiltInPayrollPolicy(salaryRule({
    conditions: { overtimeDays: { gte: 1 } },
    overtimeHalfDayAllowance: true,
    repeat: true,
  })), true);
});

test('a distinct custom salary rule remains available', () => {
  assert.equal(duplicatesBuiltInPayrollPolicy(salaryRule({
    conditions: { absentDays: { gte: 2 } },
    deductAmount: 250,
  })), false);
});

test('a duplicate late rule stays visible but adds no second deduction', () => {
  const result = evaluatePayrollSalaryRules(
    {
      absentDays: 0,
      lateComingDays: 6,
      missedSwipeDays: 0,
      earlyLeavingDays: 0,
      halfDays: 0,
      overtimeDays: 0,
      overtimeHours: 0,
      totalFlagged: 6,
    },
    null,
    null,
    [salaryRule({
      id: 32,
      name: 'every 3 late arrivals deduct 1 day',
      conditions: { lateComingDays: { gte: 3 } },
      deductDays: 1,
      repeat: true,
    })],
    13_000,
    500,
  );
  assert.equal(result.deductionAmount, 0);
  assert.equal(result.deductDays, 0);
  assert.equal(result.matchedRules.length, 1);
  assert.equal(result.matchedRules[0].policyDeductionAmount, 1000);
  assert.equal(result.matchedRules[0].deductionAmount, 0);
  assert.equal(result.matchedRules[0].repeatCount, 2);
  assert.match(result.matchedRules[0].reason || '', /No extra amount is applied/);
});