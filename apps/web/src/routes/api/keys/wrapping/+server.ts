import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { storeWrappingKey, getWrappingKey } from '$lib/server/keys';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  const body = await request.json().catch(() => null) as {
    publicKey?: string; wrappedPrivateKey?: string;
  } | null;
  if (!body?.publicKey || !body.wrappedPrivateKey) throw error(400, 'publicKey and wrappedPrivateKey required');
  await storeWrappingKey(platform.env.DB, locals.user.id, body.publicKey, body.wrappedPrivateKey);
  return json({ ok: true });
};

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  const row = await getWrappingKey(platform.env.DB, locals.user.id);
  if (!row) throw error(404, 'Wrapping key not found');
  return json({ wrappedPrivateKey: row.wrapped_private_key });
};
