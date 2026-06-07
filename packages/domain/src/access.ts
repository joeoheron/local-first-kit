import {TODO_TABLE} from './schema/todos.js';

/**
 * Maps space membership roles to the TinyBase tables that role may write.
 * Update this when changing your domain schema.
 *
 * The sync proxy route (apps/web/src/routes/sync/[spaceId]/+server.ts) imports this
 * automatically — no edits needed there when the domain changes.
 */
export const WRITE_TABLES_BY_ROLE: Record<string, string[]> = {
  owner: ['*'],
  member: [TODO_TABLE],
  viewer: [],
};

/**
 * Fields encrypted with the space key before entering TinyBase.
 * The DO stores and relays ciphertext — it never sees these values.
 * Untagged fields (booleans, timestamps) remain plaintext metadata.
 * Update this when changing your domain schema.
 */
export const ENCRYPTED_FIELDS_BY_TABLE: Record<string, string[]> = {
  [TODO_TABLE]: ['text'],
};

export const DEFAULT_CREATOR_ROLE = 'owner';
export const DEFAULT_INVITEE_ROLE = 'member';
export const DEFAULT_PERSONAL_SPACE_NAME = 'Personal';

/**
 * Whether a member with the given role (null = non-member) may write the table.
 * Mirrors the sync path: '*' = all tables, viewer = none, null/unknown = deny.
 * Use this to enforce role-based writes on the REST/MCP paths the same way the
 * WebSocket sync path enforces them via the JWT's writeTables claim.
 */
export function canWriteTable(role: string | null, tableId: string): boolean {
  if (!role) return false;
  const tables = WRITE_TABLES_BY_ROLE[role] ?? [];
  return tables.includes('*') || tables.includes(tableId);
}
