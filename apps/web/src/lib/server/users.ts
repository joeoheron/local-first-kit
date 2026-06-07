/**
 * D1 user and refresh token queries.
 *
 * These belong in the SvelteKit app layer, not in packages/auth,
 * because they depend on the D1 database binding that only exists
 * in the Cloudflare Workers runtime.
 */

// ---- User types (matching D1 schema) ----

/** A user row from D1 (camelCase application shape). */
export interface User {
  /** UUID primary key */
  id: string;
  /** Unique email address — null for passkey-only users */
  email: string | null;
  /** PBKDF2-SHA256 hash (null for passkey users) */
  hashedPassword: string | null;
  /** ISO 8601 datetime string */
  createdAt: string;
  /** ISO 8601 datetime string */
  updatedAt: string;
}

/** Column names as they appear in D1 (snake_case). */
export const USER_COLUMNS = {
  id: "id",
  email: "email",
  hashedPassword: "hashed_password",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const;

/** D1 row shape — snake_case columns matching the SQL schema. */
export interface UserRow {
  id: string;
  email: string | null;
  hashed_password: string | null;
  created_at: string;
  updated_at: string;
}

/** Map a D1 row (snake_case) to a User object (camelCase). */
export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    hashedPassword: row.hashed_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Generate a new user ID. Uses crypto.randomUUID (available in Workers). */
export function generateUserId(): string {
  return crypto.randomUUID();
}

// ---- D1 query functions ----

/** Find a user by email address (case-insensitive — callers must normalise before querying). */
export async function findUserByEmail(
  d1: D1Database,
  email: string,
): Promise<UserRow | null> {
  return d1
    .prepare(`SELECT ${Object.values(USER_COLUMNS).join(', ')} FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow>();
}

/** Create a new user. email is nullable (passkey-only users have no email). */
export async function createUser(
  d1: D1Database,
  userId: string,
  email: string | null,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO users (${Object.values(USER_COLUMNS).join(", ")}) VALUES (?, ?, NULL, datetime('now'), datetime('now'))`,
    )
    .bind(userId, email)
    .run();
}

/** Update a user's email and timestamp. */
export async function updateUserEmail(
  d1: D1Database,
  userId: string,
  email: string,
): Promise<void> {
  await d1
    .prepare("UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(email, userId)
    .run();
}

/** Delete all refresh tokens for a user (full logout). */
export async function deleteRefreshTokensByUser(
  d1: D1Database,
  userId: string,
): Promise<void> {
  await d1
    .prepare("DELETE FROM refresh_tokens WHERE user_id = ?")
    .bind(userId)
    .run();
}

/** Find a refresh token by its hash. */
export async function findRefreshToken(
  d1: D1Database,
  tokenHash: string,
): Promise<{
  token_hash: string;
  user_id: string;
  issued_at: string;
  expires_at: string;
} | null> {
  return d1
    .prepare(
      "SELECT token_hash, user_id, issued_at, expires_at FROM refresh_tokens WHERE token_hash = ?",
    )
    .bind(tokenHash)
    .first();
}

/** Rotate a refresh token: delete the old one, insert the new one. */
export async function rotateRefreshToken(
  d1: D1Database,
  oldTokenHash: string,
  newTokenHash: string,
  userId: string,
  issuedAt: string,
  expiresAt: string,
): Promise<void> {
  await d1.batch([
    d1
      .prepare("DELETE FROM refresh_tokens WHERE token_hash = ?")
      .bind(oldTokenHash),
    d1
      .prepare(
        "INSERT INTO refresh_tokens (token_hash, user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .bind(newTokenHash, userId, issuedAt, expiresAt),
  ]);
}

/** Store a new refresh token. */
export async function insertRefreshToken(
  d1: D1Database,
  tokenHash: string,
  userId: string,
  issuedAt: string,
  expiresAt: string,
): Promise<void> {
  await d1
    .prepare(
      "INSERT INTO refresh_tokens (token_hash, user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(tokenHash, userId, issuedAt, expiresAt)
    .run();
}

/** Delete an expired refresh token. */
export async function deleteRefreshToken(
  d1: D1Database,
  tokenHash: string,
): Promise<void> {
  await d1
    .prepare("DELETE FROM refresh_tokens WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
}

/** Get a user's sync preference. Returns false if user not found. */
export async function getSyncEnabled(
  d1: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await d1
    .prepare("SELECT sync_enabled FROM users WHERE id = ?")
    .bind(userId)
    .first<{ sync_enabled: number }>();
  return row?.sync_enabled === 1;
}

/** Set a user's sync preference. */
export async function setSyncEnabled(
  d1: D1Database,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await d1
    .prepare("UPDATE users SET sync_enabled = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(enabled ? 1 : 0, userId)
    .run();
}


