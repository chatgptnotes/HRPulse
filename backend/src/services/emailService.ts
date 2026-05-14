import nodemailer from 'nodemailer';
import prisma from '../db/prisma';

async function getSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const s = await getSettings();

  // Use Ethereal test account if no SMTP configured
  if (!s['smtp_host'] || s['smtp_host'] === 'smtp.gmail.com' && !s['smtp_pass']) {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587, secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    const info = await transporter.sendMail({ from: '"HRPulse" <hr@hrpulse.local>', to, subject, text: body });
    console.log(`[TEST EMAIL] Preview: ${nodemailer.getTestMessageUrl(info)}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: s['smtp_host'],
    port: parseInt(s['smtp_port'] || '587'),
    secure: s['smtp_secure'] === 'true',
    auth: { user: s['smtp_user'], pass: s['smtp_pass'] },
    tls: { rejectUnauthorized: false },
  });
  await transporter.sendMail({ from: `"${s['company_name']} HR" <${s['smtp_user']}>`, to, subject, text: body });
}

export async function testSmtp(): Promise<{ ok: boolean; error?: string }> {
  try {
    const s = await getSettings();
    if (!s['smtp_host']) return { ok: false, error: 'SMTP not configured' };
    const transporter = nodemailer.createTransport({
      host: s['smtp_host'], port: parseInt(s['smtp_port'] || '587'),
      secure: s['smtp_secure'] === 'true',
      auth: { user: s['smtp_user'], pass: s['smtp_pass'] },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
