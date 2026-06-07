import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { storeDeviceKey, getDeviceKey } from '$lib/server/keys';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const body = await request.json().catch(() => null) as {
    credentialId?: string;
    wrappedKey?: string;
  } | null;

  if (!body?.credentialId || !body?.wrappedKey) throw error(400, 'Missing credentialId or wrappedKey');

  await storeDeviceKey(platform.env.DB, locals.user.id, body.credentialId, body.wrappedKey);
  return json({ ok: true });
};

export const GET: RequestHandler = async ({ url, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const credentialId = url.searchParams.get('credentialId');
  if (!credentialId) throw error(400, 'Missing credentialId');

  const row = await getDeviceKey(platform.env.DB, locals.user.id, credentialId);
  if (!row) throw error(404, 'Key not found');

  return json({ wrappedKey: row.wrapped_key });
};
