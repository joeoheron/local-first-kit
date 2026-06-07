// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

declare global {
  /** D1Database type — sourced from @cloudflare/workers-types.
   *  We inline just the types here rather than importing the full workers-types
   *  package, which conflicts with browser DOM types in SvelteKit's check pipeline. */
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
    dump(): Promise<ArrayBuffer>;
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run(): Promise<D1Result>;
    all<T = unknown>(): Promise<D1Result<T>>;
    raw<T = unknown>(): Promise<T[]>;
  }

  interface D1Result<T = unknown> {
    results?: T[];
    success: boolean;
    error?: string;
    meta?: Record<string, unknown>;
  }

  interface D1ExecResult {
    count: number;
    duration: number;
    error?: string;
  }

  /** Inlined Durable Object types to avoid importing @cloudflare/workers-types. */
  interface DurableObjectId {
    toString(): string;
  }

  interface DurableObjectStub {
    fetch(request: Request | string, init?: RequestInit): Promise<Response>;
  }

  /** Typed RPC stub for the sync Durable Object — exposes named methods directly. */
  interface SyncDoStub {
    fetch(request: Request | string, init?: RequestInit): Promise<Response>;
    getRows(tableId: string): Promise<Array<Record<string, unknown>>>;
    getRow(tableId: string, rowId: string): Promise<Record<string, unknown> | null>;
    createRow(tableId: string, fields: Record<string, unknown>): Promise<string>;
    patchRow(tableId: string, rowId: string, fields: Record<string, unknown>): Promise<void>;
    deleteRow(tableId: string, rowId: string): Promise<void>;
  }

  namespace App {
    // interface Error {}
    interface Locals {
      /** Authenticated user info, set by hooks.server.ts.
       *  Null if the user is not logged in. */
      user: { id: string } | null;
    }
    // interface PageData {}
    // interface PageState {}
    interface Platform {
      env: {
        JWT_SECRET: string;
        DB: D1Database;
        /** Durable Object namespace for TinyBase sync. */
        SYNC_DO: {
          idFromName(name: string): DurableObjectId;
          get(id: DurableObjectId): SyncDoStub;
        };
        PUBLIC_SERVER_URL: string;
      };
    }
  }
}

export {};