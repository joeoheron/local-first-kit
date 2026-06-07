/**
 * D1 space and space-membership queries.
 *
 * A "space" is the sync partition — every user gets a personal one on signup.
 * Sharing is opt-in: other users can be invited to join a space (see invites.ts).
 */
import { DEFAULT_CREATOR_ROLE, DEFAULT_PERSONAL_SPACE_NAME } from '@local-first-kit/domain';

/** Create a space and add the creator as owner. Returns the new spaceId. */
export async function createSpace(
  d1: D1Database,
  userId: string,
  name: string,
): Promise<string> {
  const spaceId = crypto.randomUUID();
  await d1.batch([
    d1.prepare('INSERT INTO spaces (id, name, created_by) VALUES (?, ?, ?)').bind(spaceId, name, userId),
    d1.prepare('INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)').bind(spaceId, userId, DEFAULT_CREATOR_ROLE),
  ]);
  return spaceId;
}

/** Get the user's personal space (the one they created). */
export async function getUserSpace(
  d1: D1Database,
  userId: string,
): Promise<{ id: string } | null> {
  return d1
    .prepare('SELECT id FROM spaces WHERE created_by = ? LIMIT 1')
    .bind(userId)
    .first<{ id: string }>();
}

/** Get the user's role in a specific space, or null if not a member. */
export async function getSpaceMembership(
  d1: D1Database,
  userId: string,
  spaceId: string,
): Promise<string | null> {
  const row = await d1
    .prepare('SELECT role FROM space_members WHERE user_id = ? AND space_id = ?')
    .bind(userId, spaceId)
    .first<{ role: string }>();
  return row?.role ?? null;
}

/** Get all spaces the user belongs to, ordered by creation time. */
export async function getUserSpaces(
  d1: D1Database,
  userId: string,
): Promise<Array<{ id: string; name: string; role: string }>> {
  const result = await d1
    .prepare(
      `SELECT s.id, s.name, sm.role
       FROM spaces s
       JOIN space_members sm ON sm.space_id = s.id
       WHERE sm.user_id = ?
       ORDER BY s.created_at ASC`,
    )
    .bind(userId)
    .all<{ id: string; name: string; role: string }>();
  return result.results ?? [];
}

/** Ensure the user has a personal space — creates one if missing. Returns spaceId. */
export async function ensurePersonalSpace(
  d1: D1Database,
  userId: string,
): Promise<string> {
  const existing = await getUserSpace(d1, userId);
  if (existing) return existing.id;
  return createSpace(d1, userId, DEFAULT_PERSONAL_SPACE_NAME);
}
