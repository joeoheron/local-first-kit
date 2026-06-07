/**
 * MCP (Model Context Protocol) server endpoint.
 *
 * Implements MCP over HTTP using JSON-RPC 2.0.
 * Auth: Bearer API token only — no session cookies (this endpoint is for agents).
 *
 * Supported methods: initialize, tools/list, tools/call
 * Tools: list_todos, add_todo, toggle_todo, delete_todo
 *
 * Usage (Claude Desktop or any MCP client):
 *   POST /mcp
 *   Authorization: Bearer <api-token>
 *   Content-Type: application/json
 */
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { verifyApiToken } from '$lib/server/apiTokens';
import { doGetRows, doGetRow, doCreateRow, doPatchRow, doDeleteRow } from '$lib/server/durableObjectClient';
import { getUserSpace, getUserSpaces, getSpaceMembership } from '$lib/server/collab/spaces';
import { decryptCell } from '$lib/local/crypto';
import { resolveSpaceKey, encryptRowForTable, MissingSpaceKeyError } from '$lib/server/spaceKey';
import { ENCRYPTED_FIELDS_BY_TABLE, TODO_TABLE, canWriteTable } from '@local-first-kit/domain';
import { APP_DISPLAY_NAME } from '@local-first-kit/config';

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'list_todos',
    description: 'List all todos',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_todo',
    description: 'Add a new todo item',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The todo text' } },
      required: ['text'],
    },
  },
  {
    name: 'toggle_todo',
    description: "Toggle a todo's completed status",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The todo ID' } },
      required: ['id'],
    },
  },
  {
    name: 'delete_todo',
    description: 'Delete a todo',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The todo ID' } },
      required: ['id'],
    },
  },
  {
    name: 'list_spaces',
    description: 'List all spaces the current user belongs to, with their IDs, names, and roles',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function mcpResult(id: unknown, result: unknown) {
  return json({ jsonrpc: '2.0', id, result });
}

function mcpError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', id, error: { code, message } });
}

function textContent(text: string) {
  return { content: [{ type: 'text', text }] };
}

/** Decrypt all encrypted fields in a row object using the space key. */
async function decryptRow(
  row: Record<string, unknown>,
  table: string,
  spaceKey: CryptoKey,
): Promise<Record<string, unknown>> {
  const encryptedFields = new Set(ENCRYPTED_FIELDS_BY_TABLE[table] ?? []);
  if (encryptedFields.size === 0) return row;
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row)) {
    if (encryptedFields.has(field) && typeof value === 'string') {
      result[field] = await decryptCell(value, spaceKey);
    } else {
      result[field] = value;
    }
  }
  return result;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  // MCP only accepts Bearer API tokens — no session cookies
  const authHeader = request.headers.get('authorization');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!rawToken) return json({ error: 'Bearer token required' }, { status: 401 });
  if (!platform?.env) return json({ error: 'Service unavailable' }, { status: 503 });

  const auth = await verifyApiToken(platform.env.DB, rawToken);
  if (!auth) return json({ error: 'Invalid or expired token' }, { status: 401 });

  // verifyApiToken already re-checked membership against the token's space and
  // returned the current role, so list_todos (read) is gated too — a removed user's
  // token is rejected above. Only the null-spaceId edge (dead for real tokens, which
  // always have a space) falls back to the personal space and re-checks there.
  let spaceId = auth.spaceId;
  let role = auth.role;
  if (!spaceId) {
    spaceId = (await getUserSpace(platform.env.DB, auth.userId))?.id ?? null;
    if (!spaceId) return json({ error: 'No space found' }, { status: 403 });
    role = await getSpaceMembership(platform.env.DB, auth.userId, spaceId);
  }

  // Unwrap the space key so we can decrypt/encrypt field values. Returns null for
  // tokens created without key escrow (or without PRF support) — reads then return
  // ciphertext, and encrypted-field writes fail closed below rather than leak plaintext.
  const spaceKey = await resolveSpaceKey(rawToken, auth.wrappedSpaceKey);

  let body: { jsonrpc: string; method: string; id?: unknown; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return mcpError(null, -32700, 'Parse error');
  }

  const { method, id, params } = body;

  if (method === 'initialize') {
    return mcpResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: APP_DISPLAY_NAME, version: '1.0' },
    });
  }

  if (method === 'tools/list') {
    return mcpResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };

    if (name === 'list_todos') {
      let rowsArr: Array<Record<string, unknown>>;
      try {
        rowsArr = await doGetRows(platform, spaceId, 'todos');
      } catch (e) {
        return mcpError(id, -32603, `Sync error: ${e}`);
      }
      let rows = Object.fromEntries(rowsArr.map(row => [row.id as string, row]));
      if (spaceKey) {
        const decrypted: Record<string, Record<string, unknown>> = {};
        for (const [rowId, row] of Object.entries(rows)) {
          decrypted[rowId] = await decryptRow(row, TODO_TABLE, spaceKey);
        }
        rows = decrypted;
      }
      return mcpResult(id, textContent(JSON.stringify(rows, null, 2)));
    }

    if (name === 'add_todo') {
      if (auth.scope === 'read') return mcpError(id, -32600, 'Read-only token');
      if (!canWriteTable(role, TODO_TABLE)) return mcpError(id, -32600, 'Insufficient permissions');
      const now = Date.now();
      let row;
      try {
        row = await encryptRowForTable(TODO_TABLE, {
          text: args.text as string,
          completed: false,
          createdAt: now,
          updatedAt: now,
          createdBy: auth.userId,
        }, spaceKey);
      } catch (e) {
        if (e instanceof MissingSpaceKeyError) {
          return mcpError(id, -32600, 'Cannot add todo: this token has no escrowed space key to encrypt the text');
        }
        return mcpError(id, -32603, `Encryption error: ${e}`);
      }
      let newId: string;
      try {
        newId = await doCreateRow(platform, spaceId, 'todos', row);
      } catch (e) {
        return mcpError(id, -32603, `Sync error: ${e}`);
      }
      return mcpResult(id, textContent(JSON.stringify({ id: newId })));
    }

    if (name === 'toggle_todo') {
      if (auth.scope === 'read') return mcpError(id, -32600, 'Read-only token');
      if (!canWriteTable(role, TODO_TABLE)) return mcpError(id, -32600, 'Insufficient permissions');
      let row: Record<string, unknown> | null;
      try {
        row = await doGetRow(platform, spaceId, 'todos', args.id as string);
      } catch (e) {
        return mcpError(id, -32603, `Sync error: ${e}`);
      }
      if (!row || Object.values(row).every(v => v === null)) return mcpError(id, -32600, 'Todo not found');
      try {
        await doPatchRow(platform, spaceId, 'todos', args.id as string, {
          completed: !(row.completed as boolean),
          updatedAt: Date.now(),
        });
      } catch (e) {
        return mcpError(id, -32603, `Sync error: ${e}`);
      }
      return mcpResult(id, textContent('toggled'));
    }

    if (name === 'delete_todo') {
      if (auth.scope === 'read') return mcpError(id, -32600, 'Read-only token');
      if (!canWriteTable(role, TODO_TABLE)) return mcpError(id, -32600, 'Insufficient permissions');
      try {
        await doDeleteRow(platform, spaceId, 'todos', args.id as string);
      } catch (e) {
        return mcpError(id, -32603, `Delete failed: ${e}`);
      }
      return mcpResult(id, textContent('deleted'));
    }

    if (name === 'list_spaces') {
      const spaces = await getUserSpaces(platform.env.DB, auth.userId);
      return mcpResult(id, textContent(JSON.stringify(spaces, null, 2)));
    }

    return mcpError(id, -32601, `Unknown tool: ${name}`);
  }

  return mcpError(id, -32601, `Method not found: ${method}`);
};
