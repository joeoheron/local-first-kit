import { describe, expect, it } from 'vitest';

import {
  createJwt,
  verifyJwt,
  createSpaceJwt,
  verifySpaceJwt,
  generateTokenId,
  type JwtConfig,
} from './jwt.js';

const config: JwtConfig = {
  secret: new TextEncoder().encode('test-secret-at-least-32-bytes-long!!'),
  issuer: 'test-issuer',
  expiresInSeconds: 60,
};

const expiredConfig: JwtConfig = { ...config, expiresInSeconds: -60 };
const wrongSecretConfig: JwtConfig = {
  ...config,
  secret: new TextEncoder().encode('different-secret-at-least-32-bytes!'),
};

describe('generateTokenId', () => {
  it('returns a 64-character lowercase hex string', () => {
    const id = generateTokenId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns unique values', () => {
    expect(generateTokenId()).not.toBe(generateTokenId());
  });
});

describe('createJwt', () => {
  it('returns a three-part dot-separated string', () => {
    const token = createJwt(config, 'user-1', 'token-1');
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes correct claims in the payload', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = createJwt(config, 'user-abc', 'jti-xyz');
    const payloadJson = atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);

    expect(payload.sub).toBe('user-abc');
    expect(payload.jti).toBe('jti-xyz');
    expect(payload.iss).toBe('test-issuer');
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.exp).toBe(payload.iat + 60);
  });
});

describe('verifyJwt', () => {
  it('round-trips userId and tokenId', () => {
    const token = createJwt(config, 'user-1', 'token-1');
    const result = verifyJwt(config, token);

    expect(result?.userId).toBe('user-1');
    expect(result?.tokenId).toBe('token-1');
  });

  it('returns expiresAt in the future and issuedAt near now', () => {
    const before = new Date();
    const token = createJwt(config, 'u', 't');
    const result = verifyJwt(config, token);

    expect(result?.expiresAt.getTime()).toBeGreaterThan(before.getTime());
    expect(result?.issuedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('rejects expired tokens', () => {
    const token = createJwt(expiredConfig, 'u', 't');
    expect(verifyJwt(config, token)).toBeNull();
  });

  it('rejects tokens signed with a different secret', () => {
    const token = createJwt(config, 'u', 't');
    expect(verifyJwt(wrongSecretConfig, token)).toBeNull();
  });

  it('rejects tampered payload', () => {
    const token = createJwt(config, 'u', 't');
    const [header, payload, sig] = token.split('.');
    // Flip a character in the payload
    const tampered = payload!.slice(0, -1) + (payload!.endsWith('A') ? 'B' : 'A');
    expect(verifyJwt(config, `${header}.${tampered}.${sig}`)).toBeNull();
  });

  it('rejects malformed strings', () => {
    expect(verifyJwt(config, 'not.a.jwt.at.all')).toBeNull();
    expect(verifyJwt(config, '')).toBeNull();
    expect(verifyJwt(config, 'abc')).toBeNull();
  });
});

describe('createSpaceJwt / verifySpaceJwt', () => {
  it('round-trips userId, tokenId, spaceId and role', () => {
    const token = createSpaceJwt(config, 'user-1', 'token-1', 'space-abc', 'owner', ['*']);
    const result = verifySpaceJwt(config, token);

    expect(result?.userId).toBe('user-1');
    expect(result?.tokenId).toBe('token-1');
    expect(result?.spaceId).toBe('space-abc');
    expect(result?.role).toBe('owner');
    expect(result?.writeTables).toEqual(['*']);
    expect(result?.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects a plain (non-space) JWT', () => {
    const token = createJwt(config, 'u', 't');
    expect(verifySpaceJwt(config, token)).toBeNull();
  });

  it('rejects expired space tokens', () => {
    const token = createSpaceJwt(expiredConfig, 'u', 't', 'space-1', 'member', ['todos']);
    expect(verifySpaceJwt(config, token)).toBeNull();
  });

  it('rejects wrong secret', () => {
    const token = createSpaceJwt(config, 'u', 't', 'space-1', 'member', []);
    expect(verifySpaceJwt(wrongSecretConfig, token)).toBeNull();
  });
});
