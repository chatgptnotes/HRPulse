import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { generateEmailDraft } from '../services/ollamaService';
import { sendEmail } from '../services/emailService';
import { calculateLOP } from '../services/lopService';
import { format, subMonths, parseISO } from 'date-fns';

const router = Router();

async function getSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.post('/generate/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const settings = await getSettings();
    const workingDays = parseFloat(settings['working_days'] || '26');
    const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

    const uploadRow = await prisma.attendanceUpload.findUnique({ where: { id: uploadId } });
    if (!uploadRow) { send({ error: 'Upload not found' }); res.end(); return; }

    const periodMonth = uploadRow.periodMonth;
    const prevMonth = format(subMonths(parseISO(`${periodMonth}-01`), 1), 'yyyy-MM');

    const initialTemplate = await prisma.emailTemplate.findUnique({ where: { type: 'initial' } });
    const reminderTemplate = await prisma.emailTemplate.findUnique({ where: { type: 'reminder' } });

    const employees = await prisma.employee.findMany({
      where: {
        attendanceRecords: {
          some: { uploadId, status: { notIn: ['Normal', 'Weekend', 'Holiday'] } },
        },
      },
    });

    const total = employees.length;
    send({ type: 'start', total });

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      send({ type: 'progress', completed: i, total, currentEmployee: emp.name });

      const records = await prisma.attendanceRecord.findMany({
        where: { uploadId, employeeId: emp.id, status: { notIn: ['Normal', 'Weekend', 'Holiday'] } },
        orderBy: { recordDate: 'asc' },
      });

      if (records.length === 0) continue;

      const prevSent = await prisma.emailHistory.findFirst({
        where: { employeeId: emp.id, status: 'sent', sentAt: { gte: new Date(`${prevMonth}-01`), lt: new Date(`${periodMonth}-01`) } },
      });

      const templateType = prevSent ? 'reminder' : 'initial';
      const template = (templateType === 'reminder' ? reminderTemplate : initialTemplate)!;

      const salary = await prisma.salaryConfig.findFirst({ where: { employeeId: emp.id }, orderBy: { effectiveMonth: 'desc' } });
      const absentDays = records.filter(r => r.status === 'Absent').length;
      const missedSwipeDays = records.filter(r => r.status === 'Missed Swipe').length;
      const { lopAmount } = salary ? calculateLOP(salary.basicSalary, absentDays, missedSwipeDays, workingDays, missedSwipeWeight) : { lopAmount: 0 };

      try {
        const { subject, body } = await generateEmailDraft(
          emp.name, emp.email, periodMonth,
          records.map(r => ({ recordDate: r.recordDate, status: r.status })),
          template.subject, template.body, lopAmount
        );

        await prisma.emailDraft.upsert({
          where: { uploadId_employeeId: { uploadId, employeeId: emp.id } },
          update: { templateType, subject, body, isEdited: false, status: 'pending' },
          create: { uploadId, employeeId: emp.id, templateType, subject, body },
        });
      } catch (genErr) {
        console.error(`Error generating draft for ${emp.name}:`, genErr);
        await prisma.emailDraft.upsert({
          where: { uploadId_employeeId: { uploadId, employeeId: emp.id } },
          update: {},
          create: { uploadId, employeeId: emp.id, subject: `Attendance Alert - ${emp.name}`, body: '' },
        });
      }
    }

    send({ type: 'done', total });
    res.end();
  } catch (err) {
    send({ type: 'error', error: String(err) });
    res.end();
  }
});

router.get('/drafts/:uploadId', async (req: Request, res: Response) => {
  const drafts = await prisma.emailDraft.findMany({
    where: { uploadId: parseInt(req.params.uploadId) },
    include: { employee: true },
    orderBy: [{ status: 'asc' }, { employee: { name: 'asc' } }],
  });
  res.json(drafts.map(d => ({
    id: d.id, uploadId: d.uploadId, employeeId: d.employeeId,
    employeeName: d.employee.name, employeeEmail: d.employee.email,
    templateType: d.templateType, subject: d.subject, body: d.body,
    isEdited: d.isEdited, status: d.status, sentAt: d.sentAt, errorMessage: d.errorMessage, createdAt: d.createdAt,
  })));
});

router.patch('/drafts/:draftId', async (req: Request, res: Response) => {
  const { subject, body } = req.body;
  await prisma.emailDraft.update({ where: { id: parseInt(req.params.draftId) }, data: { subject, body, isEdited: true } });
  res.json({ ok: true });
});

router.post('/send/:draftId', async (req: Request, res: Response) => {
  const draft = await prisma.emailDraft.findUnique({ where: { id: parseInt(req.params.draftId) }, include: { employee: true } });
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

  try {
    await sendEmail(draft.employee.email, draft.subject, draft.body);
    const now = new Date();
    await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: 'sent', sentAt: now, errorMessage: null } });
    await prisma.emailHistory.create({ data: { employeeId: draft.employeeId, uploadId: draft.uploadId, subject: draft.subject, body: draft.body, sentAt: now, status: 'sent' } });
    res.json({ ok: true, sentAt: now });
  } catch (err) {
    const msg = String(err);
    await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: 'failed', errorMessage: msg } });
    res.status(500).json({ error: msg });
  }
});

router.post('/send-bulk', async (req: Request, res: Response) => {
  const { draftIds } = req.body as { draftIds: number[] };
  const results: Array<{ draftId: number; ok: boolean; error?: string }> = [];

  for (const draftId of draftIds) {
    const draft = await prisma.emailDraft.findUnique({ where: { id: draftId }, include: { employee: true } });
    if (!draft) { results.push({ draftId, ok: false, error: 'Not found' }); continue; }

    try {
      await sendEmail(draft.employee.email, draft.subject, draft.body);
      const now = new Date();
      await prisma.emailDraft.update({ where: { id: draftId }, data: { status: 'sent', sentAt: now, errorMessage: null } });
      await prisma.emailHistory.create({ data: { employeeId: draft.employeeId, uploadId: draft.uploadId, subject: draft.subject, body: draft.body, sentAt: now, status: 'sent' } });
      results.push({ draftId, ok: true });
    } catch (err) {
      const msg = String(err);
      await prisma.emailDraft.update({ where: { id: draftId }, data: { status: 'failed', errorMessage: msg } });
      results.push({ draftId, ok: false, error: msg });
    }
  }

  res.json({ results });
});

router.get('/history', async (req: Request, res: Response) => {
  const { month, employeeId } = req.query;
  const where: Record<string, unknown> = {};
  if (month) {
    where.sentAt = { gte: new Date(`${month}-01`), lt: new Date(`${month}-01`) };
    const [y, m] = (month as string).split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    where.sentAt = { gte: start, lt: end };
  }
  if (employeeId) where.employeeId = parseInt(employeeId as string);

  const history = await prisma.emailHistory.findMany({
    where,
    include: { employee: true },
    orderBy: { sentAt: 'desc' },
    take: 500,
  });

  res.json(history.map(h => ({
    id: h.id, employeeId: h.employeeId, employeeName: h.employee.name, employeeEmail: h.employee.email,
    uploadId: h.uploadId, subject: h.subject, body: h.body, sentAt: h.sentAt, status: h.status, errorMessage: h.errorMessage,
  })));
});

export default router;
