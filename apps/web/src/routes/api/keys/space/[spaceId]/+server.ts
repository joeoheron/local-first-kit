import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { storeSpaceKey, getSpaceKey } from '$lib/server/keys';
import { getSpaceMembership } from '$lib/server/collab/spaces';

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const role = await getSpaceMembership(platform.env.DB, locals.user.id, params.spaceId);
  if (!role) throw error(403, 'Not a member of this space');

  const body = await request.json().catch(() => null) as { wrappedKey?: string } | null;
  if (!body?.wrappedKey) throw error(400, 'Missing wrappedKey');

  await storeSpaceKey(platform.env.DB, params.spaceId, locals.user.id, body.wrappedKey);
  return json({ ok: true });
};

export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const role = await getSpaceMembership(platform.env.DB, locals.user.id, params.spaceId);
  if (!role) throw error(403, 'Not a member of this space');

  const row = await getSpaceKey(platform.env.DB, params.spaceId, locals.user.id);
  if (!row) throw error(404, 'Key not found');

  return json({ wrappedKey: row.wrapped_key });
};
