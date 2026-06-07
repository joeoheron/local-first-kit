/**
 * D1 query functions for wrapped key material.
 * The server stores only ciphertext — it never sees plaintext key bytes.
 */

export async function storeDeviceKey(
  d1: D1Database,
  userId: string,
  credentialId: string,
  wrappedKey: string,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO device_keys (user_id, credential_id, wrapped_key)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, credential_id) DO UPDATE SET wrapped_key = excluded.wrapped_key`,
    )
    .bind(userId, credentialId, wrappedKey)
    .run();
}

export async function getDeviceKey(
  d1: D1Database,
  userId: string,
  credentialId: string,
): Promise<{ wrapped_key: string } | null> {
  return d1
    .prepare('SELECT wrapped_key FROM device_keys WHERE user_id = ? AND credential_id = ?')
    .bind(userId, credentialId)
    .first<{ wrapped_key: string }>();
}

export async function storeSpaceKey(
  d1: D1Database,
  spaceId: string,
  userId: string,
  wrappedKey: string,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO space_keys (space_id, user_id, wrapped_key)
       VALUES (?, ?, ?)
       ON CONFLICT (space_id, user_id) DO UPDATE SET wrapped_key = excluded.wrapped_key`,
    )
    .bind(spaceId, userId, wrappedKey)
    .run();
}

export async function storeIdentityKey(
  d1: D1Database,
  userId: string,
  publicKey: string,
  wrappedPrivateKey: string,
  credentialId: string,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO user_identity_keys (user_id, public_key, wrapped_private_key, credential_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         public_key = excluded.public_key,
         wrapped_private_key = excluded.wrapped_private_key,
         credential_id = excluded.credential_id`,
    )
    .bind(userId, publicKey, wrappedPrivateKey, credentialId)
    .run();
}

export async function getIdentityKey(
  d1: D1Database,
  userId: string,
): Promise<{ public_key: string; wrapped_private_key: string } | null> {
  return d1
    .prepare('SELECT public_key, wrapped_private_key FROM user_identity_keys WHERE user_id = ?')
    .bind(userId)
    .first<{ public_key: string; wrapped_private_key: string }>();
}

export async function getSpaceKey(
  d1: D1Database,
  spaceId: string,
  userId: string,
): Promise<{ wrapped_key: string } | null> {
  return d1
    .prepare('SELECT wrapped_key FROM space_keys WHERE space_id = ? AND user_id = ?')
    .bind(spaceId, userId)
    .first<{ wrapped_key: string }>();
}

export async function storeWrappingKey(
  d1: D1Database,
  userId: string,
  publicKey: string,
  wrappedPrivateKey: string,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO user_wrapping_keys (user_id, public_key, wrapped_private_key)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         public_key = excluded.public_key,
         wrapped_private_key = excluded.wrapped_private_key`,
    )
    .bind(userId, publicKey, wrappedPrivateKey)
    .run();
}

export async function getWrappingKey(
  d1: D1Database,
  userId: string,
): Promise<{ public_key: string; wrapped_private_key: string } | null> {
  return d1
    .prepare('SELECT public_key, wrapped_private_key FROM user_wrapping_keys WHERE user_id = ?')
    .bind(userId)
    .first<{ public_key: string; wrapped_private_key: string }>();
}
