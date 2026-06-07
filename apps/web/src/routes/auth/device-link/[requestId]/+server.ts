import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getPendingApproval } from '$lib/server/deviceLink';

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const row = await getPendingApproval(platform.env.DB, params.requestId);
  if (!row) throw error(404, 'Request not found or expired');

  if (row.status === 'approved') {
    return json({
      status: 'approved',
      primaryEcdhPublicKey: row.primary_ecdh_public_key,
      wrappedUserKey: row.wrapped_user_key,
    });
  }

  return json({ status: 'pending' });
};
