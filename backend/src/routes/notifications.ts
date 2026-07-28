import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendManualHrNotification } from '../services/hrNotificationService';

const router = Router();

const manualNotificationSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  type: z.string().trim().min(1).max(80).optional().default('personal'),
  severity: z.enum(['info', 'success', 'warning', 'critical']).optional().default('info'),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  sentBy: z.string().trim().min(1).max(120).optional().default('HR Admin'),
});

function sendError(res: Response, err: any) {
  const message = String(err?.message || err || 'Notification failed');
  if (/hr_notifications|schema cache|does not exist/i.test(message)) {
    res.status(503).json({
      error: 'HR notification table is not installed. Run backend/supabase/migrations/20260722_ess_integration.sql in the HRPulse Supabase SQL Editor.',
    });
    return;
  }
  if (/employee not found/i.test(message)) {
    res.status(404).json({ error: message });
    return;
  }
  if (/employee email is required/i.test(message)) {
    res.status(409).json({ error: message });
    return;
  }
  res.status(500).json({ error: message });
}

router.post('/send', async (req: Request, res: Response) => {
  try {
    const parsed = manualNotificationSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const result = await sendManualHrNotification(parsed.data);
    res.status(201).json(result);
  } catch (err: any) {
    sendError(res, err);
  }
});

export default router;
