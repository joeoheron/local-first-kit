/**
 * D1 space invite queries.
 */

export async function createInvite(
  d1: D1Database,
  spaceId: string,
  createdBy: string,
  inviteeUserId: string,
  wrappedSpaceKey: string,
  inviterEcdhPub: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO space_invites (id, space_id, created_by, invitee_user_id, wrapped_space_key, inviter_ecdh_pub)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (space_id, invitee_user_id) DO UPDATE SET
         id = excluded.id,
         wrapped_space_key = excluded.wrapped_space_key,
         inviter_ecdh_pub = excluded.inviter_ecdh_pub,
         status = 'pending',
         responded_at = NULL`,
    )
    .bind(id, spaceId, createdBy, inviteeUserId, wrappedSpaceKey, inviterEcdhPub)
    .run();
  const row = await d1
    .prepare('SELECT id FROM space_invites WHERE space_id = ? AND invitee_user_id = ?')
    .bind(spaceId, inviteeUserId)
    .first<{ id: string }>();
  return row!.id;
}

export async function getPendingInvites(
  d1: D1Database,
  userId: string,
): Promise<Array<{ id: string; space_id: string; space_name: string; inviter_email: string }>> {
  const result = await d1
    .prepare(
      `SELECT si.id, si.space_id, s.name AS space_name, u.email AS inviter_email
       FROM space_invites si
       JOIN spaces s ON s.id = si.space_id
       JOIN users u ON u.id = si.created_by
       WHERE si.invitee_user_id = ? AND si.status = 'pending'
       ORDER BY si.created_at DESC`,
    )
    .bind(userId)
    .all<{ id: string; space_id: string; space_name: string; inviter_email: string }>();
  return result.results ?? [];
}

export async function getInviteForAccept(
  d1: D1Database,
  inviteId: string,
  userId: string,
): Promise<{ space_id: string; wrapped_space_key: string; inviter_ecdh_pub: string } | null> {
  return d1
    .prepare(
      `SELECT space_id, wrapped_space_key, inviter_ecdh_pub
       FROM space_invites
       WHERE id = ? AND invitee_user_id = ? AND status = 'pending'`,
    )
    .bind(inviteId, userId)
    .first<{ space_id: string; wrapped_space_key: string; inviter_ecdh_pub: string }>();
}

export async function respondToInvite(
  d1: D1Database,
  inviteId: string,
  userId: string,
  status: 'accepted' | 'rejected',
): Promise<void> {
  await d1
    .prepare(
      `UPDATE space_invites SET status = ?, responded_at = datetime('now')
       WHERE id = ? AND invitee_user_id = ? AND status = 'pending'`,
    )
    .bind(status, inviteId, userId)
    .run();
}

/** Accept an invite: add the user to the space and mark the invite accepted atomically. */
export async function acceptInvite(
  d1: D1Database,
  inviteId: string,
  userId: string,
  spaceId: string,
  role: string,
): Promise<void> {
  await d1.batch([
    d1.prepare(
      `INSERT INTO space_members (space_id, user_id, role)
       VALUES (?, ?, ?)
       ON CONFLICT (space_id, user_id) DO NOTHING`,
    ).bind(spaceId, userId, role),
    d1.prepare(
      `UPDATE space_invites SET status = 'accepted', responded_at = datetime('now')
       WHERE id = ? AND invitee_user_id = ? AND status = 'pending'`,
    ).bind(inviteId, userId),
  ]);
}

export async function addSpaceMember(
  d1: D1Database,
  spaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO space_members (space_id, user_id, role)
       VALUES (?, ?, ?)
       ON CONFLICT (space_id, user_id) DO NOTHING`,
    )
    .bind(spaceId, userId, role)
    .run();
}
