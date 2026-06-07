import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { findUserByEmail } from '$lib/server/users';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) return json({ exists: false });

  const user = await findUserByEmail(platform.env.DB, email);
  return json({ exists: !!user });
};
