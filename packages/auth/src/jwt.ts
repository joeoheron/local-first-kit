/**
 * JWT creation and verification using @oslojs/jwt.
 *
 * Short-lived JWTs (5-15 min) signed with HS256.
 * Tokens are self-verifying — no key-value session store needed.
 * Each Durable Object verifies the JWT signature locally and
 * makes its own authorization decision.
 *
 * In Cloudflare Workers, the JWT secret comes from environment bindings.
 */
import {
  encodeJWT,
  createJWTSignatureMessage,
  parseJWT,
  JWTRegisteredClaims,
  joseAlgorithmHS256,
} from "@oslojs/jwt";
import { hmac } from "@oslojs/crypto/hmac";
import { SHA256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

/** JWT payload for our auth tokens. */
export interface AuthJwtPayload {
  /** Subject — the user ID */
  sub: string;
  /** Issued at (Unix seconds) */
  iat: number;
  /** Expiration (Unix seconds) */
  exp: number;
  /** Issuer */
  iss: string;
  /** Unique token identifier for refresh rotation */
  jti: string;
}

/** Result of a successful JWT verification. */
export interface VerifiedJwt {
  userId: string;
  tokenId: string;
  expiresAt: Date;
  issuedAt: Date;
}

/** Configuration for JWT operations. Passed from Worker environment. */
export interface JwtConfig {
  /** Secret key for HS256 signing (at least 256 bits / 32 bytes recommended) */
  secret: Uint8Array;
  /** Issuer claim — set via APP_ID in packages/config/src/index.ts */
  issuer: string;
  /** Token lifetime in seconds — default 900 (15 minutes) */
  expiresInSeconds?: number;
}

const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60; // 15 minutes

/**
 * Create a signed JWT for a given user.
 *
 * @param config - JWT configuration (secret, issuer, expiry)
 * @param userId - The user ID to issue the token for
 * @param tokenId - Unique token identifier (generate with generateTokenId)
 * @returns The encoded JWT string
 */
export function createJwt(
  config: JwtConfig,
  userId: string,
  tokenId: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = config.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS;

  const header = { alg: joseAlgorithmHS256, typ: "JWT" };
  const payload: AuthJwtPayload = {
    sub: userId,
    iat: now,
    exp: now + expiresIn,
    iss: config.issuer,
    jti: tokenId,
  };

  const headerJSON = JSON.stringify(header);
  const payloadJSON = JSON.stringify(payload);

  const signatureMessage = createJWTSignatureMessage(headerJSON, payloadJSON);
  const signature = hmac(SHA256, config.secret, signatureMessage);

  return encodeJWT(headerJSON, payloadJSON, signature);
}

/**
 * Verify and decode a JWT.
 *
 * @returns The verified claims, or null if the token is invalid or expired.
 */
export function verifyJwt(config: JwtConfig, token: string): VerifiedJwt | null {
  let header: object;
  let payload: object;
  let providedSignature: Uint8Array;
  let signatureMessage: Uint8Array;

  try {
    [header, payload, providedSignature, signatureMessage] = parseJWT(token);
  } catch {
    return null;
  }

  if (!("alg" in header) || header.alg !== joseAlgorithmHS256) {
    return null;
  }

  const expectedSignature = hmac(SHA256, config.secret, signatureMessage);
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  const claims = new JWTRegisteredClaims(payload);

  if (!claims.verifyExpiration()) {
    return null;
  }

  if (claims.hasNotBefore() && !claims.verifyNotBefore()) {
    return null;
  }

  if (!claims.hasSubject() || !claims.hasJWTId()) {
    return null;
  }

  return {
    userId: claims.subject(),
    tokenId: claims.jwtId(),
    expiresAt: claims.expiration(),
    issuedAt: claims.hasIssuedAt() ? claims.issuedAt() : new Date(0),
  };
}

/** JWT payload for space-scoped DO tokens. */
export interface SpaceJwtPayload {
  sub: string;          // userId
  iss: string;
  iat: number;
  exp: number;
  jti: string;          // tokenId (for revocation)
  space: string;        // spaceId
  role: string;         // 'owner' | 'member'
  writeTables: string[]; // ['*'] for owner, ['todos'] etc. for member, [] for viewer
}

/** Result of a successful space JWT verification. */
export interface VerifiedSpaceJwt {
  userId: string;
  tokenId: string;
  spaceId: string;
  role: string;
  writeTables: string[];
  expiresAt: Date;
}

/**
 * Create a short-lived space-scoped JWT for Durable Object access.
 * Minted by the sync proxy after verifying space membership.
 * writeTables encodes which tables the bearer may write to ('*' = all).
 */
export function createSpaceJwt(
  config: JwtConfig,
  userId: string,
  tokenId: string,
  spaceId: string,
  role: string,
  writeTables: string[],
): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = config.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS;

  const header = { alg: joseAlgorithmHS256, typ: "JWT" };
  const payload: SpaceJwtPayload = {
    sub: userId,
    iat: now,
    exp: now + expiresIn,
    iss: config.issuer,
    jti: tokenId,
    space: spaceId,
    role,
    writeTables,
  };

  const headerJSON = JSON.stringify(header);
  const payloadJSON = JSON.stringify(payload);
  const signatureMessage = createJWTSignatureMessage(headerJSON, payloadJSON);
  const signature = hmac(SHA256, config.secret, signatureMessage);
  return encodeJWT(headerJSON, payloadJSON, signature);
}

/**
 * Verify and decode a space JWT.
 * Returns null if the token is invalid, expired, or missing space claims.
 */
export function verifySpaceJwt(config: JwtConfig, token: string): VerifiedSpaceJwt | null {
  let header: object;
  let payload: object;
  let providedSignature: Uint8Array;
  let signatureMessage: Uint8Array;

  try {
    [header, payload, providedSignature, signatureMessage] = parseJWT(token);
  } catch {
    return null;
  }

  if (!("alg" in header) || header.alg !== joseAlgorithmHS256) {
    return null;
  }

  const expectedSignature = hmac(SHA256, config.secret, signatureMessage);
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  const claims = new JWTRegisteredClaims(payload);

  if (!claims.verifyExpiration()) return null;
  if (claims.hasNotBefore() && !claims.verifyNotBefore()) return null;
  if (!claims.hasSubject() || !claims.hasJWTId()) return null;

  const raw = payload as { space?: unknown; role?: unknown; writeTables?: unknown };
  const spaceId = typeof raw.space === "string" ? raw.space : null;
  const role = typeof raw.role === "string" ? raw.role : null;
  if (!spaceId || !role) return null;

  const writeTables = Array.isArray(raw.writeTables) &&
    raw.writeTables.every((t): t is string => typeof t === 'string')
    ? raw.writeTables
    : [];

  return {
    userId: claims.subject(),
    tokenId: claims.jwtId(),
    spaceId,
    role,
    writeTables,
    expiresAt: claims.expiration(),
  };
}

/**
 * Generate a unique token identifier for JWT rotation and refresh tokens.
 * Uses crypto.getRandomValues for cryptographic randomness.
 */
export function generateTokenId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeHexLowerCase(bytes);
}

/** Constant-time comparison to prevent timing attacks. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}
