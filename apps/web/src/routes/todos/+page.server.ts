import type { PageServerLoad } from './$types';
import { getPendingInvites } from '$lib/server/collab/invites';

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.user || !platform?.env?.DB) return { pendingInvites: [] };
  const pendingInvites = await getPendingInvites(platform.env.DB, locals.user.id);
  return { pendingInvites };
};
