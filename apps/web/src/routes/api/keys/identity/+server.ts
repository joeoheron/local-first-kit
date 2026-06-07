import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { storeIdentityKey, getIdentityKey } from '$lib/server/keys';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const body = await request.json().catch(() => null) as {
    publicKey?: string; wrappedPrivateKey?: string; credentialId?: string;
  } | null;
  if (!body?.publicKey || !body.wrappedPrivateKey || !body.credentialId) {
    throw error(400, 'publicKey, wrappedPrivateKey, credentialId required');
  }

  await storeIdentityKey(
    platform.env.DB,
    locals.user.id,
    body.publicKey,
    body.wrappedPrivateKey,
    body.credentialId,
  );
  return json({ ok: true });
};

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const row = await getIdentityKey(platform.env.DB, locals.user.id);
  if (!row) throw error(404, 'Identity key not found');
  return json({ publicKey: row.public_key, wrappedPrivateKey: row.wrapped_private_key });
};
