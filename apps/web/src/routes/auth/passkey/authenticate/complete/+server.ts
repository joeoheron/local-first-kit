import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import {
  verifyPasskeyAuthentication,
  createSession,
  createRefreshTokenRecord,
  type AuthenticationResponseJSON,
} from '@local-first-kit/auth';
import { setSessionCookies } from '$lib/server/session';
import {
  consumeWebAuthnChallenge,
  findPasskeyCredential,
  updatePasskeyCounterAndTimestamp,
} from '$lib/server/passkeys';
import { insertRefreshToken } from '$lib/server/users';
import { ensurePersonalSpace } from '$lib/server/collab/spaces';
import { buildJwtConfig, SESSION_JWT_EXPIRY } from '$lib/server/config';

export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  if (!platform.env.JWT_SECRET) throw error(500, 'JWT_SECRET not configured');

  const body = await request.json().catch(() => null) as {
    challengeId?: string;
    response?: AuthenticationResponseJSON;
  } | null;

  if (!body?.challengeId || !body?.response) throw error(400, 'Missing required fields');

  const challengeRow = await consumeWebAuthnChallenge(platform.env.DB, body.challengeId);
  if (!challengeRow) throw error(400, 'Challenge not found or expired');

  const credentialRow = await findPasskeyCredential(platform.env.DB, body.response.id);
  if (!credentialRow) {
    console.error('[auth] Unknown credential id:', body.response.id);
    throw error(401, 'Unknown credential');
  }

  const origin = url.origin;
  const rpId = url.hostname;

  const verified = await verifyPasskeyAuthentication(
    origin,
    rpId,
    challengeRow.challenge,
    credentialRow.public_key,
    credentialRow.algorithm,
    credentialRow.counter,
    body.response,
  );
  if (!verified) {
    console.error('[auth] Passkey verification failed — origin:', origin, 'rpId:', rpId, 'credentialId:', body.response.id);
    throw error(401, 'Passkey verification failed');
  }

  await updatePasskeyCounterAndTimestamp(
    platform.env.DB,
    verified.credentialId,
    verified.newCounter,
    new Date().toISOString(),
  );

  const userId = credentialRow.user_id;
  await ensurePersonalSpace(platform.env.DB, userId);

  const jwtConfig = buildJwtConfig(platform.env.JWT_SECRET as string, SESSION_JWT_EXPIRY);
  const session = createSession(jwtConfig, userId);
  const record = createRefreshTokenRecord(userId, session.refreshTokenHash, session.refreshTokenExpiresAt);
  await insertRefreshToken(platform.env.DB, record.tokenHash, record.userId, record.issuedAt, record.expiresAt);

  setSessionCookies(cookies, session.accessToken, session.refreshToken);

  return json({ isNewAccount: false, userId });
};
