import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getPendingApproval } from '$lib/server/deviceLink';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const row = await getPendingApproval(platform.env.DB, params.requestId);
  if (!row) throw error(404, 'Request not found or expired');
  if (row.user_id !== locals.user.id) throw error(403, 'Forbidden');

  return json({ ecdhPublicKey: row.ecdh_public_key });
};
