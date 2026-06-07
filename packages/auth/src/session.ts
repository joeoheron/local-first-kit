/**
 * Session token utilities: create, validate, and refresh with token rotation.
 *
 * Pattern B auth:
 * - Short-lived JWTs (5-15 min) for authentication.
 * - Longer-lived refresh tokens stored in HttpOnly cookies.
 * - Refresh token rotation: issuing a new refresh token invalidates the old one,
 *   preventing token replay attacks.
 * - D1 stores user records; JWTs are self-verifying (no KV session store).
 * - Refresh tokens are hashed with SHA-256 before storage (like passwords).
 */
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import {
  createJwt,
  verifyJwt,
  generateTokenId,
  type JwtConfig,
  type VerifiedJwt,
} from "./jwt.js";

/** How long a refresh token lives — 30 days by default. */
const DEFAULT_REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/** Result of creating a session (login or refresh). */
export interface SessionTokens {
  /** Short-lived JWT for Authorization header */
  accessToken: string;
  /** Longer-lived token for HttpOnly cookie */
  refreshToken: string;
  /** Refresh token SHA-256 hash — store this in D1/cookie metadata */
  refreshTokenHash: string;
  /** When the access token expires (Date) */
  accessTokenExpiresAt: Date;
  /** When the refresh token expires (Date) */
  refreshTokenExpiresAt: Date;
}

/** Stored refresh token record — what D1 holds. */
export interface RefreshTokenRecord {
  /** SHA-256 hash of the raw refresh token */
  tokenHash: string;
  /** The user ID this token belongs to */
  userId: string;
  /** When the token was issued (ISO string) */
  issuedAt: string;
  /** When the token expires (ISO string) */
  expiresAt: string;
}

/**
 * Create a new session: issues both an access token (JWT) and a refresh token.
 *
 * @param jwtConfig - JWT signing configuration
 * @param userId - The authenticated user's ID
 * @param refreshTokenExpirySeconds - How long the refresh token lives (default 30 days)
 * @returns Both tokens and metadata for storage
 */
export function createSession(
  jwtConfig: JwtConfig,
  userId: string,
  refreshTokenExpirySeconds: number = DEFAULT_REFRESH_TOKEN_EXPIRY_SECONDS,
): SessionTokens {
  const now = new Date();
  const accessTokenId = generateTokenId();
  const accessToken = createJwt(jwtConfig, userId, accessTokenId);

  // Generate a raw refresh token, store its hash
  const rawRefreshToken = generateTokenId(); // 64 hex chars = 256 bits
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);

  const accessTokenExpiresAt = new Date(
    now.getTime() + (jwtConfig.expiresInSeconds ?? 15 * 60) * 1000,
  );
  const refreshTokenExpiresAt = new Date(
    now.getTime() + refreshTokenExpirySeconds * 1000,
  );

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    refreshTokenHash,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
  };
}

/**
 * Validate an access token (JWT).
 *
 * @returns The verified claims, or null if invalid/expired.
 */
export function validateAccessToken(
  jwtConfig: JwtConfig,
  token: string,
): VerifiedJwt | null {
  return verifyJwt(jwtConfig, token);
}

/**
 * Refresh a session: validates the refresh token, issues new access + refresh tokens.
 *
 * IMPORTANT: The caller MUST delete the old refresh token record from D1 after
 * this succeeds, and store the new refresh token hash. This is token rotation —
 * each refresh invalidates the previous token.
 *
 * @param jwtConfig - JWT signing configuration
 * @param userId - The user ID from the existing refresh token record
 * @param refreshTokenExpirySeconds - How long the new refresh token lives
 * @returns New session tokens
 */
export function refreshSession(
  jwtConfig: JwtConfig,
  userId: string,
  refreshTokenExpirySeconds: number = DEFAULT_REFRESH_TOKEN_EXPIRY_SECONDS,
): SessionTokens {
  // Token rotation: create entirely new tokens
  // The caller is responsible for:
  // 1. Verifying the refresh token hash matches D1
  // 2. Checking it hasn't expired
  // 3. Deleting the old record
  // 4. Storing the new refresh token hash
  return createSession(jwtConfig, userId, refreshTokenExpirySeconds);
}

/**
 * Hash a refresh token for storage.
 * Uses SHA-256 (via @oslojs/crypto) — one-way, no salt needed since the
 * token itself has 256 bits of entropy.
 */
export function hashRefreshToken(token: string): string {
  const encoded = new TextEncoder().encode(token);
  const hash = sha256(encoded);
  return encodeHexLowerCase(hash);
}

/**
 * Verify a refresh token against its stored hash.
 */
export function verifyRefreshToken(
  token: string,
  storedHash: string,
): boolean {
  return hashRefreshToken(token) === storedHash;
}

/**
 * Check if a refresh token record has expired.
 */
export function isRefreshTokenExpired(record: RefreshTokenRecord): boolean {
  return new Date(record.expiresAt) < new Date();
}

/**
 * Build a D1-ready refresh token record for storage.
 */
export function createRefreshTokenRecord(
  userId: string,
  refreshTokenHash: string,
  expiresAt: Date,
): RefreshTokenRecord {
  const now = new Date();
  return {
    tokenHash: refreshTokenHash,
    userId,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}