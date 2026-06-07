import { error } from '@sveltejs/kit';

function getStub(platform: App.Platform | undefined, spaceId: string) {
  if (!platform?.env?.SYNC_DO) throw error(503, 'Sync service unavailable');
  return platform.env.SYNC_DO.get(platform.env.SYNC_DO.idFromName(spaceId));
}

export function doGetRows(platform: App.Platform | undefined, spaceId: string, tableId: string) {
  return getStub(platform, spaceId).getRows(tableId);
}

export function doGetRow(platform: App.Platform | undefined, spaceId: string, tableId: string, rowId: string) {
  return getStub(platform, spaceId).getRow(tableId, rowId);
}

export function doCreateRow(platform: App.Platform | undefined, spaceId: string, tableId: string, fields: Record<string, unknown>) {
  return getStub(platform, spaceId).createRow(tableId, fields);
}

export function doPatchRow(platform: App.Platform | undefined, spaceId: string, tableId: string, rowId: string, fields: Record<string, unknown>) {
  return getStub(platform, spaceId).patchRow(tableId, rowId, fields);
}

export function doDeleteRow(platform: App.Platform | undefined, spaceId: string, tableId: string, rowId: string) {
  return getStub(platform, spaceId).deleteRow(tableId, rowId);
}
