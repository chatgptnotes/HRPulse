import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationEnvelope } from '../services/connectorService';
import { sha256 } from '../middleware/auth';
import { computeEmployeePayroll, DEFAULT_PAYROLL_SETTINGS } from '../services/payrollService';

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
  department: 'Nursing',
  overtime_eligible: false,
};

test('only approved paid leave prevents an absence deduction', () => {
  const absent = computeEmployeePayroll(
    employee,
    [{ recordDate: '2026-07-01', status: 'Absent', timeIn: null, timeOut: null }],
    30_000,
    0,
    DEFAULT_PAYROLL_SETTINGS,
  );
  const approved = computeEmployeePayroll(
    employee,
    [{
      recordDate: '2026-07-01',
      status: 'Absent',
      timeIn: null,
      timeOut: null,
      approvedLeaveFraction: 1,
      approvedLeavePaid: true,
    }],
    30_000,
    0,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(absent.absentDeduction, 1000);
  assert.equal(approved.absentDeduction, 0);
  assert.equal(approved.paidLeave, 1);
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
    30_000,
    0,
    DEFAULT_PAYROLL_SETTINGS,
  );
  assert.equal(result.paidLeave, 0.5);
  assert.equal(result.absentDays, 0.5);
  assert.equal(result.absentDeduction, 500);
});
