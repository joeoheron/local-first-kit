/**
 * WebSocket proxy route — authorizes space access and forwards to the DO.
 *
 * The client connects to ws://host/sync/{spaceId} (no token in the URL).
 * This route:
 *   1. Reads the HttpOnly session cookie and verifies the session JWT → userId
 *   2. Checks space membership in D1 → role (403 if not a member)
 *   3. Mints a short-lived space JWT (userId + spaceId + role + writeTables, 1 min TTL)
 *   4. Forwards the request to the DO with ?token={spaceJwt}
 *
 * writeTables encodes which tables the connecting user may write to — see
 * WRITE_TABLES_BY_ROLE in packages/domain/src/access.ts.
 */
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getAccessToken } from '$lib/server/session';
import { getSpaceMembership } from '$lib/server/collab/spaces';
import { verifyJwt, createSpaceJwt } from '@local-first-kit/auth';
import { buildJwtConfig, SYNC_JWT_EXPIRY } from '$lib/server/config';
import { WRITE_TABLES_BY_ROLE } from '@local-first-kit/domain';

export const GET: RequestHandler = async ({ params, platform, request, cookies }) => {
  if (!platform?.env?.SYNC_DO) {
    throw error(503, 'Sync service unavailable');
  }

  const sessionToken = getAccessToken(cookies);
  if (!sessionToken) {
    throw error(401, 'Authentication required');
  }

  const secret = platform.env.JWT_SECRET as string | undefined;
  if (!secret) throw error(500, 'JWT_SECRET not configured');
  const jwtConfig = buildJwtConfig(secret, SYNC_JWT_EXPIRY);
  const verified = verifyJwt(jwtConfig, sessionToken);
  if (!verified) {
    throw error(401, 'Invalid or expired session');
  }

  const spaceId = params.spaceId;
  const d1 = platform.env.DB;
  const role = await getSpaceMembership(d1, verified.userId, spaceId);
  if (!role) {
    throw error(403, 'Access denied');
  }

  const writeTables = WRITE_TABLES_BY_ROLE[role] ?? [];
  const spaceToken = createSpaceJwt(jwtConfig, verified.userId, crypto.randomUUID(), spaceId, role, writeTables);

  const doUrl = new URL(request.url);
  doUrl.searchParams.set('token', spaceToken);

  const doNamespace = platform.env.SYNC_DO;
  const doId = doNamespace.idFromName(spaceId);
  const doStub = doNamespace.get(doId);

  // Pass request.headers directly — spreading creates duplicate "Upgrade" keys
  // which Cloudflare joins as "websocket, websocket", breaking the DO's WS check.
  return doStub.fetch(doUrl.toString(), {
    method: 'GET',
    headers: request.headers,
  });
};
