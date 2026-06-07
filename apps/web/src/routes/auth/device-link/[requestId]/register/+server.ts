import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import {
  verifyPasskeyRegistration,
  createSession,
  createRefreshTokenRecord,
  type RegistrationResponseJSON,
} from '@local-first-kit/auth';
import { setSessionCookies } from '$lib/server/session';
import { consumeWebAuthnChallenge, findPasskeyCredential, createPasskeyCredential } from '$lib/server/passkeys';
import { ensurePersonalSpace } from '$lib/server/collab/spaces';
import { insertRefreshToken } from '$lib/server/users';
import { buildJwtConfig, SESSION_JWT_EXPIRY } from '$lib/server/config';
import { getPendingApproval, deletePendingApproval } from '$lib/server/deviceLink';
import { sha256Base64 } from '$lib/local/crypto';

export const POST: RequestHandler = async ({ params, request, platform, cookies, url }) => {
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  if (!platform.env.JWT_SECRET) throw error(500, 'JWT_SECRET not configured');

  const body = await request.json().catch(() => null) as {
    challengeId?: string;
    response?: RegistrationResponseJSON;
    displayName?: string;
    popToken?: string;
  } | null;

  if (!body?.challengeId || !body?.response) throw error(400, 'Missing required fields');

  const row = await getPendingApproval(platform.env.DB, params.requestId);
  if (!row) throw error(404, 'Request not found or expired');
  if (row.status !== 'approved') throw error(400, 'Request not yet approved');

  // Proof of possession: the caller must hold the ECDH private key bound at request
  // time. The approving device committed pop_hash = SHA-256(popToken); only a holder
  // of that key can derive popToken from the ECDH shared secret. Checked before the
  // WebAuthn challenge is consumed so a failed proof doesn't burn the challenge.
  if (!row.pop_hash) throw error(403, 'Device verification failed');
  if (!body.popToken || (await sha256Base64(body.popToken)) !== row.pop_hash) {
    throw error(403, 'Device verification failed');
  }

  const challengeRow = await consumeWebAuthnChallenge(platform.env.DB, body.challengeId);
  if (!challengeRow) throw error(400, 'Challenge not found or expired');

  const origin = url.origin;
  const rpId = url.hostname;

  const verified = await verifyPasskeyRegistration(origin, rpId, challengeRow.challenge, body.response);
  if (!verified) throw error(400, 'Passkey verification failed');

  const credentialId = body.response.id;
  const existing = await findPasskeyCredential(platform.env.DB, credentialId);
  if (existing) throw error(409, 'Credential already registered');

  await createPasskeyCredential(
    platform.env.DB,
    credentialId,
    row.user_id,
    verified.publicKey,
    verified.algorithm,
    verified.counter,
    verified.transports,
    body.displayName ?? null,
  );
  await ensurePersonalSpace(platform.env.DB, row.user_id);
  await deletePendingApproval(platform.env.DB, params.requestId);

  const jwtConfig = buildJwtConfig(platform.env.JWT_SECRET as string, SESSION_JWT_EXPIRY);
  const session = createSession(jwtConfig, row.user_id);
  const record = createRefreshTokenRecord(row.user_id, session.refreshTokenHash, session.refreshTokenExpiresAt);
  await insertRefreshToken(platform.env.DB, record.tokenHash, record.userId, record.issuedAt, record.expiresAt);

  setSessionCookies(cookies, session.accessToken, session.refreshToken);

  return json({ isNewAccount: false, userId: row.user_id });
};
