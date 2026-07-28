const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');

const html = `<html><head><meta charset="utf-8"></head><body><table>
<tr><th>Employee Number</th><th>Employee Name</th><th>Email</th><th>Date</th><th>Attendance Type</th><th>Time In</th><th>Time Out</th></tr>
<tr><td>E001</td><td>Ahmed Ali</td><td>ahmed@corp.ae</td><td>2026-07-01</td><td>Normal</td><td>08:55</td><td>18:10</td></tr>
<tr><td>E001</td><td>Ahmed Ali</td><td>ahmed@corp.ae</td><td>2026-07-02</td><td>Late Coming</td><td>09:35</td><td>18:00</td></tr>
</table></body></html>`;

const outPath = path.join(__dirname, 'test-html.xls');
fs.writeFileSync(outPath, html);
console.log('Created HTML-disguised .xls at', outPath);

const buf = fs.readFileSync(outPath);
console.log('First 20 chars:', buf.slice(0, 20).toString('utf8'));
console.log('First 8 bytes (hex):', buf.slice(0, 8).toString('hex'));

try {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  console.log('PARSED OK. Sheets:', wb.SheetNames);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log('ROWS:', JSON.stringify(rows, null, 2));
} catch (e) {
  console.log('PARSE ERROR:', e.message);
  console.log(e.stack);
}
