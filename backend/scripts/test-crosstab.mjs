import XLSX from 'xlsx';
import fs from 'fs';

// Cross-tab layout: title row, then NUMBER | NAME | day numbers 1..31
// Cells hold punch in/out ("09:00-18:00") or status codes (A, WO, P).
const sheet = [
  ['Attendance Report — July 2026'],
  ['NUMBER', 'NAME', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  ['E001', 'Ahmed Ali',  '09:00-18:00', '09:35-18:00', 'A',  '09:00-13:00', '09:00-18:00', 'WO', 'WO', '09:00-18:00', '09:00-18:00', '09:00-18:00'],
  ['E002', 'Sara Khan',  '09:05-18:00', '12:00',        '09:00-18:30', 'P',  'P',  'WO', 'WO', 'A',  '09:00-18:00', '09:00-18:00'],
  ['E003', 'John Doe',   'P',           'P',            'P',  'P',  'P',  'WO', 'WO', 'P',  'P',  'P'],
];
const ws = XLSX.utils.aoa_to_sheet(sheet);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
const p = 'scripts/crosstab.xlsx';
XLSX.writeFile(wb, p);

// 1) Inspect
let form = new FormData();
form.append('file', new Blob([fs.readFileSync(p)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'crosstab.xlsx');
let res = await fetch('http://localhost:3001/api/attendance/inspect', { method: 'POST', body: form });
let body = await res.json();
console.log('=== INSPECT ===');
console.log('looksLikeCrossTab:', body.looksLikeCrossTab, '| extractedRecordCount:', body.extractedRecordCount, '| periodMonth:', body.periodMonth);
console.log('rawHeaders:', JSON.stringify(body.rawHeaders));

// 2) Upload (real)
form = new FormData();
form.append('file', new Blob([fs.readFileSync(p)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'crosstab.xlsx');
res = await fetch('http://localhost:3001/api/attendance/upload', { method: 'POST', body: form });
body = await res.json();
console.log('\n=== UPLOAD ===');
console.log('STATUS:', res.status);
console.log(JSON.stringify(body, null, 2));

// 3) Show the per-day records stored
if (body.uploadId) {
  const sum = await fetch(`http://localhost:3001/api/attendance/summary/${body.uploadId}`);
  const sbody = await sum.json();
  console.log('\n=== SUMMARY (per employee) ===');
  for (const s of sbody) console.log(`  ${s.employeeName}: absent=${s.absentDays} missed=${s.missedSwipeDays} late=${s.lateComingDays} flagged=${s.flaggedTotal}`);
}
