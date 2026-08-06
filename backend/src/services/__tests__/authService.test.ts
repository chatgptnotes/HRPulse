import { describe, it, expect, beforeAll } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
  bearerFromHeader,
  safeCompare,
  getAuthSecret,
} from '../authService';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const OTHER_SECRET = 'a-different-secret-also-32-characters-long!!';

describe('getAuthSecret', () => {
  it('refuses to run without a secret rather than using a default', () => {
    const original = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = original;
  });

  it('rejects a secret short enough to brute force', () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'too-short';
    expect(() => getAuthSecret()).toThrow(/32 characters/);
    process.env.AUTH_SECRET = original;
  });

  it('accepts a sufficiently long secret', () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
    expect(getAuthSecret()).toBe(SECRET);
    process.env.AUTH_SECRET = original;
  });
});

describe('password hashing', () => {
  let hash: string;

  beforeAll(async () => {
    hash = await hashPassword('correct horse battery staple');
  });

  it('never stores the password itself', () => {
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('accepts the right password', async () => {
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
  });

  it('salts — the same password hashes differently every time', async () => {
    const again = await hashPassword('correct horse battery staple');
    expect(again).not.toBe(hash);
    expect(await verifyPassword('correct horse battery staple', again)).toBe(true);
  });
});

describe('tokens', () => {
  const payload = { sub: 7, email: 'hr@example.com', role: 'admin' };

  it('round-trips a valid token', () => {
    const token = issueToken(payload, SECRET);
    expect(verifyToken(token, SECRET)).toMatchObject(payload);
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueToken(payload, OTHER_SECRET);
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = issueToken(payload, SECRET);
    const [header, body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, role: 'admin', sub: 999 }))
      .toString('base64url');
    expect(verifyToken([header, forged, sig].join('.'), SECRET)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'not-a-token', 'a.b.c', '...']) {
      expect(verifyToken(bad, SECRET)).toBeNull();
    }
  });

  it('rejects a token missing required claims', () => {
    const jwt = require('jsonwebtoken');
    const partial = jwt.sign({ sub: 1 }, SECRET);
    expect(verifyToken(partial, SECRET)).toBeNull();
  });

  it('rejects an already-expired token', () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign(payload, SECRET, { expiresIn: '-1s' });
    expect(verifyToken(expired, SECRET)).toBeNull();
  });
});

describe('bearerFromHeader', () => {
  it('extracts the token', () => {
    expect(bearerFromHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerFromHeader('bearer abc')).toBe('abc');
    expect(bearerFromHeader('  Bearer   abc  ')).toBe('abc');
  });

  it('returns null when there is no usable token', () => {
    for (const bad of [undefined, '', 'abc.def', 'Basic dXNlcjpwYXNz', 'Bearer']) {
      expect(bearerFromHeader(bad as string | undefined)).toBeNull();
    }
  });
});

describe('safeCompare', () => {
  it('matches identical strings', () => {
    expect(safeCompare('a-very-secret-key', 'a-very-secret-key')).toBe(true);
  });

  it('rejects differing strings, including by length', () => {
    expect(safeCompare('a-very-secret-key', 'a-very-secret-keY')).toBe(false);
    expect(safeCompare('short', 'a-very-secret-key')).toBe(false);
    expect(safeCompare('', 'x')).toBe(false);
  });

  it('does not throw on unequal lengths', () => {
    expect(() => safeCompare('a', 'abcdefghij')).not.toThrow();
  });
});
