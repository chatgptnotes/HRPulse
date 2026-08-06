import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { hashPassword, verifyPassword, issueToken, TOKEN_TTL_HOURS } from '../services/authService';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 *
 * Returns the same message for "no such user", "wrong password" and "account
 * disabled" — distinguishing them tells an attacker which addresses are real.
 * A dummy hash comparison runs on the no-user path so response time does not
 * reveal it either.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.Jm/n0dGoaHGqcVQmvGZ1234567890abc';

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

  const ok = user
    ? user.isActive && (await verifyPassword(password, user.passwordHash))
    : (await verifyPassword(password, DUMMY_HASH), false);

  if (!ok || !user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = issueToken({ sub: user.id, email: user.email, role: user.role });
  res.json({
    token,
    expiresInHours: TOKEN_TTL_HOURS,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

/** GET /api/auth/me — who the current token belongs to. */
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Account no longer active' });
    return;
  }

  res.json(user);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'New password must be at least 12 characters'),
});

/** POST /api/auth/change-password — for the signed-in user only. */
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });

  // The old token stays valid until it expires — there is no revocation list.
  res.json({ ok: true });
});

// ── User administration (admin only) ─────────────────────────────────────────

router.get('/users', requireAuth, requireRole('admin'), async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: { email: 'asc' },
  });
  res.json(users);
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  role: z.enum(['admin', 'hr']).default('hr'),
});

router.post('/users', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  const { email, name, password, role } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) {
    res.status(409).json({ error: 'A user with that email already exists' });
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      name,
      role,
      passwordHash: await hashPassword(password),
    },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  res.status(201).json(user);
});

/** Deactivate rather than delete, so audit trails keep resolving. */
router.patch('/users/:id/active', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const isActive = req.body?.isActive;

  if (Number.isNaN(id) || typeof isActive !== 'boolean') {
    res.status(400).json({ error: 'isActive (boolean) is required' });
    return;
  }

  if (id === req.user!.sub && !isActive) {
    res.status(400).json({ error: 'You cannot deactivate your own account' });
    return;
  }

  const user = await prisma.user.update({
    where: { id },
    data: { isActive },
    select: { id: true, email: true, isActive: true },
  });

  res.json(user);
});

export default router;
