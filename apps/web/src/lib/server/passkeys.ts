/**
 * D1 query functions for passkey credentials and WebAuthn challenges.
 */

// ---- Passkey credential query functions ----

export interface PasskeyCredentialRow {
  id: string;
  user_id: string;
  public_key: Uint8Array;
  algorithm: number;
  counter: number;
  transports: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function createPasskeyCredential(
  d1: D1Database,
  id: string,
  userId: string,
  publicKey: Uint8Array,
  algorithm: number,
  counter: number,
  transports: string[],
  name: string | null,
): Promise<void> {
  await d1
    .prepare(
      'INSERT INTO passkey_credentials (id, user_id, public_key, algorithm, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
    )
    .bind(id, userId, publicKey, algorithm, counter, JSON.stringify(transports), name)
    .run();
}

export async function findPasskeyCredential(
  d1: D1Database,
  credentialId: string,
): Promise<PasskeyCredentialRow | null> {
  return d1
    .prepare('SELECT id, user_id, public_key, algorithm, counter, transports, name, created_at, last_used_at FROM passkey_credentials WHERE id = ?')
    .bind(credentialId)
    .first<PasskeyCredentialRow>();
}

export async function updatePasskeyCounterAndTimestamp(
  d1: D1Database,
  credentialId: string,
  counter: number,
  lastUsedAt: string,
): Promise<void> {
  await d1
    .prepare("UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(counter, lastUsedAt, credentialId)
    .run();
}

export async function findPasskeysByUser(
  d1: D1Database,
  userId: string,
): Promise<PasskeyCredentialRow[]> {
  const result = await d1
    .prepare('SELECT id, user_id, public_key, algorithm, counter, transports, name, created_at, last_used_at FROM passkey_credentials WHERE user_id = ?')
    .bind(userId)
    .all<PasskeyCredentialRow>();
  return result.results ?? [];
}

// ---- WebAuthn challenge query functions ----

export interface WebAuthnChallengeRow {
  id: string;
  challenge: string;
  user_id: string | null;
  expires_at: string;
}

export async function createWebAuthnChallenge(
  d1: D1Database,
  id: string,
  challenge: string,
  userId: string | null,
  expiresAt: string,
): Promise<void> {
  await d1
    .prepare('INSERT INTO webauthn_challenges (id, challenge, user_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, challenge, userId, expiresAt)
    .run();
}

/** Read then delete the challenge atomically. Returns null if not found or expired. */
export async function consumeWebAuthnChallenge(
  d1: D1Database,
  id: string,
): Promise<WebAuthnChallengeRow | null> {
  const row = await d1
    .prepare('SELECT id, challenge, user_id, expires_at FROM webauthn_challenges WHERE id = ?')
    .bind(id)
    .first<WebAuthnChallengeRow>();

  if (!row) return null;

  await d1.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(id).run();

  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

export async function deleteExpiredChallenges(d1: D1Database): Promise<void> {
  await d1
    .prepare("DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')")
    .run();
}
