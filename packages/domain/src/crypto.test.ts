import { describe, expect, it } from 'vitest';

import { createDomainCrypto } from './crypto';
import { TODO_TABLE } from './schema/todos';

async function makeSpaceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

describe('createDomainCrypto', () => {
  it('encrypts an encrypted field to an enc:-prefixed value and round-trips', async () => {
    const dc = createDomainCrypto(await makeSpaceKey());

    const ciphertext = await dc.encrypt(TODO_TABLE, 'text', 'buy milk');
    expect(ciphertext.startsWith('enc:')).toBe(true);
    expect(ciphertext).not.toContain('buy milk');

    const plaintext = await dc.decrypt(TODO_TABLE, 'text', ciphertext);
    expect(plaintext).toBe('buy milk');
  });

  it('passes non-encrypted fields through unchanged', async () => {
    const dc = createDomainCrypto(await makeSpaceKey());

    expect(await dc.encrypt(TODO_TABLE, 'completed', 'false')).toBe('false');
    expect(await dc.decrypt(TODO_TABLE, 'completed', 'false')).toBe('false');
  });

  it('uses a fresh IV per encryption (ciphertexts differ for the same input)', async () => {
    const dc = createDomainCrypto(await makeSpaceKey());

    const a = await dc.encrypt(TODO_TABLE, 'text', 'same');
    const b = await dc.encrypt(TODO_TABLE, 'text', 'same');
    expect(a).not.toBe(b);
  });
});
