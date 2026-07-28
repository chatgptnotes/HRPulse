import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const c = await sb.from('attendance_records').select('*', { count: 'exact', head: true }).eq('upload_id', 17);
console.log('total records:', c.count);

const st = await sb.from('attendance_records').select('status').eq('upload_id', 17).limit(5000);
const byS = {};
for (const r of st.data) byS[r.status] = (byS[r.status] || 0) + 1;
console.log('by status:', JSON.stringify(byS));

const empRow = await sb.from('employees').select('id').eq('name', 'ravina.balvir').single();
console.log('ravina id:', empRow.data?.id);
if (empRow.data?.id) {
  const rav = await sb.from('attendance_records').select('record_date,status,time_in,time_out').eq('upload_id', 17).eq('employee_id', empRow.data.id).order('record_date');
  console.log('ravina records:', rav.data?.length);
  console.log('ravina first 10:', JSON.stringify(rav.data?.slice(0, 10)));
}

// records-per-employee distribution
const all = await sb.from('attendance_records').select('employee_id').eq('upload_id', 17).limit(10000);
const perEmp = {};
for (const r of all.data) perEmp[r.employee_id] = (perEmp[r.employee_id] || 0) + 1;
const counts = Object.values(perEmp);
console.log('employees:', counts.length, '| min:', Math.min(...counts), '| max:', Math.max(...counts), '| avg:', (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1));
