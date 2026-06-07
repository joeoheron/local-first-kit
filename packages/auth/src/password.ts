/**
 * Password hashing utilities using Web Crypto API.
 *
 * Uses PBKDF2 (HMAC-SHA256) with 600,000 iterations for password hashing.
 * This runs natively in Cloudflare Workers and modern browsers — no native
 * module dependency needed. @oslojs/encoding provides hex encode/decode helpers.
 *
 * Format: `pbkdf2:iterations:salt(hex):hash(hex)`
 */
import { encodeHexLowerCase, decodeHex } from "@oslojs/encoding";

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16; // 128 bits
const HASH_LENGTH = 32; // 256 bits

/**
 * Hash a plaintext password using PBKDF2-SHA256.
 * Returns a string in the format `pbkdf2:iterations:salt(hex):hash(hex)`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_LENGTH * 8,
  );

  const hash = new Uint8Array(derivedBits);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${encodeHexLowerCase(salt)}:${encodeHexLowerCase(hash)}`;
}

/**
 * Verify a plaintext password against a stored hash.
 * The stored hash must be in the format `pbkdf2:iterations:salt(hex):hash(hex)`.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    throw new Error("Invalid password hash format");
  }

  const iterations = parseInt(parts[1]!, 10);
  const salt = decodeHex(parts[2]!);
  const expectedHash = decodeHex(parts[3]!);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    HASH_LENGTH * 8,
  );

  const actualHash = new Uint8Array(derivedBits);

  // Constant-time comparison
  if (actualHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash[i]! ^ expectedHash[i]!;
  }
  return diff === 0;
}