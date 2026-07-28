import { Router, Request, Response } from 'express';
import { supabase, getSettings } from '../db/supabase';

const router = Router();

async function ollamaQuery(prompt: string, settings: Record<string, string>): Promise<string> {
  const res = await fetch(`${settings['ollama_url'] || 'http://localhost:11434'}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings['ollama_model'] || 'llama3.2:3b', prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json() as { response: string };
  return data.response?.trim() || '';
}

router.post('/ask', async (req: Request, res: Response) => {
  const { question, uploadId } = req.body;
  const settings = await getSettings();

  let context = '';
  if (uploadId) {
    const { data: records } = await supabase
      .from('attendance_records')
      .select('status, employee_id')
      .eq('upload_id', parseInt(uploadId));
    const recs = (records || []) as any[];
    const byStatus: Record<string, number> = {};
    for (const r of recs) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const employees = new Set(recs.map((r) => r.employee_id)).size;
    context = `Attendance data context: ${employees} employees. Records by status: ${Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(', ')}.`;
  }

  const prompt = `You are an HR data analyst assistant. Answer the following question about attendance data clearly and concisely.

${context}

Question: ${question}

Provide a helpful, data-driven answer in 2-4 sentences.`;

  try {
    const answer = await ollamaQuery(prompt, settings);
    await supabase.from('ai_insights').insert({
      upload_id: uploadId ? parseInt(uploadId) : null,
      insight_type: 'qa',
      title: question.slice(0, 100),
      content: answer,
      severity: 'info',
    });
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/analyze/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const settings = await getSettings();

  const { data: upload } = await supabase.from('attendance_uploads').select('*').eq('id', uploadId).single();
  if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

  const { data: records } = await supabase.from('attendance_records').select('status, employee_id').eq('upload_id', uploadId);
  const recs = (records || []) as any[];

  const byStatus: Record<string, number> = {};
  const byEmployeeAbsent: Record<number, number> = {};
  const byEmployeeMissed: Record<number, number> = {};
  for (const r of recs) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.status === 'Absent') byEmployeeAbsent[r.employee_id] = (byEmployeeAbsent[r.employee_id] || 0) + 1;
    if (r.status === 'Missed Swipe') byEmployeeMissed[r.employee_id] = (byEmployeeMissed[r.employee_id] || 0) + 1;
  }

  const topAbsentees = Object.entries(byEmployeeAbsent).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMissed = Object.entries(byEmployeeMissed).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const statusSummary = Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(', ');

  const prompt = `You are an HR analyst. Analyze this attendance data for ${upload.period_month} and provide 3-5 key insights:

Status breakdown: ${statusSummary}
Top absentees: ${topAbsentees.length} employees with absent records
Missed swipes: ${topMissed.length} employees with missed punch records

Provide insights in this exact format:
INSIGHT 1: [title] | [severity: info/warning/critical] | [description]
INSIGHT 2: [title] | [severity] | [description]
(continue for each insight)`;

  try {
    const raw = await ollamaQuery(prompt, settings);
    const insights: Array<{ title: string; severity: string; content: string }> = [];

    const lines = raw.split('\n').filter((l) => l.match(/^INSIGHT \d+:/));
    for (const line of lines) {
      const parts = line.replace(/^INSIGHT \d+:\s*/, '').split(' | ');
      if (parts.length >= 3) {
        const { data: insight } = await supabase.from('ai_insights').insert({
          upload_id: uploadId,
          insight_type: 'anomaly',
          title: parts[0].trim(),
          severity: parts[1].trim(),
          content: parts[2].trim(),
        }).select().single();
        if (insight) insights.push({ title: insight.title, severity: insight.severity, content: insight.content });
      }
    }

    if (insights.length === 0) {
      const { data: insight } = await supabase.from('ai_insights').insert({
        upload_id: uploadId,
        insight_type: 'summary',
        title: 'Attendance Analysis',
        severity: 'info',
        content: raw,
      }).select().single();
      if (insight) insights.push({ title: insight.title, severity: insight.severity, content: insight.content });
    }

    res.json({ insights });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/insights/:uploadId', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('ai_insights')
    .select('*')
    .eq('upload_id', parseInt(req.params.uploadId))
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.post('/predict', async (_req: Request, res: Response) => {
  const { data: employees } = await supabase.from('employees').select('id, name, email');
  const { data: records } = await supabase.from('attendance_records').select('employee_id, status, record_date');
  const recs = (records || []) as any[];

  const byEmployee: Record<number, any[]> = {};
  for (const r of recs) {
    if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = [];
    byEmployee[r.employee_id].push(r);
  }

  const riskEmployees = (employees || []).map((emp: any) => {
    const empRecs = byEmployee[emp.id] || [];
    const flagged = empRecs.filter((r) => !['Normal', 'Weekend', 'Holiday'].includes(r.status));
    const riskScore = Math.min(100, (flagged.length / Math.max(empRecs.length, 1)) * 100 * 2);
    return { id: emp.id, name: emp.name, email: emp.email, riskScore: Math.round(riskScore), flaggedCount: flagged.length };
  }).filter((e: any) => e.riskScore > 20).sort((a: any, b: any) => b.riskScore - a.riskScore).slice(0, 10);

  res.json({ predictions: riskEmployees });
});

router.post('/generate-report/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const settings = await getSettings();
  const { data: upload } = await supabase.from('attendance_uploads').select('*').eq('id', uploadId).single();
  if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

  const { data: records } = await supabase.from('attendance_records').select('status, employee_id').eq('upload_id', uploadId);
  const recs = (records || []) as any[];

  const totalEmployees = new Set(recs.map((r) => r.employee_id)).size;
  const flaggedCount = recs.filter((r) => !['Normal', 'Weekend', 'Holiday'].includes(r.status)).length;
  const absentCount = recs.filter((r) => r.status === 'Absent').length;
  const missedCount = recs.filter((r) => r.status === 'Missed Swipe').length;
  const lateCount = recs.filter((r) => r.status === 'Late Coming').length;
  const { count: sentEmails } = await supabase
    .from('email_history')
    .select('*', { count: 'exact', head: true })
    .eq('upload_id', uploadId)
    .eq('status', 'sent');

  const prompt = `Generate a professional HR monthly attendance report for ${upload.period_month}.

Data:
- Total employees tracked: ${totalEmployees}
- Total flagged records: ${flaggedCount}
- Absences: ${absentCount}
- Missed swipes: ${missedCount}
- Late arrivals: ${lateCount}
- Notification emails sent: ${sentEmails || 0}

Write a formal 200-word executive summary report with: key findings, concerning trends, and 3 recommendations for improvement.`;

  try {
    const report = await ollamaQuery(prompt, settings);
    await supabase.from('ai_insights').insert({
      upload_id: uploadId,
      insight_type: 'report',
      title: `Monthly Report — ${upload.period_month}`,
      content: report,
      severity: 'info',
    });
    res.json({ report, month: upload.period_month, stats: { totalEmployees, flaggedCount, absentCount, missedCount, lateCount, sentEmails: sentEmails || 0 } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
