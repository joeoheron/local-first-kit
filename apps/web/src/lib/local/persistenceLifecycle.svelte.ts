/**
 * Reactive sync store — owns both the persistence and WebSocket sync lifecycles.
 *
 * Persistence:
 *   - Starts in anonymous mode on first browser load.
 *   - On login: switches to user-scoped persistence (load merges via CRDT).
 *   - On new account creation: caller chooses claim (keep anon data) or fresh (clear first).
 *   - On logout: clears storage if not a trusted device, restarts anonymous persistence.
 *
 * Encryption:
 *   - When an storageKey is provided (from passkey PRF), the persister uses AES-256-GCM
 *     for the local OPFS cache, and value-level encryption is activated for TinyBase cells
 *     tagged in ENCRYPTED_FIELDS_BY_TABLE (via domainCrypto).
 *   - Fallback is plaintext — no error if the authenticator doesn't support PRF.
 *
 * Sync:
 *   - Starts only when a user is authenticated and has a spaceId.
 */
import { browser } from '$app/environment';
import { createSpaceStore, type AppStore } from '$lib/local/appStore';
import { createSyncedStore, type SyncStatus, type SyncedStore } from '$lib/local/sync';
import {
  startBrowserPersistence,
  clearBrowserPersistence,
  type BrowserPersistence,
} from '@local-first-kit/data';
import {
  clearStorageKey,
  loadStorageKey,
  generateAesKey,
  wrapKey,
  unwrapKey,
  storeDeviceKey,
  loadDeviceKey,
  clearDeviceKey,
  storeSpaceKey,
  loadSpaceKey,
  clearSpaceKey,
  generateIdentityKeyPair,
  exportIdentityPublicKey,
  wrapKeyPkcs8,
  unwrapKeyPkcs8,
  storeIdentityKey,
  clearIdentityKey,
  generateEcdhKeyPair,
  exportEcdhPublicKey,
  storeEncPrivKey,
  loadEncPrivKey,
  clearEncPrivKey,
} from '$lib/local/crypto';
import { STORAGE_KEYS } from '$lib/local/storageKeys';
import { createDomainCrypto, type DomainCrypto } from '@local-first-kit/domain';

export interface SyncData {
  user: { id: string };
  publicServerUrl: string;
  spaceId: string;
  credentialId?: string;
}

const TRUSTED_DEVICE_KEY = STORAGE_KEYS.trustedDevice;

function buildWebSocketUrl(publicServerUrl: string, spaceId: string): string {
  const url = new URL(publicServerUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = `${path}/sync/${spaceId}`;
  return url.toString();
}

function isTrustedDevice(): boolean {
  try {
    return sessionStorage.getItem(TRUSTED_DEVICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markDeviceTrusted(): void {
  try {
    sessionStorage.setItem(TRUSTED_DEVICE_KEY, '1');
  } catch { /* best-effort */ }
}

async function setupNewAccountKeys(
  storageKey: CryptoKey,
  credentialId: string,
  userId: string,
  spaceId: string,
): Promise<DomainCrypto> {
  const deviceKey = await generateAesKey();
  const wrappedDeviceKey = await wrapKey(deviceKey, storageKey);
  await fetch('/api/keys/device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialId, wrappedKey: wrappedDeviceKey }),
  });
  await storeDeviceKey(deviceKey);

  const identityKeyPair = await generateIdentityKeyPair();
  const identityPublicKey = await exportIdentityPublicKey(identityKeyPair.publicKey);
  const wrappedIdentityKey = await wrapKeyPkcs8(identityKeyPair.privateKey, deviceKey);
  await fetch('/api/keys/identity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentialId,
      publicKey: identityPublicKey,
      wrappedPrivateKey: wrappedIdentityKey,
    }),
  });
  await storeIdentityKey(identityKeyPair.privateKey);

  const encKeyPair = await generateEcdhKeyPair();
  const encPublicKey = await exportEcdhPublicKey(encKeyPair.publicKey);
  const wrappedEncPrivKey = await wrapKeyPkcs8(encKeyPair.privateKey, deviceKey);
  await fetch('/api/keys/wrapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: encPublicKey, wrappedPrivateKey: wrappedEncPrivKey }),
  });
  await storeEncPrivKey(encKeyPair.privateKey);

  const spaceKey = await generateAesKey();
  const wrappedSpaceKey = await wrapKey(spaceKey, deviceKey);
  await fetch(`/api/keys/space/${spaceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wrappedKey: wrappedSpaceKey }),
  });
  await storeSpaceKey(spaceId, spaceKey);

  return createDomainCrypto(spaceKey);
}

async function loadExistingKeys(
  storageKey: CryptoKey,
  credentialId: string,
  spaceId: string,
): Promise<DomainCrypto | null> {
  try {
    const userRes = await fetch(`/api/keys/device?credentialId=${encodeURIComponent(credentialId)}`);
    if (!userRes.ok) return null;
    const { wrappedKey: wrappedDeviceKey } = await userRes.json() as { wrappedKey: string };
    const deviceKey = await unwrapKey(wrappedDeviceKey, storageKey);
    await storeDeviceKey(deviceKey);

    const identityRes = await fetch('/api/keys/identity');
    if (identityRes.ok) {
      const { wrappedPrivateKey } = await identityRes.json() as { wrappedPrivateKey: string };
      const identityKey = await unwrapKeyPkcs8(
        wrappedPrivateKey, deviceKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        ['sign'],
      );
      await storeIdentityKey(identityKey);
    }

    const encRes = await fetch('/api/keys/wrapping');
    if (encRes.ok) {
      const { wrappedPrivateKey: wrappedEncPrivKey } = await encRes.json() as { wrappedPrivateKey: string };
      const encPrivKey = await unwrapKeyPkcs8(
        wrappedEncPrivKey, deviceKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        ['deriveBits'],
      );
      await storeEncPrivKey(encPrivKey);
    }

    const spaceRes = await fetch(`/api/keys/space/${spaceId}`);
    if (!spaceRes.ok) return null;
    const { wrappedKey: wrappedSpaceKey } = await spaceRes.json() as { wrappedKey: string };
    const spaceKey = await unwrapKey(wrappedSpaceKey, deviceKey);
    await storeSpaceKey(spaceId, spaceKey);

    return createDomainCrypto(spaceKey);
  } catch (err) {
    return null;
  }
}

class SyncState {
  status: SyncStatus = $state('disconnected');
  domainCrypto: DomainCrypto | null = $state(null);
  activeSpaceId: string | null = $state(null);
  /** The active space's store. Swapped for a fresh instance on every space/account switch. */
  store: AppStore = $state(createSpaceStore());

  #persistence: BrowserPersistence | null = null;
  #currentUserId: string | null = null;
  #currentSpaceId: string | null = null;
  #anonymousPersistenceTask: Promise<void> | null = null;
  #currentSyncedStore: SyncedStore | null = null;
  #currentServerUrl: string | null = null;
  #isSwitchingSpace = false;

  constructor() {
    if (browser) {
      this.#startAnonymousPersistence();
    }
  }

  #startAnonymousPersistence(): void {
    this.#anonymousPersistenceTask = startBrowserPersistence(this.store, 'anonymous').then(p => {
      if (this.#currentUserId !== null) {
        p.persister.destroy().catch(() => {});
        return;
      }
      this.#persistence = p;
    }).catch(() => { /* best-effort */ });
  }

  async #stopPersistence(): Promise<void> {
    if (this.#persistence) {
      await this.#persistence.persister.destroy().catch(() => { /* best-effort */ });
      this.#persistence = null;
    }
  }

  #stopSync(): void {
    if (this.#currentSyncedStore) {
      this.#currentSyncedStore.destroy();
      this.#currentSyncedStore = null;
    }
    this.#currentServerUrl = null;
    this.status = 'disconnected';
  }

  #startSync(data: SyncData): void {
    if (this.#currentSpaceId !== null && this.#currentSpaceId !== data.spaceId) return;

    const serverUrl = buildWebSocketUrl(data.publicServerUrl, data.spaceId);
    if (this.#currentServerUrl === serverUrl && this.#currentSyncedStore) return;

    this.#stopSync();
    this.#currentServerUrl = serverUrl;

    this.#currentSyncedStore = createSyncedStore(this.store, {
      serverUrl,
      onStatusChange: (s: SyncStatus) => { this.status = s; },
    });
    this.status = this.#currentSyncedStore.status;
  }

  async #loadOrFetchSpaceKey(spaceId: string): Promise<CryptoKey | null> {
    const cached = await loadSpaceKey(spaceId);
    if (cached) return cached;

    const deviceKey = await loadDeviceKey();
    if (!deviceKey) return null;

    try {
      const res = await fetch(`/api/keys/space/${spaceId}`);
      if (!res.ok) return null;
      const { wrappedKey } = await res.json() as { wrappedKey: string };
      const spaceKey = await unwrapKey(wrappedKey, deviceKey);
      await storeSpaceKey(spaceId, spaceKey);
      return spaceKey;
    } catch {
      return null;
    }
  }

  /**
   * Login path: switch to user persistence, load (CRDT-merges with current in-memory
   * anonymous data), then load keys and start sync. Idempotent.
   */
  async enable(data: SyncData, storageKey?: CryptoKey): Promise<void> {
    if (!browser) return;
    if (this.#isSwitchingSpace) return;
    if (this.#currentUserId === data.user.id && this.#persistence !== null) {
      await this.#startSync(data);
      return;
    }
    // Scenario 4 — Anonymous persistence race guard:
    // Must await the anonymous persister before starting user persistence.
    // If we don't wait, the anonymous persister could resolve after enable()
    // and overwrite #persistence. See docs/scenarios/persistence-lifecycle-scenarios.md
    await this.#anonymousPersistenceTask;
    await this.#stopPersistence();
    // Fresh per-space store: starts empty so rows/tombstones accumulated during the
    // anonymous session can't propagate to the user's DO and wipe their data. The DO +
    // local OPFS become authoritative; sync and persistence load all rows on connect.
    this.store = createSpaceStore();
    this.#currentUserId = data.user.id;
    this.#currentSpaceId = data.spaceId;
    this.activeSpaceId = data.spaceId;
    this.#persistence = await startBrowserPersistence(this.store, `${data.user.id}:${data.spaceId}`, undefined, storageKey);

    if (storageKey && data.credentialId) {
      this.domainCrypto = await loadExistingKeys(storageKey, data.credentialId, data.spaceId);
    } else if (!storageKey) {
      // No PRF key available (authenticator doesn't support it, or this is the first
      // session after device-link on a non-PRF device). The device key may still be
      // in sessionStorage — placed there by linkRegister. Try to load the space key
      // directly using that in-memory device key so decryption works this session.
      const spaceKey = await this.#loadOrFetchSpaceKey(data.spaceId);
      if (spaceKey) this.domainCrypto = createDomainCrypto(spaceKey);
    }

    await this.#startSync(data);
  }

  /**
   * New account, claim anonymous data: switch to user persistence WITHOUT loading
   * (keeps current in-memory data), generate keys, save, then start sync.
   */
  async enableWithClaim(data: SyncData, storageKey?: CryptoKey): Promise<void> {
    if (!browser) return;
    await this.#anonymousPersistenceTask;
    await this.#stopPersistence();
    this.#currentUserId = data.user.id;
    this.#currentSpaceId = data.spaceId;
    this.activeSpaceId = data.spaceId;
    // Clear any stale user files so load() inside startBrowserPersistence is a no-op
    // (file gone → getPersisted returns undefined → setMergeableContent not called →
    // in-memory claimed data preserved). startAutoSave() then fires its initial save
    // correctly because the persister is in the loaded state after load().
    await clearBrowserPersistence(`${data.user.id}:${data.spaceId}`).catch(() => { /* best-effort */ });
    // Claim: reuse the current (anonymous) store so its in-memory content carries into
    // the user's space. load() is a no-op (file cleared above), so nothing overwrites it.
    this.#persistence = await startBrowserPersistence(this.store, `${data.user.id}:${data.spaceId}`, undefined, storageKey);
    await clearBrowserPersistence('anonymous').catch(() => { /* best-effort */ });

    if (storageKey && data.credentialId) {
      this.domainCrypto = await setupNewAccountKeys(storageKey, data.credentialId, data.user.id, data.spaceId);
    }

    await this.#startSync(data);
  }

  /**
   * New account, fresh start: clear in-memory store, clear anonymous storage,
   * generate keys, start user persistence, then start sync.
   */
  async enableFresh(data: SyncData, storageKey?: CryptoKey): Promise<void> {
    if (!browser) return;
    await this.#anonymousPersistenceTask;
    await this.#stopPersistence();
    this.#currentUserId = data.user.id;
    this.#currentSpaceId = data.spaceId;
    this.activeSpaceId = data.spaceId;
    // Fresh per-space store. Anonymous OPFS is left intact so those todos persist under
    // the 'anonymous' key, but this new account starts from an empty store.
    this.store = createSpaceStore();
    await clearBrowserPersistence(`${data.user.id}:${data.spaceId}`).catch(() => { /* best-effort */ });
    this.#persistence = await startBrowserPersistence(this.store, `${data.user.id}:${data.spaceId}`, undefined, storageKey);

    if (storageKey && data.credentialId) {
      this.domainCrypto = await setupNewAccountKeys(storageKey, data.credentialId, data.user.id, data.spaceId);
    }

    await this.#startSync(data);
  }

  /**
   * Switch to a different space mid-session. Stops active persistence and sync,
   * wipes the in-memory store, then starts fresh persistence and sync for the
   * new space. Space key is loaded from sessionStorage or fetched from D1 on demand.
   */
  async switchSpace(data: SyncData): Promise<void> {
    if (!browser || !this.#currentUserId) return;
    if (this.#currentSpaceId === data.spaceId) return;
    if (this.#isSwitchingSpace) return;

    this.#isSwitchingSpace = true;
    this.#currentSpaceId = data.spaceId;
    this.activeSpaceId = data.spaceId;

    try {
      // Pre-load keys before teardown so domainCrypto is set before new data arrives
      const opfsKey = await loadStorageKey();
      const spaceKey = await this.#loadOrFetchSpaceKey(data.spaceId);

      this.#stopSync();
      await this.#stopPersistence();
      // Fresh per-space store, bound only to the new space's DO + OPFS file. With no
      // shared mutable surface, a leaked/zombie synchronizer from the old space syncs its
      // own dereferenced store to the old DO and is harmless — it cannot reach this store.
      this.store = createSpaceStore();

      this.domainCrypto = spaceKey ? createDomainCrypto(spaceKey) : null;

      this.#persistence = await startBrowserPersistence(
        this.store,
        `${data.user.id}:${data.spaceId}`,
        undefined,
        opfsKey ?? undefined,
      );

      await this.#startSync(data);
    } finally {
      this.#isSwitchingSpace = false;
    }
  }

  /**
   * Logout: stop sync, stop persistence. If not a trusted device, wipe stored data
   * and restart anonymous persistence.
   */
  async disable(): Promise<void> {
    this.#stopSync();
    const userId = this.#currentUserId;
    const spaceId = this.#currentSpaceId;
    this.#currentUserId = null;
    this.#currentSpaceId = null;
    this.domainCrypto = null;
    this.activeSpaceId = null;
    await this.#stopPersistence();

    // Scenario 2 — Encryption key guard:
    // clearStorageKey() must stay inside the !isTrustedDevice() guard.
    // On trusted devices, the key survives logout in sessionStorage so re-login
    // can read the encrypted OPFS file even when PRF isn't available during get().
    // See docs/scenarios/persistence-lifecycle-scenarios.md
    // DO NOT move clearStorageKey() outside this guard.
    if (!isTrustedDevice() && userId) {
      await clearBrowserPersistence(userId && spaceId ? `${userId}:${spaceId}` : (userId ?? 'anonymous')).catch(() => { /* best-effort */ });
      clearStorageKey();
      clearDeviceKey();
      clearIdentityKey();
      clearEncPrivKey();
      if (spaceId) clearSpaceKey(spaceId);
    }

    if (browser) {
      // Fresh anonymous store for the post-logout session (replaces the user's store).
      this.store = createSpaceStore();
      this.#startAnonymousPersistence();
    }
  }
}

export const syncState = new SyncState();
