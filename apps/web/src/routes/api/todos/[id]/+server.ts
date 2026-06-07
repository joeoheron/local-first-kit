import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireWriteAccess } from '$lib/server/api';
import { doGetRow, doPatchRow, doDeleteRow } from '$lib/server/durableObjectClient';
import { getUserSpace, getSpaceMembership } from '$lib/server/collab/spaces';
import { TODO_TABLE, canWriteTable } from '@local-first-kit/domain';

async function resolveSpace(userId: string, platform: App.Platform) {
  const space = await getUserSpace(platform.env.DB, userId);
  if (!space) throw error(403, 'No space found');
  return space.id;
}

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
  const { userId } = await requireWriteAccess(request, locals, platform);
  const spaceId = await resolveSpace(userId, platform!);
  const role = await getSpaceMembership(platform!.env.DB, userId, spaceId);
  if (!canWriteTable(role, TODO_TABLE)) throw error(403, 'Insufficient permissions');
  const row = await doGetRow(platform, spaceId, 'todos', params.id);
  if (!row) return new Response(null, { status: 404 });
  await doPatchRow(platform, spaceId, 'todos', params.id, {
    completed: !(row.completed as boolean),
    updatedAt: Date.now(),
  });
  return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ params, request, locals, platform }) => {
  const { userId } = await requireWriteAccess(request, locals, platform);
  const spaceId = await resolveSpace(userId, platform!);
  const role = await getSpaceMembership(platform!.env.DB, userId, spaceId);
  if (!canWriteTable(role, TODO_TABLE)) throw error(403, 'Insufficient permissions');
  await doDeleteRow(platform, spaceId, 'todos', params.id);
  return new Response(null, { status: 204 });
};
