import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/// Password hashing and token issuing. Kept free of Express and Prisma so the
/// security-critical logic is directly unit-testable.

const BCRYPT_ROUNDS = 12;

/** Hours a token stays valid. Short enough that a leaked token expires. */
export const TOKEN_TTL_HOURS = 12;

export interface TokenPayload {
  /** User id. */
  sub: number;
  email: string;
  role: string;
}

/**
 * The signing secret.
 *
 * Throws rather than falling back to a default. A hardcoded development secret
 * that reaches production means anyone who has read the source can mint valid
 * tokens — so refusing to boot is the safer failure.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. Generate one with: openssl rand -base64 48'
    );
  }
  return secret;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function issueToken(payload: TokenPayload, secret = getAuthSecret()): string {
  return jwt.sign(payload, secret, { expiresIn: `${TOKEN_TTL_HOURS}h` });
}

/** Returns the payload, or null for any invalid, tampered or expired token. */
export function verifyToken(token: string, secret = getAuthSecret()): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'string') return null;
    const { sub, email, role } = decoded as jwt.JwtPayload & Partial<TokenPayload>;
    if (typeof sub !== 'number' || typeof email !== 'string' || typeof role !== 'string') return null;
    return { sub, email, role };
  } catch {
    return null;
  }
}

/** Extract a bearer token from an Authorization header. */
export function bearerFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Constant-time string comparison, for the machine ingest key.
 *
 * A plain `===` on a secret leaks its prefix through timing. Node's
 * `crypto.timingSafeEqual` needs equal-length buffers, so length is compared
 * first — that leaks only the length, not the contents.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { timingSafeEqual } = require('crypto') as typeof import('crypto');
  return timingSafeEqual(bufA, bufB);
}
