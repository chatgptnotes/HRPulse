import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../db/prisma';

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'photos');
fs.mkdirSync(uploadDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, _file, cb) => cb(null, `emp-${req.params.id}-${Date.now()}.jpg`),
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', async (_req: Request, res: Response) => {
  const employees = await prisma.employee.findMany({ orderBy: { name: 'asc' } });
  res.json(employees);
});

router.get('/:id', async (req: Request, res: Response) => {
  const emp = await prisma.employee.findUnique({ where: { id: parseInt(req.params.id) } });
  if (!emp) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(emp);
});

router.post('/', async (req: Request, res: Response) => {
  const { name, email, department, designation, employeeNumber, mobile, branch, status, basicSalary, eligibleForPaidLeaves, eligibleForOvertime, organisation, biometricName } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  try {
    const emp = await prisma.employee.create({
      data: {
        name: name.trim(),
        email: email?.trim() || `${name.toLowerCase().replace(/\s+/g, '.')}@hrpulse.local`,
        department: department || 'Rafttar',
        designation: designation || null,
        employeeNumber: employeeNumber || null,
        mobile: mobile || null,
        branch: branch || null,
        status: status || 'Active',
        monthly_salary: basicSalary ? Number(basicSalary) : null,
        eligible_for_paid_leaves: eligibleForPaidLeaves !== false,
        eligible_for_overtime: eligibleForOvertime === true,
        organisation: organisation || null,
        biometric_name: biometricName || null,
      },
    });
    res.json(emp);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'Employee ID already exists' });
    } else {
      console.error('Failed to create employee:', error);
      res.status(500).json({ error: 'Failed to create employee' });
    }
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { name, email, department, designation, employeeNumber, mobile, branch, status, shiftName, shiftStartTime, shiftEndTime, eligibleForPaidLeaves, eligibleForOvertime } = req.body;
  const emp = await prisma.employee.update({
    where: { id: parseInt(req.params.id) },
    data: { ...(name && { name }), ...(email && { email }), ...(department && { department }), ...(designation && { designation }), ...(employeeNumber !== undefined && { employeeNumber }), ...(mobile !== undefined && { mobile }), ...(branch !== undefined && { branch }), ...(status && { status }), ...(shiftName && { shiftName }), ...(shiftStartTime && { shiftStartTime }), ...(shiftEndTime && { shiftEndTime }), ...(eligibleForPaidLeaves !== undefined && { eligibleForPaidLeaves }), ...(eligibleForOvertime !== undefined && { eligibleForOvertime }) },
  });
  res.json(emp);
});

router.post('/:id/photo', photoUpload.single('photo'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
  const photoUrl = `/uploads/photos/${req.file.filename}`;
  const emp = await prisma.employee.update({
    where: { id: parseInt(req.params.id) },
    data: { photoUrl },
  });
  res.json({ photoUrl: emp.photoUrl });
});

export default router;
