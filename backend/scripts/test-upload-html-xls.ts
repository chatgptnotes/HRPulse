const fs = require('fs');
const path = require('path');

async function main() {
  process.env.PORT = '3097';
  await import('../src/index.ts');
  console.log('Waiting for server startup...');
  await new Promise(r => setTimeout(r, 3000));

  const buf = fs.readFileSync(path.join(__dirname, 'test-html.xls'));
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/vnd.ms-excel' }), 'test-html.xls');

  const res = await fetch('http://localhost:3097/api/attendance/upload', { method: 'POST', body: form });
  console.log('HTML-XLS UPLOAD STATUS:', res.status);
  console.log('HTML-XLS UPLOAD BODY:', await res.text());

  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
