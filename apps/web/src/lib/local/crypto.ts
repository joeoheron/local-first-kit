/**
 * Client-side crypto helpers for passkey-derived OPFS encryption.
 *
 * PRF extension: a passkey can produce a deterministic pseudo-random output
 * for a given salt. We use that output to derive an AES-256-GCM key via HKDF,
 * then store the derived key in sessionStorage (cleared on tab close).
 *
 * If the authenticator doesn't support PRF (Firefox, some hardware keys),
 * loadStorageKey() returns null and the persister runs unencrypted — no error.
 */

import { STORAGE_KEYS, spaceKeyStorageKey } from './storageKeys.js';
import { PRF_SALT_STRING, TOKEN_WRAP_SALT } from '@local-first-kit/config';

/** Fixed salt for PRF extension — identifies this app's storage key derivation. */
export const PRF_SALT = new TextEncoder().encode(PRF_SALT_STRING);

const SESSION_KEY = STORAGE_KEYS.storageKey;

/**
 * Derive an AES-256-GCM encryption key from a passkey PRF output.
 * Uses HKDF-SHA256 with userId as salt to make the key user-specific.
 */
export async function deriveStorageKey(prfOutput: ArrayBuffer, userId: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(userId),
      info: new TextEncoder().encode('storage-encryption'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** Export the encryption key to sessionStorage (survives page refresh, cleared on tab close). */
export async function storeStorageKey(key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
  sessionStorage.setItem(SESSION_KEY, base64);
}

/** Load the encryption key from sessionStorage. Returns null if not present. */
export async function loadStorageKey(): Promise<CryptoKey | null> {
  const base64 = sessionStorage.getItem(SESSION_KEY);
  if (!base64) return null;
  try {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

/** Clear the stored encryption key (on logout). */
export function clearStorageKey(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

// ---- Key generation ----

/** Generate a fresh random AES-256-GCM key. */
export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// ---- Key wrapping (AES-GCM, consistent with encryptedPersister.ts) ----

/** Wrap a CryptoKey with a wrapping key. Returns base64(iv + ciphertext). */
export async function wrapKey(keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', keyToWrap);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...result));
}

/** Unwrap a base64(iv + ciphertext) wrapped key. */
export async function unwrapKey(wrapped: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const data = Uint8Array.from(atob(wrapped), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ciphertext);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// ---- Cell-level encryption ----

const CELL_PREFIX = 'enc:';

/** Encrypt a cell value string with the room key. Returns 'enc:' + base64(iv + ciphertext). */
export async function encryptCell(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(value);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return CELL_PREFIX + btoa(String.fromCharCode(...result));
}

/** Decrypt a cell value. Returns the original string. No-op if value is not prefixed. */
export async function decryptCell(value: string, key: CryptoKey): Promise<string> {
  if (!value.startsWith(CELL_PREFIX)) return value;
  const data = Uint8Array.from(atob(value.slice(CELL_PREFIX.length)), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/** Derive an AES-256-GCM wrapping key from a raw API token via HKDF-SHA256. */
export async function deriveTokenWrappingKey(rawToken: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rawToken), 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256',
      salt: new TextEncoder().encode(TOKEN_WRAP_SALT),
      info: new TextEncoder().encode('wrap') },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---- Device key sessionStorage helpers ----

const DEVICE_KEY_SESSION = STORAGE_KEYS.deviceKey;

export async function storeDeviceKey(key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(DEVICE_KEY_SESSION, btoa(String.fromCharCode(...new Uint8Array(raw))));
}

export async function loadDeviceKey(): Promise<CryptoKey | null> {
  const base64 = sessionStorage.getItem(DEVICE_KEY_SESSION);
  if (!base64) return null;
  try {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

export function clearDeviceKey(): void {
  sessionStorage.removeItem(DEVICE_KEY_SESSION);
}

// ---- Space key sessionStorage helpers ----

export async function storeSpaceKey(spaceId: string, key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem(spaceKeyStorageKey(spaceId), btoa(String.fromCharCode(...new Uint8Array(raw))));
}

export async function loadSpaceKey(spaceId: string): Promise<CryptoKey | null> {
  const base64 = sessionStorage.getItem(spaceKeyStorageKey(spaceId));
  if (!base64) return null;
  try {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

export function clearSpaceKey(spaceId: string): void {
  sessionStorage.removeItem(spaceKeyStorageKey(spaceId));
}

// ---- ECDH key exchange (device-link ceremony) ----

/** Generate an ephemeral P-256 ECDH key pair. */
export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

/** Export a P-256 public key as base64 for transmission. */
export async function exportEcdhPublicKey(publicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

/** Import a base64 P-256 public key received from the other device. */
export async function importEcdhPublicKey(base64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

/** Derive a shared AES-256-GCM key from an ECDH private key and the peer's public key via HKDF. */
export async function deriveSharedKey(privateKey: CryptoKey, peerPublicKey: CryptoKey): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256);
  const keyMaterial = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('device-link') },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive a proof-of-possession token from the device-link ECDH shared secret.
 * Both devices compute the same value; only a holder of an ECDH private key matching
 * the bound public keys can produce it. Distinct HKDF `info` from deriveSharedKey so
 * this token is independent of the key-wrapping key. Returns base64 of 32 bytes.
 */
export async function deriveDeviceLinkPopToken(privateKey: CryptoKey, peerPublicKey: CryptoKey): Promise<string> {
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, privateKey, 256);
  const keyMaterial = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
  const tokenBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('device-link-pop') },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(tokenBits)));
}

/** SHA-256 of a string's UTF-8 bytes, base64-encoded. Used to commit to / verify the PoP token. */
export async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/**
 * A short, human-comparable code derived deterministically from a device's ECDH
 * public key. Both the new device and the approving device compute the same code, so
 * the user can confirm they match before approving — defeating approval of a device
 * they did not initiate. Returns a zero-padded 6-digit string.
 */
export async function deviceLinkVerificationCode(ecdhPublicKeyB64: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ecdhPublicKeyB64)));
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return (n % 1_000_000).toString().padStart(6, '0');
}

// sessionStorage helpers for the ephemeral ECDH private key (5-min device-link window)

const ECDH_PRIVATE_KEY_SESSION = STORAGE_KEYS.ecdhPrivateKey;

export async function storeEcdhPrivateKey(key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('pkcs8', key);
  sessionStorage.setItem(ECDH_PRIVATE_KEY_SESSION, btoa(String.fromCharCode(...new Uint8Array(raw))));
}

export async function loadEcdhPrivateKey(): Promise<CryptoKey | null> {
  const base64 = sessionStorage.getItem(ECDH_PRIVATE_KEY_SESSION);
  if (!base64) return null;
  try {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return await crypto.subtle.importKey('pkcs8', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  } catch {
    return null;
  }
}

export function clearEcdhPrivateKey(): void {
  sessionStorage.removeItem(ECDH_PRIVATE_KEY_SESSION);
}

// ---- Identity key (ECDSA P-256 signing) ----

export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
}

export async function exportIdentityPublicKey(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(spki)));
}

/** Wrap a pkcs8-exportable key with an AES-GCM wrapping key. Same iv+ciphertext format as wrapKey. */
export async function wrapKeyPkcs8(keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyToWrap);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, pkcs8);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...result));
}

/** Unwrap a pkcs8 key. Algorithm and usages must match the original key. */
export async function unwrapKeyPkcs8(
  wrapped: string,
  wrappingKey: CryptoKey,
  algorithm: EcKeyImportParams,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const data = Uint8Array.from(atob(wrapped), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ciphertext);
  return crypto.subtle.importKey('pkcs8', pkcs8, algorithm, true, usages);
}

const IDENTITY_KEY_SESSION = STORAGE_KEYS.identityKey;

export async function storeIdentityKey(key: CryptoKey): Promise<void> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
  sessionStorage.setItem(IDENTITY_KEY_SESSION, btoa(String.fromCharCode(...new Uint8Array(pkcs8))));
}

export async function loadIdentityKey(): Promise<CryptoKey | null> {
  const base64 = sessionStorage.getItem(IDENTITY_KEY_SESSION);
  if (!base64) return null;
  try {
    const pkcs8 = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'pkcs8', pkcs8,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, ['sign'],
    );
  } catch {
    return null;
  }
}

export function clearIdentityKey(): void {
  sessionStorage.removeItem(IDENTITY_KEY_SESSION);
}

// ---- Long-term ECDH prekey (for invite space-key delivery) ----

/** Derive a shared AES-256-GCM key for the invite flow. Uses 'space-invite' HKDF info
 *  to prevent cross-protocol key reuse with the 'device-link' deriveSharedKey. */
export async function deriveInviteSharedKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  );
  const keyMaterial = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('space-invite'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const ENC_PRIV_KEY_SESSION = STORAGE_KEYS.encPrivKey;

export async function storeEncPrivKey(key: CryptoKey): Promise<void> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
  sessionStorage.setItem(ENC_PRIV_KEY_SESSION, btoa(String.fromCharCode(...new Uint8Array(pkcs8))));
}

export async function loadEncPrivKey(): Promise<CryptoKey | null> {
  const b64 = sessionStorage.getItem(ENC_PRIV_KEY_SESSION);
  if (!b64) return null;
  try {
    const pkcs8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'pkcs8', pkcs8,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
  } catch { return null; }
}

export function clearEncPrivKey(): void {
  sessionStorage.removeItem(ENC_PRIV_KEY_SESSION);
}
