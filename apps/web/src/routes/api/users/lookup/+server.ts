import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { findUserByEmail } from '$lib/server/users';
import { getWrappingKey } from '$lib/server/keys';

export const GET: RequestHandler = async ({ url, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  const email = url.searchParams.get('email');
  if (!email) throw error(400, 'email required');
  const user = await findUserByEmail(platform.env.DB, email);
  if (!user) throw error(404, 'User not found');
  if (user.id === locals.user.id) throw error(400, 'Cannot invite yourself');
  const wrappingKey = await getWrappingKey(platform.env.DB, user.id);
  if (!wrappingKey) throw error(404, 'User has no wrapping key — they must log in once with a passkey');
  return json({ id: user.id, ecdhPublicKey: wrappingKey.public_key });
};
