import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';

const router = Router();

router.get('/overview', async (_req: Request, res: Response) => {
  const [totalEmployees, totalUploads, totalEmails, totalSent] = await Promise.all([
    prisma.employee.count(),
    prisma.attendanceUpload.count(),
    prisma.emailDraft.count(),
    prisma.emailHistory.count({ where: { status: 'sent' } }),
  ]);
  res.json({ totalEmployees, totalUploads, totalEmails, totalSent });
});

router.get('/trends/:uploadId', async (req: Request, res: Response) => {
  const uploadId = parseInt(req.params.uploadId);
  const records = await prisma.attendanceRecord.findMany({
    where: { uploadId, status: { notIn: ['Normal', 'Weekend', 'Holiday'] } },
    include: { employee: { select: { name: true } } },
  });

  const byStatus = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const byDate = records.reduce((acc, r) => {
    acc[r.recordDate] = (acc[r.recordDate] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const byDepartment: Record<string, number> = {};

  const topOffenders = await prisma.attendanceRecord.groupBy({
    by: ['employeeId'],
    where: { uploadId, status: { notIn: ['Normal', 'Weekend', 'Holiday'] } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  });

  const topWithNames = await Promise.all(
    topOffenders.map(async t => {
      const emp = await prisma.employee.findUnique({ where: { id: t.employeeId }, select: { name: true, email: true } });
      return { employeeId: t.employeeId, name: emp?.name || 'Unknown', count: t._count.id };
    })
  );

  res.json({ byStatus, byDate: Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count })), topOffenders: topWithNames });
});

router.get('/monthly-comparison', async (_req: Request, res: Response) => {
  const uploads = await prisma.attendanceUpload.findMany({ orderBy: { uploadedAt: 'desc' }, take: 6 });
  const result = await Promise.all(uploads.map(async u => {
    const flagged = await prisma.attendanceRecord.count({ where: { uploadId: u.id, status: { notIn: ['Normal', 'Weekend', 'Holiday'] } } });
    const sent = await prisma.emailHistory.count({ where: { uploadId: u.id, status: 'sent' } });
    return { month: u.periodMonth, flagged, sent, employees: u.rowCount };
  }));
  res.json(result.reverse());
});

export default router;
