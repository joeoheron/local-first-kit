import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

// Note: PBKDF2 at 600k iterations — each hashPassword/verifyPassword call ~200ms.
// This is expected for a security primitive.

describe('hashPassword', () => {
  it('returns a string in pbkdf2:iterations:salt:hash format', async () => {
    const hash = await hashPassword('secret');
    expect(hash).toMatch(/^pbkdf2:600000:[0-9a-f]+:[0-9a-f]+$/);
  }, 10_000);

  it('produces different hashes for the same password (random salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('secret'), hashPassword('secret')]);
    expect(a).not.toBe(b);
  }, 10_000);
});

describe('verifyPassword', () => {
  it('returns true for the correct password', async () => {
    const hash = await hashPassword('my-password');
    expect(await verifyPassword('my-password', hash)).toBe(true);
  }, 10_000);

  it('returns false for the wrong password', async () => {
    const hash = await hashPassword('correct');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  }, 10_000);

  it('returns false for an empty string against a real hash', async () => {
    const hash = await hashPassword('something');
    expect(await verifyPassword('', hash)).toBe(false);
  }, 10_000);

  it('throws for a malformed hash string', async () => {
    await expect(verifyPassword('pass', 'notahash')).rejects.toThrow('Invalid password hash format');
    await expect(verifyPassword('pass', 'wrong:prefix:abc:def')).rejects.toThrow('Invalid password hash format');
    await expect(verifyPassword('pass', '')).rejects.toThrow('Invalid password hash format');
  });
});
