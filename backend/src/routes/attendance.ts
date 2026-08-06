import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { upload } from '../middleware/upload';
import { parseAttendanceExcel, parseStaffMaster, StaffMasterRecord } from '../services/excelParser';
import { computeDeductionsForUpload } from '../services/deductionService';
import { toDateOnly, fromDateOnly } from '../utils/date';

const router = Router();

const employeeNameKey = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+(soft|staff|employee|emp)$/i, '')
  .replace(/\s+/g, ' ');

const employeeNamesMatch = (left: unknown, right: unknown) => {
  const a = employeeNameKey(left).split(' ').filter(Boolean);
  const b = employeeNameKey(right).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const short = a.length === 1 ? a : b.length === 1 ? b : null;
  const long = a.length === 1 ? b : b.length === 1 ? a : null;
  return !!short && !!long && short[0] === long[0] && long.length <= 3;
};

const recordQuality = (record: { status: string; timeIn: string; timeOut: string }) =>
  Number(Boolean(record.timeIn)) + Number(Boolean(record.timeOut)) + Number(!['Absent', 'Missed Swipe'].includes(record.status));

async function getSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.post('/upload', upload.array('file', 10), async (req: Request, res: Response) => {
  const files = (req.files || []) as Express.Multer.File[];
  if (files.length === 0) { res.status(400).json({ error: 'No file uploaded' }); return; }

  try {
    const classified = files.map(file => ({ file, staff: parseStaffMaster(file.buffer) }));
    const attendanceFiles = classified.filter(item => !item.staff.recognized).map(item => item.file);
    const staffRows: StaffMasterRecord[] = classified.flatMap(item => item.staff.records);
    if (!attendanceFiles.length) {
      res.status(400).json({ error: 'Please include at least one attendance file.' });
      return;
    }
    const parsedFiles = attendanceFiles.map(file => ({ file, parsed: parseAttendanceExcel(file.buffer) }));
    const periodMonths = [...new Set(parsedFiles.map(({ parsed }) => parsed.periodMonth))];
    if (periodMonths.length !== 1) {
      res.status(400).json({ error: `All files must contain the same month. Found: ${periodMonths.join(', ')}` });
      return;
    }
    const incomingRecords = parsedFiles.flatMap(({ parsed }) => parsed.records);
    const warnings = parsedFiles.flatMap(({ file, parsed }) => parsed.warnings.map(warning => `${file.originalname}: ${warning}`));
    const periodMonth = periodMonths[0];
    if (incomingRecords.length === 0) { res.status(400).json({ error: 'No valid records found', warnings }); return; }

    // Multiple reports can contain the same employee/date. Keep one row per
    // employee/day and prefer the row with actual punch/status information.
    const uniqueRecords = new Map<string, typeof incomingRecords[number]>();
    for (const record of incomingRecords) {
      const identity = record.employeeNumber || employeeNameKey(record.employeeName);
      const key = `${identity}|${record.recordDate}`;
      const current = uniqueRecords.get(key);
      if (!current || recordQuality(record) >= recordQuality(current)) uniqueRecords.set(key, record);
    }
    const records = [...uniqueRecords.values()];

    // Re-importing a month replaces the previous logical batch. Records are
    // reassigned before old uploads are removed, so the unique employee/day
    // constraint remains the source of truth and old drafts cannot repeat.
    const previousUploads = await prisma.attendanceUpload.findMany({ where: { periodMonth }, select: { id: true } });

    const uploadRow = await prisma.attendanceUpload.create({
      data: { filename: files.map(file => file.originalname).join(', '), periodMonth, rowCount: records.length },
    });

    if (previousUploads.length) {
      const oldIds = previousUploads.map(upload => upload.id);
      const start = fromDateOnly(`${periodMonth}-01`);
      const nextMonth = new Date(`${periodMonth}-01T00:00:00Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const end = fromDateOnly(nextMonth.toISOString().slice(0, 10));
      await prisma.attendanceRecord.updateMany({
        where: { uploadId: { in: oldIds }, recordDate: { gte: start, lt: end } },
        data: { uploadId: uploadRow.id },
      });
      await prisma.attendanceUpload.deleteMany({ where: { id: { in: oldIds } } });
    }

    const existingEmployees = await prisma.employee.findMany({ select: { id: true, email: true, name: true, employeeNumber: true } });
    const byEmail = new Map(existingEmployees.map(employee => [employee.email.toLowerCase(), employee]));
    const byNumber = new Map(existingEmployees.filter(employee => employee.employeeNumber).map(employee => [employee.employeeNumber!, employee]));
    const byName = new Map<string, typeof existingEmployees[number]>();
    for (const employee of existingEmployees) {
      const key = employeeNameKey(employee.name);
      if (key && !byName.has(key)) byName.set(key, employee);
    }

    let recordCount = 0;
    for (const r of records) {
      const normalizedName = employeeNameKey(r.employeeName);
      const email = r.email || `unknown_${normalizedName.replace(/\s+/g, '_')}@hrpulse.local`;
      if (!r.email) warnings.push(`No email for "${r.employeeName}" — using placeholder`);

      const emp = byEmail.get(email.toLowerCase()) || byNumber.get(r.employeeNumber) || byName.get(normalizedName) || [...byName.values()].find(employee => employeeNamesMatch(normalizedName, employee.name));
      const savedEmployee = emp
        ? await prisma.employee.update({
            where: { id: emp.id },
            data: {
              name: emp.name,
              employeeNumber: emp.employeeNumber || r.employeeNumber || null,
              organisation: r.organisation || undefined,
              entity: r.entity || undefined,
            },
          })
        : await prisma.employee.create({
            data: { employeeNumber: r.employeeNumber || null, name: r.employeeName, email, organisation: r.organisation || null, entity: r.entity || null },
          });
      byEmail.set(savedEmployee.email.toLowerCase(), savedEmployee);
      if (savedEmployee.employeeNumber) byNumber.set(savedEmployee.employeeNumber, savedEmployee);
      byName.set(employeeNameKey(savedEmployee.name), savedEmployee);

      // Upsert, not create: (employeeId, recordDate) is now unique, so a repeated
      // upload of the same period corrects the existing row instead of adding a
      // duplicate one (which used to double every count feeding the LOP figure).
      const recordDate = fromDateOnly(r.recordDate);
      await prisma.attendanceRecord.upsert({
        where: { employeeId_recordDate: { employeeId: savedEmployee.id, recordDate } },
        update: { uploadId: uploadRow.id, status: r.status, timeInRaw: r.timeIn || null, timeOutRaw: r.timeOut || null },
        create: { uploadId: uploadRow.id, employeeId: savedEmployee.id, recordDate, status: r.status, timeInRaw: r.timeIn || null, timeOutRaw: r.timeOut || null },
      });
      recordCount++;
    }

    for (const staff of staffRows) {
      const normalizedName = employeeNameKey(staff.name);
      const employee = byName.get(normalizedName) || [...byName.values()].find(item => employeeNamesMatch(normalizedName, item.name));
      if (!employee) {
        const key = normalizedName.replace(/\s+/g, '_');
        const created = await prisma.employee.upsert({
          where: { email: `staff_${key}@hrpulse.local` },
          update: { name: staff.name, organisation: staff.organisation || null, designation: staff.designation || null },
          create: { name: staff.name, email: `staff_${key}@hrpulse.local`, organisation: staff.organisation || null, designation: staff.designation || null },
        });
        byName.set(employeeNameKey(created.name), created);
        if (staff.basicSalary > 0) {
          await prisma.salaryConfig.upsert({
            where: { employeeId_effectiveMonth: { employeeId: created.id, effectiveMonth: periodMonth } },
            update: { basicSalary: staff.basicSalary },
            create: { employeeId: created.id, effectiveMonth: periodMonth, basicSalary: staff.basicSalary },
          });
        }
        continue;
      }
      const updated = await prisma.employee.update({
        where: { id: employee.id },
        data: { organisation: staff.organisation || undefined, designation: staff.designation || undefined },
      });
      byName.set(employeeNameKey(updated.name), updated);
      if (staff.basicSalary > 0) {
        await prisma.salaryConfig.upsert({
          where: { employeeId_effectiveMonth: { employeeId: updated.id, effectiveMonth: periodMonth } },
          update: { basicSalary: staff.basicSalary },
          create: { employeeId: updated.id, effectiveMonth: periodMonth, basicSalary: staff.basicSalary },
        });
      }
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
