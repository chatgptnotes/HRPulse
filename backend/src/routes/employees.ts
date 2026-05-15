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

router.patch('/:id', async (req: Request, res: Response) => {
  const { name, email, department, designation } = req.body;
  const emp = await prisma.employee.update({
    where: { id: parseInt(req.params.id) },
    data: { ...(name && { name }), ...(email && { email }), ...(department && { department }), ...(designation && { designation }) },
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
