import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { listApiTokens, revokeApiToken } from '$lib/server/apiTokens';
import { getPendingApprovalsForUser } from '$lib/server/deviceLink';

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.user) throw redirect(302, '/auth/login');
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const [tokens, pendingApprovals] = await Promise.all([
    listApiTokens(platform.env.DB, locals.user.id),
    getPendingApprovalsForUser(platform.env.DB, locals.user.id),
  ]);
  return { tokens, pendingApprovals };
};

export const actions: Actions = {
  revoke: async ({ locals, platform, request }) => {
    if (!locals.user) throw error(401, 'Not authenticated');
    if (!platform?.env?.DB) throw error(503, 'Service unavailable');

    const data = await request.formData();
    const tokenHash = data.get('tokenHash');

    if (typeof tokenHash !== 'string') return fail(400, { error: 'Missing token' });

    await revokeApiToken(platform.env.DB, tokenHash);
    return { revoked: true };
  },
};
