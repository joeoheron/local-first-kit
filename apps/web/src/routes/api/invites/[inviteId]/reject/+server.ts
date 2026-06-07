import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { respondToInvite } from '$lib/server/collab/invites';

export const POST: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  await respondToInvite(platform.env.DB, params.inviteId, locals.user.id, 'rejected');
  return json({ ok: true });
};
