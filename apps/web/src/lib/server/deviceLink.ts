/**
 * D1 query functions for device-link approval requests.
 */

export interface PendingApprovalRow {
  id: string;
  user_id: string;
  ecdh_public_key: string;
  status: 'pending' | 'approved';
  primary_ecdh_public_key: string | null;
  wrapped_user_key: string | null;
  pop_hash: string | null;
  expires_at: string;
  created_at: string;
}

export async function createPendingApproval(
  d1: D1Database,
  id: string,
  userId: string,
  ecdhPublicKey: string,
  expiresAt: string,
): Promise<void> {
  await d1
    .prepare(
      'INSERT INTO pending_device_approvals (id, user_id, ecdh_public_key, expires_at) VALUES (?, ?, ?, ?)',
    )
    .bind(id, userId, ecdhPublicKey, expiresAt)
    .run();
}

export async function getPendingApproval(
  d1: D1Database,
  id: string,
): Promise<PendingApprovalRow | null> {
  const row = await d1
    .prepare('SELECT * FROM pending_device_approvals WHERE id = ?')
    .bind(id)
    .first<PendingApprovalRow>();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

export async function getPendingApprovalsForUser(
  d1: D1Database,
  userId: string,
): Promise<PendingApprovalRow[]> {
  const result = await d1
    .prepare(
      "SELECT * FROM pending_device_approvals WHERE user_id = ? AND status = 'pending' AND expires_at > datetime('now')",
    )
    .bind(userId)
    .all<PendingApprovalRow>();
  return result.results ?? [];
}

export async function approvePendingApproval(
  d1: D1Database,
  id: string,
  primaryEcdhPublicKey: string,
  wrappedUserKey: string,
  popHash: string,
): Promise<void> {
  await d1
    .prepare(
      "UPDATE pending_device_approvals SET status = 'approved', primary_ecdh_public_key = ?, wrapped_user_key = ?, pop_hash = ? WHERE id = ?",
    )
    .bind(primaryEcdhPublicKey, wrappedUserKey, popHash, id)
    .run();
}

export async function deletePendingApproval(d1: D1Database, id: string): Promise<void> {
  await d1.prepare('DELETE FROM pending_device_approvals WHERE id = ?').bind(id).run();
}
