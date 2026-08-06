import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import { processPunchesForRange, DEFAULT_HALF_DAY_RATIO } from '../services/attendanceEngine';
import { monthBounds } from '../services/shiftService';

const router = Router();

const punchSchema = z.object({
  /** Preferred: the Adamrit ledger ID the device now carries. */
  adamritLedgerId: z.string().min(1).optional(),
  /** Fallback during the migration, while devices still hold the old number. */
  employeeNumber: z.string().min(1).optional(),
  /** Escape hatch for internal callers. */
  employeeId: z.number().int().positive().optional(),
  punchTime: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)),
  punchType: z.enum(['IN', 'OUT']),
  deviceId: z.string().optional(),
}).refine(
  p => !!(p.adamritLedgerId || p.employeeNumber || p.employeeId),
  { message: 'One of adamritLedgerId, employeeNumber or employeeId is required' }
);

const ingestSchema = z.object({ punches: z.array(punchSchema).min(1).max(10_000) });

/**
 * POST /api/punches/ingest
 *
 * Accepts raw biometric events. Idempotent: the (employeeId, punchTime,
 * punchType) unique constraint plus skipDuplicates means replaying an export is
 * a no-op rather than a doubled punch stream.
 *
 * Unmatched punches are reported back, never silently dropped — an unrecognised
 * device ID is the signal that an employee is not linked yet, which is exactly
 * what the ledger-ID migration needs to surface.
 */
router.post('/ingest', async (req: Request, res: Response) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const { punches } = parsed.data;

  const ledgerIds = punches.map(p => p.adamritLedgerId).filter((v): v is string => !!v);
  const employeeNumbers = punches.map(p => p.employeeNumber).filter((v): v is string => !!v);

  const employees = await prisma.employee.findMany({
    where: {
      OR: [
        ledgerIds.length ? { adamritLedgerId: { in: ledgerIds } } : undefined,
        employeeNumbers.length ? { employeeNumber: { in: employeeNumbers } } : undefined,
      ].filter(Boolean) as object[],
    },
    select: { id: true, adamritLedgerId: true, employeeNumber: true },
  });

  const byLedger = new Map(employees.filter(e => e.adamritLedgerId).map(e => [e.adamritLedgerId!, e.id]));
  const byNumber = new Map(employees.filter(e => e.employeeNumber).map(e => [e.employeeNumber!, e.id]));

  const rows: Array<{ employeeId: number; punchTime: Date; punchType: string; deviceId: string | null }> = [];
  const unmatched: Array<{ identifier: string; punchTime: string }> = [];

  for (const p of punches) {
    const employeeId =
      p.employeeId ??
      (p.adamritLedgerId ? byLedger.get(p.adamritLedgerId) : undefined) ??
      (p.employeeNumber ? byNumber.get(p.employeeNumber) : undefined);

    if (!employeeId) {
      unmatched.push({ identifier: p.adamritLedgerId ?? p.employeeNumber ?? 'unknown', punchTime: p.punchTime });
      continue;
    }

    rows.push({
      employeeId,
      punchTime: new Date(p.punchTime),
      punchType: p.punchType,
      deviceId: p.deviceId ?? null,
    });
  }

  const { count } = rows.length
    ? await prisma.biometricPunch.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };

  res.json({
    received: punches.length,
    inserted: count,
    duplicatesSkipped: rows.length - count,
    unmatchedCount: unmatched.length,
    unmatched: unmatched.slice(0, 50),
  });
});

const processSchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employeeIds: z.array(z.number().int().positive()).optional(),
  markAbsent: z.boolean().optional(),
  halfDayRatio: z.number().gt(0).lte(1).optional(),
}).refine(
  v => !!v.periodMonth || (!!v.from && !!v.to),
  { message: 'Provide either periodMonth, or both from and to' }
);

/**
 * POST /api/punches/process
 *
 * Runs the shift-evaluation engine over stored punches and upserts the derived
 * AttendanceRecord rows. Safe to re-run: the (employeeId, recordDate) unique key
 * makes every write an update.
 */
router.post('/process', async (req: Request, res: Response) => {
  const parsed = processSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const { periodMonth, employeeIds, markAbsent, halfDayRatio } = parsed.data;
  const range = periodMonth ? monthBounds(periodMonth) : { from: parsed.data.from!, to: parsed.data.to! };

  try {
    const result = await processPunchesForRange({
      from: range.from,
      to: range.to,
      employeeIds,
      markAbsent: markAbsent ?? false,
      halfDayRatio: halfDayRatio ?? DEFAULT_HALF_DAY_RATIO,
    });
    res.json(result);
  } catch (err) {
    console.error('Punch processing error:', err);
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/punches/:employeeId?from=&to= — raw punches, for verification. */
router.get('/:employeeId', async (req: Request, res: Response) => {
  const employeeId = parseInt(req.params.employeeId);
  if (Number.isNaN(employeeId)) {
    res.status(400).json({ error: 'Invalid employeeId' });
    return;
  }

  const { from, to } = req.query as { from?: string; to?: string };
  const punches = await prisma.biometricPunch.findMany({
    where: {
      employeeId,
      ...(from && to
        ? { punchTime: { gte: new Date(`${from}T00:00:00.000Z`), lt: new Date(`${to}T23:59:59.999Z`) } }
        : {}),
    },
    orderBy: { punchTime: 'asc' },
  });

  res.json(punches);
});

export default router;
