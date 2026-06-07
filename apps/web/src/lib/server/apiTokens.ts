import { getSpaceMembership } from './collab/spaces.js';

export type TokenScope = 'read' | 'readwrite';

export interface ApiToken {
  token_hash: string;
  user_id: string;
  name: string;
  scope: TokenScope;
  space_id: string | null;
  created_at: string;
  expires_at: string | null;
}

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Create an API token. The caller generates rawToken; wrappedSpaceKey is optional. */
export async function createApiToken(
  d1: D1Database,
  userId: string,
  name: string,
  scope: TokenScope,
  rawToken: string,
  spaceId: string,
  wrappedSpaceKey?: string,
): Promise<void> {
  const hash = await hashToken(rawToken);
  await d1
    .prepare(
      'INSERT INTO api_tokens (token_hash, user_id, name, scope, space_id, wrapped_space_key) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(hash, userId, name, scope, spaceId, wrappedSpaceKey ?? null)
    .run();
}

/** Verify a Bearer token and return auth context, or null if invalid/expired/no-longer-a-member. */
export async function verifyApiToken(
  d1: D1Database,
  rawToken: string,
): Promise<{ userId: string; scope: TokenScope; spaceId: string | null; wrappedSpaceKey: string | null; role: string | null } | null> {
  const hash = await hashToken(rawToken);
  const row = await d1
    .prepare(
      'SELECT user_id, scope, expires_at, space_id, wrapped_space_key FROM api_tokens WHERE token_hash = ?',
    )
    .bind(hash)
    .first<{ user_id: string; scope: string; expires_at: string | null; space_id: string | null; wrapped_space_key: string | null }>();

  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Re-check membership at request time: a token bound to a space must stop granting
  // access the moment the user is no longer a member of that space. getSpaceMembership
  // returns the current role, so a downgrade is reflected too, not just removal.
  let role: string | null = null;
  if (row.space_id) {
    role = await getSpaceMembership(d1, row.user_id, row.space_id);
    if (role === null) return null; // no longer a member → token invalid
  }

  return {
    userId: row.user_id,
    scope: row.scope as TokenScope,
    spaceId: row.space_id,
    wrappedSpaceKey: row.wrapped_space_key,
    role,
  };
}

/** List all API tokens for a user (no raw values, metadata only). */
export async function listApiTokens(d1: D1Database, userId: string): Promise<ApiToken[]> {
  const result = await d1
    .prepare(
      'SELECT token_hash, user_id, name, scope, space_id, created_at, expires_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC',
    )
    .bind(userId)
    .all<ApiToken>();
  return result.results ?? [];
}

/** Revoke an API token by its hash. */
export async function revokeApiToken(d1: D1Database, tokenHash: string): Promise<void> {
  await d1.prepare('DELETE FROM api_tokens WHERE token_hash = ?').bind(tokenHash).run();
}
