import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { findUserByEmail, generateUserId } from '$lib/server/users';
import { createPendingApproval } from '$lib/server/deviceLink';

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const body = await request.json().catch(() => null) as {
    email?: string;
    ecdhPublicKey?: string;
  } | null;

  if (!body?.email || !body?.ecdhPublicKey) throw error(400, 'Missing email or ecdhPublicKey');

  const email = body.email.trim().toLowerCase();
  const user = await findUserByEmail(platform.env.DB, email);
  if (!user) throw error(404, 'No account found for that email');

  const requestId = generateUserId();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await createPendingApproval(platform.env.DB, requestId, user.id, body.ecdhPublicKey, expiresAt);

  return json({ requestId });
};
