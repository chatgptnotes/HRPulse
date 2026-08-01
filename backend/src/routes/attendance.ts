import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { upload } from '../middleware/upload';
import { parseAttendanceExcel } from '../services/excelParser';
import { computeDeductionsForUpload } from '../services/deductionService';
import { toDateOnly, fromDateOnly } from '../utils/date';

const router = Router();

async function getSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  try {
    const { records, periodMonth, warnings } = parseAttendanceExcel(req.file.buffer);
    if (records.length === 0) { res.status(400).json({ error: 'No valid records found', warnings }); return; }

    const uploadRow = await prisma.attendanceUpload.create({
      data: { filename: req.file.originalname, periodMonth, rowCount: records.length },
    });

    let recordCount = 0;
    for (const r of records) {
      let email = r.email || `unknown_${r.employeeName.toLowerCase().replace(/\s+/g, '_')}@hrpulse.local`;
      if (!r.email) warnings.push(`No email for "${r.employeeName}" — using placeholder`);

      const emp = await prisma.employee.upsert({
        where: { email },
        update: { name: r.employeeName, organisation: r.organisation || null, entity: r.entity || null },
        create: { employeeNumber: r.employeeNumber || null, name: r.employeeName, email, organisation: r.organisation || null, entity: r.entity || null },
      });

      // Upsert, not create: (employeeId, recordDate) is now unique, so a repeated
      // upload of the same period corrects the existing row instead of adding a
      // duplicate one (which used to double every count feeding the LOP figure).
      const recordDate = fromDateOnly(r.recordDate);
      await prisma.attendanceRecord.upsert({
        where: { employeeId_recordDate: { employeeId: emp.id, recordDate } },
        update: { uploadId: uploadRow.id, status: r.status, timeInRaw: r.timeIn || null, timeOutRaw: r.timeOut || null },
        create: { uploadId: uploadRow.id, employeeId: emp.id, recordDate, status: r.status, timeInRaw: r.timeIn || null, timeOutRaw: r.timeOut || null },
      });
      recordCount++;
    }

    res.json({ uploadId: uploadRow.id, periodMonth, rowCount: recordCount, warnings });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/uploads', async (_req: Request, res: Response) => {
  const uploads = await prisma.attendanceUpload.findMany({ orderBy: { uploadedAt: 'desc' } });
  res.json(uploads.map(u => ({ id: u.id, filename: u.filename, periodMonth: u.periodMonth, uploadedAt: u.uploadedAt, rowCount: u.rowCount, status: u.status })));
});

router.get('/summary/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);

  const [deductions, drafts] = await Promise.all([
    computeDeductionsForUpload(uploadId),
    prisma.emailDraft.findMany({ where: { uploadId } }),
  ]);
  const draftByEmployee = new Map(drafts.map(d => [d.employeeId, d]));

  const summary = deductions.map(d => {
    const draft = draftByEmployee.get(d.employeeId);
    return {
      employeeId: d.employeeId, employeeName: d.employeeName, employeeEmail: d.employeeEmail,
      absentDays: d.counts.absentDays, missedSwipeDays: d.counts.missedSwipeDays,
      lateComingDays: d.counts.lateComingDays, earlyLeavingDays: d.counts.earlyLeavingDays,
      halfDays: d.counts.halfDays,
      flaggedTotal: d.counts.flaggedTotal,
      baseLopDays: d.baseLopDays, ruleLopDays: d.ruleLopDays,
      lopDays: d.lopDays, lopAmount: d.lopAmount,
      hasDraft: !!draft, draftStatus: draft?.status || null, draftId: draft?.id || null,
    };
  });

  summary.sort((a, b) => b.flaggedTotal - a.flaggedTotal);
  res.json(summary);
});

router.get('/records/:uploadId/:employeeId', async (req: Request, res: Response) => {
  const records = await prisma.attendanceRecord.findMany({
    where: { uploadId: parseInt(req.params.uploadId), employeeId: parseInt(req.params.employeeId) },
    orderBy: { recordDate: 'asc' },
  });
  // timeInRaw/timeOutRaw are the imported free-text times. The typed timeIn/timeOut
  // columns stay null until a biometric punch feed populates them, so the API keeps
  // returning what it always did.
  res.json(records.map(r => ({ id: r.id, recordDate: toDateOnly(r.recordDate), status: r.status, timeIn: r.timeInRaw, timeOut: r.timeOutRaw })));
});

router.delete('/uploads/:uploadId', async (req: Request, res: Response) => {
  await prisma.attendanceUpload.delete({ where: { id: parseInt(req.params.uploadId) } });
  res.json({ ok: true });
});

export default router;
