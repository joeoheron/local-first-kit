import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import {
  verifyPasskeyRegistration,
  createSession,
  createRefreshTokenRecord,
  type RegistrationResponseJSON,
} from '@local-first-kit/auth';
import { setSessionCookies } from '$lib/server/session';
import {
  consumeWebAuthnChallenge,
  findPasskeyCredential,
  createPasskeyCredential,
} from '$lib/server/passkeys';
import { createUser, generateUserId, insertRefreshToken } from '$lib/server/users';
import { ensurePersonalSpace } from '$lib/server/collab/spaces';
import { buildJwtConfig, SESSION_JWT_EXPIRY } from '$lib/server/config';

export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  if (!platform.env.JWT_SECRET) throw error(500, 'JWT_SECRET not configured');

  const body = await request.json().catch(() => null) as {
    challengeId?: string;
    response?: RegistrationResponseJSON;
    displayName?: string;
    email?: string;
  } | null;

  if (!body?.challengeId || !body?.response) throw error(400, 'Missing required fields');

  const challengeRow = await consumeWebAuthnChallenge(platform.env.DB, body.challengeId);
  if (!challengeRow) throw error(400, 'Challenge not found or expired');

  const origin = url.origin;
  const rpId = url.hostname;

  const verified = await verifyPasskeyRegistration(origin, rpId, challengeRow.challenge, body.response);
  if (!verified) throw error(400, 'Passkey verification failed');

  // Use the browser-API credential ID (body.response.id) as the lookup key — this is
  // what the browser sends during authentication. It matches verified.credentialId for
  // standard authenticators, but TPM-FIDO embeds extra TPM metadata in the browser-API
  // ID that differs from the raw ID inside the authenticatorData CBOR.
  const credentialId = body.response.id;

  const existing = await findPasskeyCredential(platform.env.DB, credentialId);
  if (existing) throw error(409, 'Credential already registered');

  const userId = generateUserId();
  const email = body.email?.trim().toLowerCase() ?? null;
  await createUser(platform.env.DB, userId, email);
  await createPasskeyCredential(
    platform.env.DB,
    credentialId,
    userId,
    verified.publicKey,
    verified.algorithm,
    verified.counter,
    verified.transports,
    body.displayName ?? null,
  );
  await ensurePersonalSpace(platform.env.DB, userId);

  const jwtConfig = buildJwtConfig(platform.env.JWT_SECRET as string, SESSION_JWT_EXPIRY);
  const session = createSession(jwtConfig, userId);
  const record = createRefreshTokenRecord(userId, session.refreshTokenHash, session.refreshTokenExpiresAt);
  await insertRefreshToken(platform.env.DB, record.tokenHash, record.userId, record.issuedAt, record.expiresAt);

  setSessionCookies(cookies, session.accessToken, session.refreshToken);

  return json({ isNewAccount: true, userId });
};
