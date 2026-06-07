import type { LayoutServerLoad } from './$types';
import { getUserSpaces } from '$lib/server/collab/spaces';

export const load: LayoutServerLoad = async ({ locals, platform, url }) => {
  const publicServerUrl = url.origin;

  if (!locals.user || !platform?.env?.DB) {
    return { user: null, publicServerUrl, spaces: [], activeSpaceId: null };
  }

  const spaces = await getUserSpaces(platform.env.DB, locals.user.id);

  return {
    user: locals.user,
    publicServerUrl,
    spaces,
    activeSpaceId: spaces[0]?.id ?? null,
  };
};
