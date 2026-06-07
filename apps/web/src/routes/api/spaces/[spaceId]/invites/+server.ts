import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getSpaceMembership } from '$lib/server/collab/spaces';
import { createInvite } from '$lib/server/collab/invites';

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  const role = await getSpaceMembership(platform.env.DB, locals.user.id, params.spaceId);
  if (!role) throw error(403, 'Not a member');
  const body = await request.json().catch(() => null) as {
    inviteeUserId?: string;
    wrappedSpaceKey?: string;
    inviterEcdhPub?: string;
  } | null;
  if (!body?.inviteeUserId || !body.wrappedSpaceKey || !body.inviterEcdhPub) {
    throw error(400, 'inviteeUserId, wrappedSpaceKey, inviterEcdhPub required');
  }
  const inviteId = await createInvite(
    platform.env.DB,
    params.spaceId,
    locals.user.id,
    body.inviteeUserId,
    body.wrappedSpaceKey,
    body.inviterEcdhPub,
  );
  return json({ inviteId }, { status: 201 });
};
