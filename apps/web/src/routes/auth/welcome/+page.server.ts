import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getUserSpace } from '$lib/server/collab/spaces';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  if (!locals.user) throw redirect(302, '/auth/login');

  const publicServerUrl =
    (platform?.env?.PUBLIC_SERVER_URL as string | undefined) || url.origin;

  if (!platform?.env?.DB) throw redirect(302, '/');

  const space = await getUserSpace(platform.env.DB, locals.user.id);
  if (!space) throw redirect(302, '/');

  return {
    user: locals.user,
    publicServerUrl,
    spaceId: space.id,
  };
};

