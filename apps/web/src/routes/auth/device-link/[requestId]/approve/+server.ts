import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getPendingApproval, approvePendingApproval } from '$lib/server/deviceLink';

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const body = await request.json().catch(() => null) as {
    primaryEcdhPublicKey?: string;
    wrappedUserKey?: string;
    popHash?: string;
  } | null;

  if (!body?.primaryEcdhPublicKey || !body?.wrappedUserKey || !body?.popHash) {
    throw error(400, 'Missing primaryEcdhPublicKey, wrappedUserKey or popHash');
  }

  const row = await getPendingApproval(platform.env.DB, params.requestId);
  if (!row) throw error(404, 'Request not found or expired');
  if (row.user_id !== locals.user.id) throw error(403, 'Forbidden');
  if (row.status !== 'pending') throw error(409, 'Request already processed');

  await approvePendingApproval(
    platform.env.DB,
    params.requestId,
    body.primaryEcdhPublicKey,
    body.wrappedUserKey,
    body.popHash,
  );

  return json({ ok: true });
};
