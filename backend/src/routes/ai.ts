import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';

const router = Router();

async function getSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function ollamaQuery(prompt: string, settings: Record<string, string>): Promise<string> {
  const res = await fetch(`${settings['ollama_url'] || 'http://localhost:11434'}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings['ollama_model'] || 'llama3.1:8b', prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json() as { response: string };
  return data.response?.trim() || '';
}

// POST /api/ai/ask — Natural language Q&A
router.post('/ask', async (req: Request, res: Response) => {
  const { question, uploadId } = req.body;
  const settings = await getSettings();

  let context = '';
  if (uploadId) {
    const records = await prisma.attendanceRecord.groupBy({
      by: ['status'],
      where: { uploadId: parseInt(uploadId) },
      _count: { id: true },
    });
    const employees = await prisma.employee.count({ where: { attendanceRecords: { some: { uploadId: parseInt(uploadId) } } } });
    context = `Attendance data context: ${employees} employees. Records by status: ${records.map(r => `${r.status}: ${r._count.id}`).join(', ')}.`;
  }

  const prompt = `You are an HR data analyst assistant. Answer the following question about attendance data clearly and concisely.

${context}

Question: ${question}

Provide a helpful, data-driven answer in 2-4 sentences.`;

  try {
    const answer = await ollamaQuery(prompt, settings);
    await prisma.aiInsight.create({ data: { uploadId: uploadId ? parseInt(uploadId) : null, insightType: 'qa', title: question.slice(0, 100), content: answer, severity: 'info' } });
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/ai/analyze/:uploadId — Anomaly detection + insights
router.post('/analyze/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const settings = await getSettings();

  const upload = await prisma.attendanceUpload.findUnique({ where: { id: uploadId } });
  if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

  const records = await prisma.attendanceRecord.groupBy({
    by: ['status'], where: { uploadId }, _count: { id: true },
  });

  const topAbsentees = await prisma.attendanceRecord.groupBy({
    by: ['employeeId'],
    where: { uploadId, status: 'Absent' },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });

  const topMissed = await prisma.attendanceRecord.groupBy({
    by: ['employeeId'],
    where: { uploadId, status: 'Missed Swipe' },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });

  const statusSummary = records.map(r => `${r.status}: ${r._count.id}`).join(', ');

  const prompt = `You are an HR analyst. Analyze this attendance data for ${upload.periodMonth} and provide 3-5 key insights:

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

    const lines = raw.split('\n').filter(l => l.match(/^INSIGHT \d+:/));
    for (const line of lines) {
      const parts = line.replace(/^INSIGHT \d+:\s*/, '').split(' | ');
      if (parts.length >= 3) {
        const insight = await prisma.aiInsight.create({
          data: { uploadId, insightType: 'anomaly', title: parts[0].trim(), severity: parts[1].trim(), content: parts[2].trim() },
        });
        insights.push({ title: insight.title, severity: insight.severity, content: insight.content });
      }
    }

    if (insights.length === 0) {
      const insight = await prisma.aiInsight.create({
        data: { uploadId, insightType: 'summary', title: 'Attendance Analysis', severity: 'info', content: raw },
      });
      insights.push({ title: insight.title, severity: insight.severity, content: insight.content });
    }

    res.json({ insights });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/ai/insights/:uploadId
router.get('/insights/:uploadId', async (req: Request, res: Response) => {
  const insights = await prisma.aiInsight.findMany({
    where: { uploadId: parseInt(req.params.uploadId) },
    orderBy: { createdAt: 'desc' },
  });
  res.json(insights);
});

// POST /api/ai/predict — Predictive absenteeism
router.post('/predict', async (req: Request, res: Response) => {
  const settings = await getSettings();
  const employees = await prisma.employee.findMany({
    include: { attendanceRecords: { orderBy: { recordDate: 'desc' }, take: 90 } },
  });

  const riskEmployees = employees.map(emp => {
    const flagged = emp.attendanceRecords.filter(r => !['Normal', 'Weekend', 'Holiday'].includes(r.status));
    const riskScore = Math.min(100, (flagged.length / Math.max(emp.attendanceRecords.length, 1)) * 100 * 2);
    return { id: emp.id, name: emp.name, email: emp.email, riskScore: Math.round(riskScore), flaggedCount: flagged.length };
  }).filter(e => e.riskScore > 20).sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);

  res.json({ predictions: riskEmployees });
});

// POST /api/ai/generate-report/:uploadId
router.post('/generate-report/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const settings = await getSettings();
  const upload = await prisma.attendanceUpload.findUnique({ where: { id: uploadId } });
  if (!upload) { res.status(404).json({ error: 'Upload not found' }); return; }

  const [totalEmployees, flaggedCount, absentCount, missedCount, lateCount, sentEmails] = await Promise.all([
    prisma.employee.count({ where: { attendanceRecords: { some: { uploadId } } } }),
    prisma.attendanceRecord.count({ where: { uploadId, status: { notIn: ['Normal', 'Weekend', 'Holiday'] } } }),
    prisma.attendanceRecord.count({ where: { uploadId, status: 'Absent' } }),
    prisma.attendanceRecord.count({ where: { uploadId, status: 'Missed Swipe' } }),
    prisma.attendanceRecord.count({ where: { uploadId, status: 'Late Coming' } }),
    prisma.emailHistory.count({ where: { uploadId, status: 'sent' } }),
  ]);

  const prompt = `Generate a professional HR monthly attendance report for ${upload.periodMonth}.

Data:
- Total employees tracked: ${totalEmployees}
- Total flagged records: ${flaggedCount}
- Absences: ${absentCount}
- Missed swipes: ${missedCount}
- Late arrivals: ${lateCount}
- Notification emails sent: ${sentEmails}

Write a formal 200-word executive summary report with: key findings, concerning trends, and 3 recommendations for improvement.`;

  try {
    const report = await ollamaQuery(prompt, settings);
    await prisma.aiInsight.create({ data: { uploadId, insightType: 'report', title: `Monthly Report — ${upload.periodMonth}`, content: report, severity: 'info' } });
    res.json({ report, month: upload.periodMonth, stats: { totalEmployees, flaggedCount, absentCount, missedCount, lateCount, sentEmails } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
