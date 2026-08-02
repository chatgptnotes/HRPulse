import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLateAttendanceStatus,
  isLateArrival,
  lateDeductionDays,
  LATE_GRACE_MINUTES,
} from '../services/latePolicy';

test('9:30 is allowed and 9:31 is late for a 9:00 shift', () => {
  assert.equal(LATE_GRACE_MINUTES, 30);
  assert.equal(isLateArrival('Normal', '09:30', '09:00'), false);
  assert.equal(isLateArrival('Normal', '09:31', '09:00'), true);
  assert.equal(classifyLateAttendanceStatus('Normal', '09:30', '09:00'), 'Normal');
  assert.equal(classifyLateAttendanceStatus('Normal', '09:31', '09:00'), 'Late Coming');
});

test('late threshold follows the assigned shift start', () => {
  assert.equal(isLateArrival('Normal', '09:00', '08:30'), false);
  assert.equal(isLateArrival('Normal', '09:01', '08:30'), true);
  assert.equal(isLateArrival('Normal', '10:31', '10:00'), true);
});

test('a conflicting Excel late status is corrected from the punch time', () => {
  assert.equal(classifyLateAttendanceStatus('Late Coming', '09:20', '09:00'), 'Normal');
  assert.equal(classifyLateAttendanceStatus('Late Coming', null, '09:00'), 'Missed Swipe');
});

test('non-working days and a missing punch-in never count as late', () => {
  for (const status of ['Absent', 'Weekend', 'Weekly Off', 'Holiday', 'Paid Leave']) {
    assert.equal(isLateArrival(status, '10:00', '09:00'), false, status);
  }
  assert.equal(isLateArrival('Late Coming', null, '09:00'), false);
});

test('every completed group of three late days deducts one duty day', () => {
  const expected = new Map([[0, 0], [1, 0], [2, 0], [3, 1], [5, 1], [6, 2], [8, 2], [9, 3], [11, 3]]);
  for (const [lateDays, deductionDays] of expected) {
    assert.equal(lateDeductionDays(lateDays), deductionDays, `${lateDays} late days`);
  }
});
