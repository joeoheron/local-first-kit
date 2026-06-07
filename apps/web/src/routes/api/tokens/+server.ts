import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { createApiToken } from '$lib/server/apiTokens';
import { getSpaceMembership } from '$lib/server/collab/spaces';

const VALID_SCOPES = new Set(['read', 'readwrite']);

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const body = await request.json().catch(() => null) as {
    name?: string; scope?: string; rawToken?: string; spaceId?: string; wrappedSpaceKey?: string;
  } | null;

  if (!body?.name?.trim()) throw error(400, 'Token name is required');
  if (!body.scope || !VALID_SCOPES.has(body.scope)) throw error(400, 'Invalid scope');
  if (!body.rawToken || typeof body.rawToken !== 'string') throw error(400, 'rawToken is required');
  if (!body.spaceId || typeof body.spaceId !== 'string') throw error(400, 'spaceId is required');

  // A write token must carry an escrowed space key, otherwise it could never encrypt
  // writes to fields in ENCRYPTED_FIELDS_BY_TABLE and would be rejected at write time.
  if (body.scope === 'readwrite' && !body.wrappedSpaceKey) {
    throw error(422, 'A read+write token requires an escrowed space key. Open the space so its key loads, then create the token.');
  }

  const role = await getSpaceMembership(platform.env.DB, locals.user.id, body.spaceId);
  if (!role) throw error(403, 'Not a member of that space');

  await createApiToken(
    platform.env.DB,
    locals.user.id,
    body.name.trim(),
    body.scope as 'read' | 'readwrite',
    body.rawToken,
    body.spaceId,
    body.wrappedSpaceKey,
  );

  return json({ ok: true });
};
