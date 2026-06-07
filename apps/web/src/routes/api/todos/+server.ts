import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireAccess, requireWriteAccess } from '$lib/server/api';
import { doGetRows, doCreateRow } from '$lib/server/durableObjectClient';
import { getUserSpace, getSpaceMembership } from '$lib/server/collab/spaces';
import { resolveSpaceKey, encryptRowForTable, MissingSpaceKeyError } from '$lib/server/spaceKey';
import { TODO_TABLE, canWriteTable } from '@local-first-kit/domain';

async function resolveSpace(userId: string, platform: App.Platform) {
  const space = await getUserSpace(platform.env.DB, userId);
  if (!space) throw error(403, 'No space found');
  return space.id;
}

export const GET: RequestHandler = async ({ request, locals, platform }) => {
  const { userId } = await requireAccess(request, locals, platform);
  const spaceId = await resolveSpace(userId, platform!);
  return json(await doGetRows(platform, spaceId, TODO_TABLE));
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const { userId, rawToken, wrappedSpaceKey } = await requireWriteAccess(request, locals, platform);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== 'string') throw error(400, 'text is required');
  const spaceId = await resolveSpace(userId, platform!);
  const role = await getSpaceMembership(platform!.env.DB, userId, spaceId);
  if (!canWriteTable(role, TODO_TABLE)) throw error(403, 'Insufficient permissions');
  const now = Date.now();

  const spaceKey = await resolveSpaceKey(rawToken, wrappedSpaceKey);
  let row;
  try {
    row = await encryptRowForTable(TODO_TABLE, {
      text: body.text,
      completed: false,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    }, spaceKey);
  } catch (e) {
    if (e instanceof MissingSpaceKeyError) {
      throw error(422, 'Cannot create todo: this request has no space key to encrypt the text. Use an API token created with an escrowed space key.');
    }
    throw e;
  }

  const id = await doCreateRow(platform, spaceId, TODO_TABLE, row);
  return json({ id }, { status: 201 });
};
