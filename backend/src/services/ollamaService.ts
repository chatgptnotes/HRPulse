import prisma from '../db/prisma';

async function getSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function generateEmailDraft(
  employeeName: string, employeeEmail: string, periodMonth: string,
  records: Array<{ recordDate: string; status: string }>,
  templateSubject: string, templateBody: string, lopAmount: number
): Promise<{ subject: string; body: string }> {
  const settings = await getSettings();
  const ollamaUrl = settings['ollama_url'] || 'http://localhost:11434';
  const model = settings['ollama_model'] || 'llama3.1:8b';
  const companyName = settings['company_name'] || 'the Company';
  const hrName = settings['hr_name'] || 'HR Department';

  const recordsList = records.map(r => `  ${r.recordDate}  |  ${r.status}`).join('\n');
  const lopNote = lopAmount > 0 ? `\nLoss of Pay deduction: AED ${lopAmount}` : '';

  const prompt = `You are an HR assistant at ${companyName}. Write a professional and empathetic attendance notification email.

Employee: ${employeeName} (${employeeEmail})
Period: ${periodMonth}
Flagged attendance records (${records.length} total):
${recordsList}
${lopNote}

Use this template as a guide — Subject: ${templateSubject}
Body template: ${templateBody}

Generate a personalized email body. Replace all placeholders with real values. Keep under 250 words. Be factual, professional, and considerate. Return ONLY the email body text.`;

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
  const data = await response.json() as { response: string };
  const body = data.response?.trim() || '';

  const subject = templateSubject
    .replace('{{flagged_count}}', String(records.length))
    .replace('{{employee_name}}', employeeName)
    .replace('{{period_month}}', periodMonth)
    .replace('{{company_name}}', companyName)
    .replace('{{hr_name}}', hrName);

  return { subject, body };
}

export async function testOllamaConnection(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const settings = await getSettings();
    const ollamaUrl = settings['ollama_url'] || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json() as { models: Array<{ name: string }> };
    return { ok: true, models: data.models?.map(m => m.name) || [] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
