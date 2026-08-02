import test from 'node:test';
import assert from 'node:assert/strict';
import { ParsedRecord } from '../services/excelParser';
import { buildEmployeeNameCollisionGroups, collectExcelEmployees } from '../services/employeeExcelImportService';

function record(overrides: Partial<ParsedRecord>): ParsedRecord {
  return {
    employeeNumber: '', biometricId: '', employeeName: 'Asha Shah', email: '',
    organisation: '', entity: '', department: '', designation: '', shift: '',
    recordDate: '2026-08-01', status: 'Normal', timeIn: '09:00', timeOut: '18:00', workingHours: 9,
    ...overrides,
  };
}

test('collects one Employee Master candidate from many attendance days', () => {
  const result = collectExcelEmployees([
    record({ employeeNumber: 'EMP-001', recordDate: '2026-08-01' }),
    record({ employeeNumber: 'EMP-001', recordDate: '2026-08-02', department: 'Finance' }),
  ]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].employeeNumber, 'EMP-001');
  assert.equal(result.candidates[0].department, 'Finance');
});

test('uses the biometric ID when Employee Number is missing', () => {
  const result = collectExcelEmployees([record({ biometricId: 'BIO-44' })]);
  assert.equal(result.candidates[0].employeeNumber, 'BIO-44');
});

test('creates a stable generated Employee Number when the sheet only has a name', () => {
  const first = collectExcelEmployees([record({})]).candidates[0].employeeNumber;
  const second = collectExcelEmployees([record({ recordDate: '2026-08-12' })]).candidates[0].employeeNumber;
  assert.match(first, /^XLS-[A-F0-9]{12}$/);
  assert.equal(first, second);
});

test('keeps identical names with different Employee Numbers as separate employees', () => {
  const result = collectExcelEmployees([
    record({ employeeNumber: 'EMP-010' }),
    record({ employeeNumber: 'EMP-011', recordDate: '2026-08-02' }),
  ]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual([...result.identifiersByName.get('asha shah') || []], ['EMP-010', 'EMP-011']);
});

test('requires acknowledgement for active employees sharing a normalized name', () => {
  const groups = buildEmployeeNameCollisionGroups([
    { id: 1, employee_number: '24', name: 'Komal  Nagarare', status: 'Active', same_name_collision_confirmed_at: null },
    { id: 2, employee_number: '163', name: 'komal nagarare', status: 'Active', same_name_collision_confirmed_at: '2026-08-02T00:00:00Z' },
    { id: 3, employee_number: '999', name: 'Komal Nagarare', status: 'Inactive', same_name_collision_confirmed_at: null },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'komal nagarare');
  assert.equal(groups[0].acknowledged, false);
  assert.deepEqual(groups[0].employees.map(employee => employee.employeeNumber), ['24', '163']);
});

test('remembers a fully acknowledged same-name employee group', () => {
  const groups = buildEmployeeNameCollisionGroups([
    { id: 1, employee_number: '226', name: 'Gaurav', status: 'Active', same_name_collision_confirmed_at: '2026-08-02T00:00:00Z' },
    { id: 2, employee_number: '293', name: 'gaurav', status: 'Active', same_name_collision_confirmed_at: '2026-08-02T00:01:00Z' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].acknowledged, true);
});
