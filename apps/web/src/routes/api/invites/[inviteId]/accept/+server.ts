import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getInviteForAccept, acceptInvite } from '$lib/server/collab/invites';
import { DEFAULT_INVITEE_ROLE } from '@local-first-kit/domain';

export const POST: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');
  const invite = await getInviteForAccept(platform.env.DB, params.inviteId, locals.user.id);
  if (!invite) throw error(404, 'Invite not found or already responded');
  await acceptInvite(platform.env.DB, params.inviteId, locals.user.id, invite.space_id, DEFAULT_INVITEE_ROLE);
  return json({
    spaceId: invite.space_id,
    wrappedSpaceKey: invite.wrapped_space_key,
    inviterEcdhPub: invite.inviter_ecdh_pub,
  });
};
