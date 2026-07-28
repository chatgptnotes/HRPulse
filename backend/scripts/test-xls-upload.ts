import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3099;

async function run() {
  // Dynamically import the app (which calls app.listen on PORT from env)
  process.env.PORT = String(PORT);
  // Importing index.ts already calls app.listen(PORT)
  await import('../src/index');
  console.log('Waiting for server...');

  await new Promise(r => setTimeout(r, 3000));

  // Test with a real .xls (BIFF8) file
  const xlsPath = path.join(__dirname, 'test.xls');
  if (!fs.existsSync(xlsPath)) {
    console.error('test.xls not found at', xlsPath);
    process.exit(1);
  }
  const buf = fs.readFileSync(xlsPath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/vnd.ms-excel' }), 'test.xls');

  try {
    const res = await fetch(`http://localhost:${PORT}/api/attendance/upload`, {
      method: 'POST',
      body: form,
    });
    console.log('STATUS:', res.status);
    console.log('BODY:', await res.text());
  } catch (e: any) {
    console.log('FETCH ERROR:', e.message);
  }
  process.exit(0);
}

run();
