import { createHash } from 'crypto';
import { supabase } from '../db/supabase';
import { ParsedRecord } from './excelParser';
import { LATE_GRACE_MINUTES } from './latePolicy';

export interface ExcelEmployeeCandidate {
  key: string;
  employeeNumber: string;
  biometricId: string;
  name: string;
  email: string;
  organisation: string;
  entity: string;
  department: string;
  designation: string;
  shift: string;
}

export interface EmployeeNameCollisionGroup {
  key: string;
  displayName: string;
  acknowledged: boolean;
  employees: Array<{
    id: number;
    employeeNumber: string;
    name: string;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
  }>;
}

function normalizedNumber(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

export function normalizedEmployeeName(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
}

function generatedEmployeeNumber(name: string) {
  const digest = createHash('sha256').update(normalizedEmployeeName(name)).digest('hex').slice(0, 12).toUpperCase();
  return `XLS-${digest}`;
}

function candidateNumber(record: ParsedRecord) {
  return String(record.employeeNumber || record.biometricId || '').trim();
}

function recordKey(record: ParsedRecord, identifiersByName: Map<string, Set<string>>) {
  const supplied = candidateNumber(record);
  if (supplied) return `number:${normalizedNumber(supplied)}`;
  const nameKey = normalizedEmployeeName(record.employeeName);
  const identifiers = identifiersByName.get(nameKey);
  if (identifiers?.size === 1) return `number:${[...identifiers][0]}`;
  return `number:${normalizedNumber(generatedEmployeeNumber(record.employeeName))}`;
}

export function collectExcelEmployees(records: ParsedRecord[]) {
  const warnings: string[] = [];
  const identifiersByName = new Map<string, Set<string>>();
  for (const record of records) {
    const nameKey = normalizedEmployeeName(record.employeeName);
    const number = normalizedNumber(candidateNumber(record));
    if (!nameKey || !number) continue;
    const identifiers = identifiersByName.get(nameKey) || new Set<string>();
    identifiers.add(number);
    identifiersByName.set(nameKey, identifiers);
  }

  const candidates = new Map<string, ExcelEmployeeCandidate>();
  for (const record of records) {
    const name = String(record.employeeName || '').trim();
    if (!name) continue;
    const key = recordKey(record, identifiersByName);
    const suppliedNumber = candidateNumber(record);
    const employeeNumber = suppliedNumber || key.slice('number:'.length);
    const incoming: ExcelEmployeeCandidate = {
      key,
      employeeNumber,
      biometricId: String(record.biometricId || '').trim(),
      name,
      email: String(record.email || '').trim().toLowerCase(),
      organisation: String(record.organisation || '').trim(),
      entity: String(record.entity || '').trim(),
      department: String(record.department || '').trim(),
      designation: String(record.designation || '').trim(),
      shift: String(record.shift || '').trim(),
    };
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, incoming);
      continue;
    }
    if (normalizedEmployeeName(existing.name) !== normalizedEmployeeName(incoming.name)) {
      warnings.push(`Employee ${employeeNumber} has different names in the Excel file; "${existing.name}" was retained.`);
    }
    for (const field of ['biometricId', 'email', 'organisation', 'entity', 'department', 'designation', 'shift'] as const) {
      if (!existing[field] && incoming[field]) existing[field] = incoming[field];
    }
  }

  return { candidates: [...candidates.values()], warnings, identifiersByName };
}

export function buildEmployeeNameCollisionGroups(
  employees: any[],
  relevantNames?: Set<string>,
): EmployeeNameCollisionGroup[] {
  const grouped = new Map<string, any[]>();
  for (const employee of employees) {
    if (String(employee.status || 'Active').toLowerCase() === 'inactive' || employee.is_active === false) continue;
    const key = normalizedEmployeeName(employee.name);
    const employeeNumber = normalizedNumber(employee.employee_number);
    if (!key || !employeeNumber || (relevantNames && !relevantNames.has(key))) continue;
    grouped.set(key, [...(grouped.get(key) || []), employee]);
  }

  return [...grouped.entries()]
    .filter(([, rows]) => new Set(rows.map(row => normalizedNumber(row.employee_number))).size > 1)
    .map(([key, rows]) => {
      const members = rows
        .map(row => ({
          id: Number(row.id),
          employeeNumber: String(row.employee_number || '').trim(),
          name: String(row.name || '').trim(),
          acknowledgedAt: row.same_name_collision_confirmed_at || null,
          acknowledgedBy: row.same_name_collision_confirmed_by || null,
        }))
        .sort((left, right) => left.employeeNumber.localeCompare(right.employeeNumber, undefined, { numeric: true }));
      return {
        key,
        displayName: members[0]?.name || key,
        acknowledged: members.every(member => Boolean(member.acknowledgedAt)),
        employees: members,
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function generatedEmail(candidate: ExcelEmployeeCandidate) {
  const slug = candidate.employeeNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee';
  const digest = createHash('sha256').update(candidate.key).digest('hex').slice(0, 8);
  return `${slug}-${digest}@attendance.hrpulse.local`;
}

async function fetchEmployees() {
  const employees: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from('employees').select('*').range(offset, offset + 999);
    if (error) throw new Error(error.message);
    employees.push(...(data || []));
    if (!data || data.length < 1000) break;
    offset += 1000;
  }
  return employees;
}

export async function syncEmployeesFromExcel(records: ParsedRecord[]) {
  const collected = collectExcelEmployees(records);
  const existingEmployees = await fetchEmployees();
  const byNumber = new Map<string, any>();
  const byName = new Map<string, any[]>();
  const emailOwner = new Map<string, number>();
  for (const employee of existingEmployees) {
    const number = normalizedNumber(employee.employee_number);
    if (number) byNumber.set(number, employee);
    const name = normalizedEmployeeName(employee.name);
    if (name) byName.set(name, [...(byName.get(name) || []), employee]);
    if (employee.email) emailOwner.set(String(employee.email).trim().toLowerCase(), Number(employee.id));
  }

  const matchedByKey = new Map<string, { id: number; shift_start_time?: string | null }>();
  let createdCount = 0;
  let matchedExistingCount = 0;

  const reservedEmails = new Set(emailOwner.keys());
  const plans = collected.candidates.map(candidate => {
    const nameMatches = byName.get(normalizedEmployeeName(candidate.name)) || [];
    const numberMatch = byNumber.get(normalizedNumber(candidate.employeeNumber));
    const uniqueNameMatch = nameMatches.length === 1 ? nameMatches[0] : null;
    const nameMatchNumber = normalizedNumber(uniqueNameMatch?.employee_number);
    const generatedNumber = candidate.employeeNumber.startsWith('XLS-');
    const existing = numberMatch || (
      uniqueNameMatch && (!nameMatchNumber || generatedNumber) ? uniqueNameMatch : null
    );
    const requestedEmail = candidate.email;
    const requestedEmailOwner = requestedEmail ? emailOwner.get(requestedEmail) : undefined;

    let email = requestedEmail;
    if (!existing && (!email || reservedEmails.has(email))) {
      if (email && reservedEmails.has(email)) collected.warnings.push(`Email ${email} is duplicated; a local placeholder was used for ${candidate.name}.`);
      email = generatedEmail(candidate);
    }
    if (!existing) reservedEmails.add(email);
    return { candidate, existing, requestedEmail, requestedEmailOwner, email };
  });

  async function saveCandidate(plan: typeof plans[number]) {
    const { candidate, existing, requestedEmail, requestedEmailOwner, email } = plan;

    if (existing) {
      const update: Record<string, unknown> = {};
      if (String(existing.name || '').trim() !== candidate.name) update.name = candidate.name;
      if (!existing.employee_number) update.employee_number = candidate.employeeNumber;
      const identityChanged = normalizedEmployeeName(existing.name) !== normalizedEmployeeName(candidate.name)
        || normalizedNumber(existing.employee_number) !== normalizedNumber(candidate.employeeNumber);
      if (identityChanged && Object.prototype.hasOwnProperty.call(existing, 'same_name_collision_confirmed_at')) {
        update.same_name_collision_confirmed_at = null;
        update.same_name_collision_confirmed_by = null;
      }
      if (candidate.biometricId && String(existing.biometric_id || '').trim() !== candidate.biometricId) update.biometric_id = candidate.biometricId;
      if (candidate.organisation && String(existing.organisation || '').trim() !== candidate.organisation) update.organisation = candidate.organisation;
      if (candidate.entity && String(existing.entity || '').trim() !== candidate.entity) update.entity = candidate.entity;
      if (candidate.department && String(existing.department || '').trim() !== candidate.department) update.department = candidate.department;
      if (candidate.designation && String(existing.designation || '').trim() !== candidate.designation) update.designation = candidate.designation;
      if (candidate.shift && String(existing.shift || '').trim() !== candidate.shift) update.shift = candidate.shift;
      if (requestedEmail && (requestedEmailOwner == null || requestedEmailOwner === Number(existing.id))
        && String(existing.email || '').trim().toLowerCase() !== requestedEmail) update.email = requestedEmail;
      else if (requestedEmail && requestedEmailOwner !== Number(existing.id)) {
        collected.warnings.push(`Email ${requestedEmail} already belongs to another employee and was not copied to ${candidate.name}.`);
      }
      if (!Object.keys(update).length) {
        matchedByKey.set(candidate.key, { id: Number(existing.id), shift_start_time: existing.shift_start_time || null });
        matchedExistingCount++;
        return;
      }
      const { data, error } = await supabase.from('employees').update(update).eq('id', existing.id).select('*').single();
      if (error) throw new Error(`Could not update employee ${candidate.name}: ${error.message}`);
      const saved = data || existing;
      matchedByKey.set(candidate.key, { id: Number(saved.id), shift_start_time: saved.shift_start_time || null });
      matchedExistingCount++;
      return;
    }

    const payload = {
      employee_number: candidate.employeeNumber,
      biometric_id: candidate.biometricId || null,
      name: candidate.name,
      email,
      organisation: candidate.organisation || null,
      entity: candidate.entity || null,
      department: candidate.department || null,
      designation: candidate.designation || null,
      shift: candidate.shift || null,
      status: 'Active',
    };
    let result = await supabase.from('employees').insert(payload).select('*').single();
    if (result.error?.code === '23514' && /employees_active_schedule_check/i.test(result.error.message || '')) {
      result = await supabase.from('employees').insert({
        ...payload,
        is_active: true,
        shift_name: candidate.shift || 'General Shift',
        shift_start_time: '09:00',
        shift_end_time: '18:00',
        late_grace_minutes: LATE_GRACE_MINUTES,
      }).select('*').single();
    }
    if (result.error) throw new Error(`Could not create employee ${candidate.name}: ${result.error.message}`);
    const data = result.data;
    matchedByKey.set(candidate.key, { id: Number(data.id), shift_start_time: data.shift_start_time || null });
    createdCount++;
  }

  // Keep database pressure bounded while avoiding one round trip per employee.
  for (let offset = 0; offset < plans.length; offset += 10) {
    await Promise.all(plans.slice(offset, offset + 10).map(saveCandidate));
  }

  const relevantCollisionNames = new Set(
    [...collected.identifiersByName.entries()]
      .filter(([, identifiers]) => identifiers.size > 1)
      .map(([name]) => name),
  );
  const nameCollisionGroups = relevantCollisionNames.size
    ? buildEmployeeNameCollisionGroups(await fetchEmployees(), relevantCollisionNames)
    : [];

  return {
    createdCount,
    matchedExistingCount,
    warnings: collected.warnings,
    nameCollisionGroups,
    find(record: ParsedRecord) {
      return matchedByKey.get(recordKey(record, collected.identifiersByName)) || null;
    },
  };
}
