import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireWriteAccess } from '$lib/server/api';
import { createSpace } from '$lib/server/collab/spaces';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const { userId } = await requireWriteAccess(request, locals, platform);
  if (!platform?.env?.DB) throw error(503, 'Service unavailable');

  const body = await request.json().catch(() => null) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) throw error(400, 'name is required');

  const spaceId = await createSpace(platform.env.DB, userId, name);
  return json({ spaceId, name }, { status: 201 });
};
