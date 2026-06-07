import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { generateWebAuthnChallenge } from '@local-first-kit/auth';
import { APP_DISPLAY_NAME } from '@local-first-kit/config';
import { createWebAuthnChallenge } from '$lib/server/passkeys';
import { generateUserId } from '$lib/server/users';

export const POST: RequestHandler = async ({ platform, url }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const challengeId = generateUserId();
  const challenge = generateWebAuthnChallenge();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await createWebAuthnChallenge(platform.env.DB, challengeId, challenge, null, expiresAt);

  const rpId = url.hostname;

  return json({ challengeId, challenge, rpId, rpName: APP_DISPLAY_NAME });
};
