import { Request, Response, NextFunction } from 'express';
import { verifyToken, bearerFromHeader, safeCompare, type TokenPayload } from '../services/authService';
import { createClient } from '@supabase/supabase-js';
import prisma from '../db/prisma';

const supabase = process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  : null;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. Absent on machine-authenticated requests. */
      user?: TokenPayload;
      /** True when the caller authenticated with the ingest API key. */
      isMachine?: boolean;
    }
  }
}

/**
 * Reject anything without a valid bearer token.
 *
 * Applied to every /api route except the explicit exemptions in index.ts, so
 * that a newly added route is protected by default rather than by remembering.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerFromHeader(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (supabase) {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user?.email) {
      const email = data.user.email.toLowerCase();
      const metadata = data.user.user_metadata || {};
      const existing = await prisma.user.findUnique({ where: { email } });
      const profile = existing || await prisma.user.create({
        data: {
          email,
          name: String(metadata.full_name || metadata.name || email.split('@')[0]),
          role: metadata.role === 'admin' ? 'admin' : 'hr',
          passwordHash: 'managed-by-supabase-auth',
        },
      });
      req.user = { sub: profile.id, email: profile.email, role: profile.role };
      next();
      return;
    }
  }

  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: 'Invalid or expired token' }); return; }
  req.user = payload;
  next();
}

/** Require an authenticated user with a specific role. */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Accept EITHER a user token OR the machine ingest key.
 *
 * A biometric device cannot log in with a password, so punch ingestion needs a
 * credential a device can hold. INGEST_API_KEY is that credential; it is scoped
 * to ingestion only and grants nothing else.
 *
 * If INGEST_API_KEY is unset, only user tokens are accepted — an unset key must
 * never mean "no check".
 */
export function requireAuthOrIngestKey(req: Request, res: Response, next: NextFunction): void {
  const provided = req.headers['x-api-key'];
  const expected = process.env.INGEST_API_KEY;

  if (typeof provided === 'string' && expected && expected.length >= 16 && safeCompare(provided, expected)) {
    req.isMachine = true;
    next();
    return;
  }

  requireAuth(req, res, next);
}
