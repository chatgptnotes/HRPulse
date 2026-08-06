import * as XLSX from 'npm:xlsx';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const headerMap: Record<string, string> = {
  'employee number': 'employeeNumber', 'employee no': 'employeeNumber', 'emp no': 'employeeNumber',
  'employee name': 'employeeName', 'emp name': 'employeeName', name: 'employeeName',
  'email address': 'email', email: 'email', 'e-mail': 'email', organisation: 'organisation', organization: 'organisation', entity: 'entity', department: 'department',
  date: 'date', 'date in': 'date', 'attendance date': 'date', type: 'status', 'attendance type': 'status',
  status: 'status', 'time in': 'timeIn', 'in time': 'timeIn', 'punch in': 'timeIn', 'time out': 'timeOut', 'out time': 'timeOut', 'punch out': 'timeOut',
};
const statusMap: Record<string, string> = { normal: 'Normal', weekend: 'Weekend', 'weak end': 'Weekend', holiday: 'Holiday', late: 'Late Coming', 'late coming': 'Late Coming', absent: 'Absent', absence: 'Absent', 'missed swipe': 'Missed Swipe', incomplete: 'Missed Swipe', official: 'Official', 'early leaving': 'Early Leaving', 'early leave': 'Early Leaving', 'casual leave': 'Paid Leave', 'paid leave': 'Paid Leave', 'sick leave': 'Paid Leave', leave: 'Paid Leave' };
const paidLeaveStatuses = new Set(['Paid Leave', 'Casual Leave', 'Sick Leave']);

function response(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function normalizeHeader(value: unknown) { const key = String(value).toLowerCase().trim(); return headerMap[key] || key.replace(/\s+/g, '_'); }
function parseDate(value: unknown): string | null {
  if (typeof value === 'number') { const d = XLSX.SSF.parse_date_code(value); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null; }
  const text = String(value || '').trim();
  const m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` : null;
}
function parseTime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value < 1 ? value * 24 : value;
  const text = String(value).trim().toLowerCase();
  const ampm = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  const clock = text.match(/^(\d{1,2}):?(\d{2})?$/);
  let hours: number;
  let minutes: number;
  if (ampm) {
    hours = Number(ampm[1]) % 12 + (ampm[3] === 'pm' ? 12 : 0);
    minutes = Number(ampm[2] || 0);
  } else if (clock) {
    hours = Number(clock[1]);
    minutes = Number(clock[2] || 0);
  } else return null;
  return hours + minutes / 60;
}
function isItDepartment(department: string) { return /\bit\b|information technology/i.test(department); }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed' });
  const authClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } } });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) return response(401, { error: 'Authentication required' });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return response(400, { error: 'Excel file is required' });

  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  let headerIndex = rows.findIndex(row => row.slice(0, 30).map(String).join(' ').toLowerCase().includes('employee'));
  if (headerIndex < 0) headerIndex = 0;
  const headers = (rows[headerIndex] as unknown[]).map(normalizeHeader);
  const parsed: Array<Record<string, string>> = [];
  const warnings: string[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]; const item: Record<string, string> = {};
    headers.forEach((key, index) => { item[key] = String(row[index] ?? '').trim(); });
    if (!item.employeeName) continue;
    const recordDate = parseDate(item.date);
    if (!recordDate) { warnings.push(`Row ${i + 1}: date could not be read for ${item.employeeName}`); continue; }
    item.recordDate = recordDate;
    item.status = statusMap[item.status?.toLowerCase()] || item.status || 'Normal';
    parsed.push(item);
  }
  if (!parsed.length) return response(400, { error: 'No attendance rows were found', warnings });
  const periodMonth = parsed.map(row => row.recordDate).sort()[0].slice(0, 7);
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const upload = await db.from('attendance_imports').insert({ filename: file.name, period_month: periodMonth, row_count: parsed.length, status: 'processed' }).select('id').single();
  if (upload.error) return response(500, { error: upload.error.message });

  const employees = new Map<string, number>();
  for (const row of parsed) {
    const email = row.email || `${row.employeeNumber || row.employeeName.replace(/\s+/g, '.').toLowerCase()}@unknown.local`;
    const existing = await db.from('employees').select('id,department').eq('email', email).maybeSingle();
    let employeeId = existing.data?.id as number | undefined;
    const department = row.department || existing.data?.department || '';
    const policyCode = isItDepartment(department) ? 'it' : 'non_it';
    const isSunday = new Date(`${row.recordDate}T00:00:00Z`).getUTCDay() === 0;
    if (isSunday && policyCode === 'it' && !paidLeaveStatuses.has(row.status)) row.status = 'Weekend';
    const timeIn = parseTime(row.timeIn);
    const timeOut = parseTime(row.timeOut);
    const workHours = timeIn !== null && timeOut !== null ? Math.max(0, (timeOut < timeIn ? timeOut + 24 : timeOut) - timeIn) : null;
    const deductionDays = row.status === 'Absent' ? 1 : workHours !== null && workHours < 4 ? 0.5 : 0;
    if (!employeeId) {
      const created = await db.from('employees').insert({ employee_number: row.employeeNumber || null, name: row.employeeName, email, organisation: row.organisation || null, entity: row.entity || null, department: department || null }).select('id').single();
      if (created.error) return response(500, { error: created.error.message });
      employeeId = created.data.id;
    } else {
      await db.from('employees').update({ name: row.employeeName, employee_number: row.employeeNumber || null, organisation: row.organisation || null, entity: row.entity || null, department: department || null }).eq('id', employeeId);
    }
    employees.set(email, employeeId);
    const saved = await db.from('attendance_records').upsert({ import_id: upload.data.id, employee_id: employeeId, record_date: row.recordDate, status: row.status, time_in_raw: row.timeIn || null, time_out_raw: row.timeOut || null, work_hours: workHours, deduction_days: deductionDays, policy_code: policyCode }, { onConflict: 'employee_id,record_date' });
    if (saved.error) return response(500, { error: saved.error.message });
  }
  return response(200, { uploadId: upload.data.id, periodMonth, rowCount: parsed.length, warnings });
});
