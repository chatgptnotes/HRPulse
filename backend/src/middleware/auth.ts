import { Request, Response, NextFunction } from 'express';
import { verifyToken, bearerFromHeader, safeCompare, type TokenPayload } from '../services/authService';

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
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearerFromHeader(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

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
