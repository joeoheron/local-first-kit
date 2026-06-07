import {ENCRYPTED_FIELDS_BY_TABLE} from './access.js';

export interface DomainCrypto {
  encrypt(table: string, field: string, value: string): Promise<string>;
  decrypt(table: string, field: string, value: string): Promise<string>;
}

const CELL_PREFIX = 'enc:';

function isEncrypted(table: string, field: string): boolean {
  return ENCRYPTED_FIELDS_BY_TABLE[table]?.includes(field) ?? false;
}

async function encryptCell(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(value);
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, plaintext);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return CELL_PREFIX + btoa(String.fromCharCode(...result));
}

async function decryptCell(value: string, key: CryptoKey): Promise<string> {
  if (!value.startsWith(CELL_PREFIX)) return value;
  const data = Uint8Array.from(atob(value.slice(CELL_PREFIX.length)), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv}, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/** Create a domain crypto context bound to a space key for the current session. */
export function createDomainCrypto(spaceKey: CryptoKey): DomainCrypto {
  return {
    encrypt(table, field, value) {
      if (!isEncrypted(table, field)) return Promise.resolve(value);
      return encryptCell(value, spaceKey);
    },
    decrypt(table, field, value) {
      if (!isEncrypted(table, field)) return Promise.resolve(value);
      return decryptCell(value, spaceKey);
    },
  };
}
