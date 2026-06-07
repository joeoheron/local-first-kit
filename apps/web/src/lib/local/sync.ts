/**
 * Client-side TinyBase sync wrapper.
 *
 * Initializes createWsSynchronizer from tinybase/synchronizer-ws-client,
 * handling connect/reconnect. In this architecture, the JWT is NOT sent
 * by the client — the server-side proxy route at /sync/[spaceId] reads
 * the HttpOnly access_token cookie and injects ?token= before forwarding
 * to the Durable Object.
 *
 * Usage:
 *   const store = createSyncedStore(spaceStore, {
 *     serverUrl: 'ws://localhost:5173/sync/default',
 *   });
 *   // Connection happens in background; status updates via onStatusChange.
 */
import {createWsSynchronizer} from 'tinybase/synchronizers/synchronizer-ws-client';
import type {MergeableStore} from 'tinybase/mergeable-store';
import type {Synchronizer} from 'tinybase/synchronizers';

/** Connection status for the sync wrapper. */
export type SyncStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/** Options for creating a sync connection. */
export interface SyncOptions {
  /** WebSocket server URL (e.g. ws://localhost:5173/sync/default). */
  serverUrl: string;
  /** Optional request timeout in seconds (default: 1). */
  requestTimeoutSeconds?: number;
  /** Called when connection status changes. */
  onStatusChange?: (status: SyncStatus) => void;
}

/** Result of creating a synced store connection. */
export interface SyncedStore {
  /** Current connection status. */
  status: SyncStatus;
  /** Disconnect and clean up. */
  destroy: () => void;
}

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

function backoffDelay(attempt: number): number {
  const base = Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return base * (0.75 + Math.random() * 0.5); // ±25% jitter
}

/**
 * Create a sync connection for a MergeableStore.
 *
 * Returns immediately — the WebSocket connection is established in the
 * background. Use onStatusChange to track connection state. If the initial
 * connection fails, the store retries automatically with exponential backoff.
 */
export function createSyncedStore(
  store: MergeableStore,
  options: SyncOptions,
): SyncedStore {
  let status: SyncStatus = 'connecting';
  let currentWs: WebSocket | null = null;
  let currentSynchronizer: Synchronizer | null = null;

  const {serverUrl, requestTimeoutSeconds = 1, onStatusChange} = options;

  const setStatus = (newStatus: SyncStatus) => {
    status = newStatus;
    onStatusChange?.(newStatus);
  };

  let destroyed = false;
  let retryCount = 0;
  let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const attemptReconnect = async () => {
    if (destroyed) return;
    const delay = backoffDelay(retryCount++);
    setStatus('reconnecting');
    await new Promise<void>(resolve => { retryTimeoutId = setTimeout(resolve, delay); });
    retryTimeoutId = null;
    if (destroyed) return;
    try {
      await connect();
    } catch {
      setStatus('error');
    }
  };

  const connect = async (): Promise<void> => {
    setStatus('connecting');

    const ws = new WebSocket(serverUrl);
    currentWs = ws;

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), {once: true});
      ws.addEventListener('error', () => {
        setStatus('error');
        reject(new Error('WebSocket connection error'));
      }, {once: true});
      ws.addEventListener('close', () => {
        if (status !== 'disconnected') setStatus('disconnected');
        if (!destroyed) void attemptReconnect();
      }, {once: true});
    });

    // destroy() may have run while the socket was opening. Bail before creating a
    // synchronizer so we never leave a live one bound to a store the caller has already
    // moved on from — that "zombie" synchronizer is what let data bleed/wipe across spaces.
    if (destroyed) {
      ws.close();
      return;
    }

    const synchronizer = await createWsSynchronizer(
      store,
      ws,
      requestTimeoutSeconds,
    );
    if (destroyed) {
      await synchronizer.destroy(); // also closes the socket
      return;
    }

    await synchronizer.startSync();
    if (destroyed) {
      await synchronizer.destroy();
      return;
    }

    retryCount = 0;
    currentSynchronizer = synchronizer;
    setStatus('connected');
  };

  const destroy = () => {
    destroyed = true;
    if (retryTimeoutId !== null) {
      clearTimeout(retryTimeoutId);
      retryTimeoutId = null;
    }
    // Close the socket explicitly. An in-flight connect() may not have assigned
    // currentSynchronizer yet, so currentSynchronizer.destroy() alone could leak the
    // socket (and its open connection to the previous space's DO).
    currentSynchronizer?.destroy();
    currentWs?.close();
    currentWs = null;
    currentSynchronizer = null;
    setStatus('disconnected');
  };

  // Connect in background — failure is non-fatal, retry loop handles reconnection.
  void connect().catch(() => {
    if (!destroyed) setStatus('error');
  });

  return {status, destroy};
}
