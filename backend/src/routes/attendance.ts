import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { upload } from '../middleware/upload';
import { parseAttendanceExcel } from '../services/excelParser';
import { calculateLOP } from '../services/lopService';

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

      await prisma.attendanceRecord.create({
        data: { uploadId: uploadRow.id, employeeId: emp.id, recordDate: r.recordDate, status: r.status, timeIn: r.timeIn || null, timeOut: r.timeOut || null },
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
  const settings = await getSettings();
  const workingDays = parseFloat(settings['working_days'] || '26');
  const missedSwipeWeight = parseFloat(settings['missed_swipe_weight'] || '0.5');

  const employees = await prisma.employee.findMany({
    where: { attendanceRecords: { some: { uploadId } } },
    include: {
      attendanceRecords: { where: { uploadId } },
      salaryConfigs: { orderBy: { effectiveMonth: 'desc' }, take: 1 },
      emailDrafts: { where: { uploadId } },
    },
  });

  const summary = employees.map(emp => {
    let absent = 0, missed = 0, late = 0, early = 0;
    for (const r of emp.attendanceRecords) {
      if (r.status === 'Absent') absent++;
      else if (r.status === 'Missed Swipe') missed++;
      else if (r.status === 'Late Coming') late++;
      else if (r.status === 'Early Leaving') early++;
    }
    const flaggedTotal = absent + missed + late + early;
    const salary = emp.salaryConfigs[0];
    const { lopDays, lopAmount } = salary ? calculateLOP(salary.basicSalary, absent, missed, workingDays, missedSwipeWeight) : { lopDays: 0, lopAmount: 0 };
    const draft = emp.emailDrafts[0];
    return {
      employeeId: emp.id, employeeName: emp.name, employeeEmail: emp.email,
      absentDays: absent, missedSwipeDays: missed, lateComingDays: late, earlyLeavingDays: early,
      flaggedTotal, lopDays, lopAmount,
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
  res.json(records.map(r => ({ id: r.id, recordDate: r.recordDate, status: r.status, timeIn: r.timeIn, timeOut: r.timeOut })));
});

router.delete('/uploads/:uploadId', async (req: Request, res: Response) => {
  await prisma.attendanceUpload.delete({ where: { id: parseInt(req.params.uploadId) } });
  res.json({ ok: true });
});

export default router;
