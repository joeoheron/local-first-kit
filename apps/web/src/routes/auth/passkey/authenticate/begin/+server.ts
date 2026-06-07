import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { generateWebAuthnChallenge } from '@local-first-kit/auth';
import { createWebAuthnChallenge, findPasskeysByUser } from '$lib/server/passkeys';
import { generateUserId, findUserByEmail } from '$lib/server/users';

export const POST: RequestHandler = async ({ request, platform, url }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const body = await request.json().catch(() => null) as { email?: string } | null;

  const challengeId = generateUserId();
  const challenge = generateWebAuthnChallenge();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await createWebAuthnChallenge(platform.env.DB, challengeId, challenge, null, expiresAt);

  const rpId = url.hostname;

  let allowCredentials: { type: 'public-key'; id: string; transports?: string[] }[] = [];

  if (body?.email) {
    const email = body.email.trim().toLowerCase();
    const user = await findUserByEmail(platform.env.DB, email);
    if (user) {
      const credentials = await findPasskeysByUser(platform.env.DB, user.id);
      allowCredentials = credentials.map((c) => ({
        type: 'public-key',
        id: c.id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      }));
    }
  }

  return json({ challengeId, challenge, rpId, allowCredentials });
};
