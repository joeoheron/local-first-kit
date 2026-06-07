import { describe, expect, it } from 'vitest';

import {
  createSession,
  validateAccessToken,
  refreshSession,
  hashRefreshToken,
  verifyRefreshToken,
  isRefreshTokenExpired,
  createRefreshTokenRecord,
} from './session.js';
import type { JwtConfig } from './jwt.js';

const config: JwtConfig = {
  secret: new TextEncoder().encode('test-secret-at-least-32-bytes-long!!'),
  issuer: 'test-issuer',
  expiresInSeconds: 60,
};

const expiredConfig: JwtConfig = { ...config, expiresInSeconds: -60 };

describe('createSession', () => {
  it('returns all expected fields', () => {
    const session = createSession(config, 'user-1');

    expect(typeof session.accessToken).toBe('string');
    expect(typeof session.refreshToken).toBe('string');
    expect(typeof session.refreshTokenHash).toBe('string');
    expect(session.accessTokenExpiresAt).toBeInstanceOf(Date);
    expect(session.refreshTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('accessToken is a valid JWT accepted by validateAccessToken', () => {
    const session = createSession(config, 'user-1');
    const result = validateAccessToken(config, session.accessToken);

    expect(result?.userId).toBe('user-1');
  });

  it('refreshTokenHash matches hashRefreshToken(refreshToken)', () => {
    const session = createSession(config, 'user-1');
    expect(session.refreshTokenHash).toBe(hashRefreshToken(session.refreshToken));
  });

  it('refreshTokenExpiresAt is approximately 30 days in the future', () => {
    const before = Date.now();
    const session = createSession(config, 'user-1');
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    expect(session.refreshTokenExpiresAt.getTime()).toBeGreaterThan(before + thirtyDaysMs - 5000);
    expect(session.refreshTokenExpiresAt.getTime()).toBeLessThan(before + thirtyDaysMs + 5000);
  });

  it('two calls produce different refresh tokens', () => {
    const a = createSession(config, 'user-1');
    const b = createSession(config, 'user-1');
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});

describe('validateAccessToken', () => {
  it('returns claims for a fresh session access token', () => {
    const session = createSession(config, 'user-42');
    const result = validateAccessToken(config, session.accessToken);
    expect(result?.userId).toBe('user-42');
  });

  it('returns null for expired token', () => {
    const session = createSession(expiredConfig, 'user-1');
    expect(validateAccessToken(config, session.accessToken)).toBeNull();
  });

  it('returns null for tampered token', () => {
    const session = createSession(config, 'user-1');
    const parts = session.accessToken.split('.');
    const tampered = parts[1]!.slice(0, -1) + (parts[1]!.endsWith('A') ? 'B' : 'A');
    expect(validateAccessToken(config, `${parts[0]}.${tampered}.${parts[2]}`)).toBeNull();
  });
});

describe('refreshSession', () => {
  it('returns new SessionTokens with a valid access token', () => {
    const session = refreshSession(config, 'user-1');
    expect(validateAccessToken(config, session.accessToken)?.userId).toBe('user-1');
  });

  it('two calls produce different refresh tokens', () => {
    const a = refreshSession(config, 'user-1');
    const b = refreshSession(config, 'user-1');
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
});

describe('hashRefreshToken', () => {
  it('returns a non-empty string', () => {
    expect(hashRefreshToken('some-token').length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });
});

describe('verifyRefreshToken', () => {
  it('returns true for matching token and hash', () => {
    const token = 'raw-token-value';
    const hash = hashRefreshToken(token);
    expect(verifyRefreshToken(token, hash)).toBe(true);
  });

  it('returns false for wrong token', () => {
    const hash = hashRefreshToken('correct-token');
    expect(verifyRefreshToken('wrong-token', hash)).toBe(false);
  });

  it('returns false for empty token', () => {
    const hash = hashRefreshToken('real-token');
    expect(verifyRefreshToken('', hash)).toBe(false);
  });
});

describe('isRefreshTokenExpired', () => {
  it('returns true for a record with expiresAt in the past', () => {
    const record = createRefreshTokenRecord('u', 'h', new Date(Date.now() - 1000));
    expect(isRefreshTokenExpired(record)).toBe(true);
  });

  it('returns false for a record with expiresAt in the future', () => {
    const record = createRefreshTokenRecord('u', 'h', new Date(Date.now() + 60_000));
    expect(isRefreshTokenExpired(record)).toBe(false);
  });
});

describe('createRefreshTokenRecord', () => {
  it('returns a record with all required fields', () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const record = createRefreshTokenRecord('user-1', 'hash-abc', expiresAt);

    expect(record.userId).toBe('user-1');
    expect(record.tokenHash).toBe('hash-abc');
    expect(typeof record.issuedAt).toBe('string');
    expect(typeof record.expiresAt).toBe('string');
  });

  it('issuedAt is approximately now', () => {
    const before = new Date();
    const record = createRefreshTokenRecord('u', 'h', new Date());
    const issuedAt = new Date(record.issuedAt);
    expect(issuedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('expiresAt matches the provided Date', () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    const record = createRefreshTokenRecord('u', 'h', expiresAt);
    expect(record.expiresAt).toBe(expiresAt.toISOString());
  });
});
