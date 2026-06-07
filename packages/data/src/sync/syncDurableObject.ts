/**
 * Authenticated TinyBase WebSocket sync Durable Object.
 *
 * Extends TinyBase's WsServerDurableObject with:
 * 1. JWT verification at WebSocket upgrade (rejects unverified tokens with 401)
 * 2. Durable Object SQLite persistence via createDurableObjectSqlStoragePersister
 * 3. Write-table enforcement via writeTables JWT claim
 * 4. Generic HTTP REST endpoints: GET/POST/PATCH/DELETE /:tableId[/:rowId]
 *    Callers supply all field values — the DO stores whatever it receives.
 *
 * Connection metadata (userId, role, writeTables) is stored in DO key-value storage
 * during fetch(), keyed by Sec-WebSocket-Key. This survives hibernation and is read
 * in webSocketMessage() via ctx.getTags(ws)[0] (TinyBase stores the key as tag[0]).
 *
 * Permission model:
 *   writeTables=['*']       → may write any table
 *   writeTables=['todos']   → may only write the todos table
 *   writeTables=[]          → read-only, all writes are dropped
 */
import {WsServerDurableObject as TinyBaseSyncDurableObject} from 'tinybase/synchronizers/synchronizer-ws-server-durable-object';
import {createDurableObjectSqlStoragePersister} from 'tinybase/persisters/persister-durable-object-sql-storage';
import {createMergeableStore, type MergeableStore} from 'tinybase/mergeable-store';
import {verifySpaceJwt, type JwtConfig, type VerifiedSpaceJwt} from '@local-first-kit/auth';
import {JWT_ISSUER} from '@local-first-kit/config';

// Re-export auth types consumed by sync clients (DO imports, web hooks, etc.)
export type {JwtConfig, VerifiedSpaceJwt};

export interface SyncEnv {
  JWT_SECRET: string;
}

type ConnectionMeta = { userId: string; role: string; writeTables: string[] };

export class WsServerDurableObject extends TinyBaseSyncDurableObject<SyncEnv> {
  declare readonly env: SyncEnv;

  #store!: MergeableStore;

  get #jwtConfig(): JwtConfig {
    return {
      secret: new TextEncoder().encode(this.env.JWT_SECRET),
      issuer: JWT_ISSUER,
      expiresInSeconds: 60,
    };
  }

  override createPersister() {
    this.#store = createMergeableStore();
    return createDurableObjectSqlStoragePersister(
      this.#store,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).ctx.storage.sql as any,
      {mode: 'fragmented', storagePrefix: 'tb_'},
    );
  }

  fetch(request: Request): Response | Promise<Response> {
    const isWebSocket = request.headers.get('upgrade')?.toLowerCase().includes('websocket') ?? false;
    if (!isWebSocket) return new Response('Method not allowed', {status: 405});

    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return new Response('Missing authentication token', {status: 401});

    const verified = verifySpaceJwt(this.#jwtConfig, token);
    if (!verified) return new Response('Invalid or expired token', {status: 401});

    const spaceIdFromPath = url.pathname.split('/').filter(Boolean).pop() ?? '';
    if (spaceIdFromPath !== verified.spaceId) return new Response('Forbidden', {status: 403});

    const clientId = request.headers.get('sec-websocket-key');
    if (!clientId) return new Response('Missing WebSocket key', {status: 400});

    return this.#acceptWebSocket(request, verified, clientId);
  }

  async #acceptWebSocket(
    request: Request,
    verified: VerifiedSpaceJwt,
    clientId: string,
  ): Promise<Response> {
    await this.ctx.storage.put<ConnectionMeta>(`ws:${clientId}`, {
      userId: verified.userId,
      role: verified.role,
      writeTables: verified.writeTables,
    });

    return (TinyBaseSyncDurableObject.prototype as unknown as {
      fetch: (request: Request) => Response | Promise<Response>;
    }).fetch.call(this, request);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let meta = ws.deserializeAttachment() as ConnectionMeta | null;

    if (!meta) {
      const clientId = this.ctx.getTags(ws)[0];
      if (clientId) {
        meta = (await this.ctx.storage.get<ConnectionMeta>(`ws:${clientId}`)) ?? null;
        if (meta) ws.serializeAttachment(meta);
      }
    }

    if (!meta) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    if (typeof message === 'string' && !this.#isWriteAllowed(message, meta)) {
      return;
    }

    super.webSocketMessage(ws, message);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const clientId = this.ctx.getTags(ws)[0];
    if (clientId) await this.ctx.storage.delete(`ws:${clientId}`);
    super.webSocketClose(ws);
  }

  /**
   * Check whether a TinyBase WebSocket message's writes are allowed by writeTables.
   *
   * Wire format (tinybase@^8.x): [requestId, messageType, body]
   * ContentDiff (type 3) body: [tablesStamped, valuesStamped[, 1]]
   *   tablesStamped: [{tableId: rows}, stamp, hash]
   * Only ContentDiff carries writes — all other types pass through.
   * Once a ContentDiff is confirmed, an unrecognised payload shape is denied (fail closed).
   */
  #isWriteAllowed(message: string, meta: ConnectionMeta): boolean {
    if (meta.writeTables.includes('*')) return true;

    const newlineAt = message.indexOf('\n');
    if (newlineAt === -1) return true;

    let parsed: unknown;
    try { parsed = JSON.parse(message.slice(newlineAt + 1)); } catch { return true; }

    if (!Array.isArray(parsed) || parsed.length < 3) return true;
    // ContentDiff = type 3. Only enforce policy on writes; all other types pass through.
    if (parsed[1] !== 3) return true;

    // Confirmed ContentDiff — fail closed if the payload structure is unrecognised.
    const body = parsed[2];
    if (!Array.isArray(body) || body.length < 1) return false;

    const tablesStamped = body[0]; // [{tableId: rows}, stamp, hash]
    if (!Array.isArray(tablesStamped) || tablesStamped.length < 1) return false;

    const tables = tablesStamped[0]; // {tableId: rows}
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return false;

    const {writeTables} = meta;
    for (const tableId of Object.keys(tables as Record<string, unknown>)) {
      if (!writeTables.includes(tableId)) return false;
    }

    return true;
  }

  async getRows(tableId: string): Promise<Array<Record<string, unknown>>> {
    const table = this.#store.getTable(tableId);
    return Object.entries(table)
      .filter(([, row]) => Object.values(row).some(v => v !== null))
      .map(([id, row]) => ({id, ...row}));
  }

  async getRow(tableId: string, rowId: string): Promise<Record<string, unknown> | null> {
    const row = this.#store.getRow(tableId, rowId);
    if (Object.keys(row).length === 0) return null;
    if (Object.values(row).every(v => v === null)) return null;
    return {id: rowId, ...row};
  }

  async createRow(tableId: string, fields: Record<string, unknown>): Promise<string> {
    const id = crypto.randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.#store.setRow(tableId, id, fields as any);
    return id;
  }

  async patchRow(tableId: string, rowId: string, fields: Record<string, unknown>): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.#store.setPartialRow(tableId, rowId, fields as any);
  }

  async deleteRow(tableId: string, rowId: string): Promise<void> {
    this.#store.delRow(tableId, rowId);
  }
}
