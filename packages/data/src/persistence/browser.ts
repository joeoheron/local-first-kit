import type {AppStore} from '../stores/createAppStore';
import {
  createLocalPersister,
  createOpfsPersister,
} from 'tinybase/persisters/persister-browser';
import {createEncryptedBrowserPersister} from './encryptedPersister';
import {STORAGE_PREFIX, OPFS_FILE_PREFIX} from '@local-first-kit/config';

export function buildStorageNames(userId = 'anonymous') {
  return {
    localStorageName: `${STORAGE_PREFIX}:${userId}`,
    fileSystemFileName: `${OPFS_FILE_PREFIX}-${userId}.json`,
  };
}

export type BrowserPersister = {
  load: () => Promise<unknown>;
  startAutoSave: () => Promise<unknown>;
  destroy: () => Promise<unknown>;
};

type FileSystemDirectory = {
  getFileHandle: (name: string, options: {create: boolean}) => Promise<unknown>;
  removeEntry: (name: string) => Promise<void>;
};

type BrowserNavigator = {
  storage?: {
    getDirectory?: () => Promise<FileSystemDirectory>;
  };
};

export type BrowserPersisterKind = 'fileSystem' | 'localStorage';

export type BrowserPersistence = {
  kind: BrowserPersisterKind;
  persister: BrowserPersister;
};

function getBrowserNavigator(): BrowserNavigator | undefined {
  const maybeGlobal = globalThis as typeof globalThis & {
    navigator?: BrowserNavigator;
  };
  return maybeGlobal.navigator;
}

function isUsableFileHandle(handle: unknown): boolean {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    'createWritable' in handle &&
    typeof handle.createWritable === 'function'
  );
}

async function createFileSystemPersister(
  store: AppStore,
  fileName: string,
  onIgnoredError?: (error: unknown) => void,
): Promise<BrowserPersister | undefined> {
  const directory = await getBrowserNavigator()?.storage?.getDirectory?.();
  if (!directory) return undefined;

  const handle = await directory.getFileHandle(fileName, {create: true});
  if (!isUsableFileHandle(handle)) return undefined;

  return createOpfsPersister(store, handle as never, onIgnoredError) as BrowserPersister;
}

export async function createBrowserPersister(
  store: AppStore,
  userId = 'anonymous',
  onIgnoredError?: (error: unknown) => void,
): Promise<BrowserPersistence> {
  const names = buildStorageNames(userId);

  try {
    const fileSystemPersister = await createFileSystemPersister(store, names.fileSystemFileName, onIgnoredError);
    if (fileSystemPersister) {
      return {kind: 'fileSystem', persister: fileSystemPersister};
    }
  } catch (error: unknown) {
    onIgnoredError?.(error);
  }

  return {
    kind: 'localStorage',
    persister: createLocalPersister(store, names.localStorageName, onIgnoredError),
  };
}

export async function startBrowserPersistence(
  store: AppStore,
  userId = 'anonymous',
  onIgnoredError?: (error: unknown) => void,
  encryptionKey?: CryptoKey,
): Promise<BrowserPersistence> {
  if (encryptionKey) {
    const encPersistence = await createEncryptedBrowserPersister(store, userId, encryptionKey, onIgnoredError);
    await encPersistence.persister.load();

    // Scenario 1 — Plaintext migration fallback:
    // If encrypted load found nothing, a prior session may have written plaintext
    // (PRF unavailable during credentials.create() on some platform authenticators,
    //  e.g. TPM-FIDO on Linux). See docs/scenarios/persistence-lifecycle-scenarios.md
    // DO NOT remove this fallback — it prevents data loss on re-login.
    if (!store.hasTables()) {
      const plainPersistence = await createBrowserPersister(store, userId, onIgnoredError);
      await plainPersistence.persister.load();
      const migrated = store.hasTables();
      await plainPersistence.persister.destroy().catch(() => {});
      if (migrated) {
        // Data now in memory from plaintext file. Clear both files so startAutoSave
        // creates a clean encrypted file without a stale plaintext copy alongside it.
        await clearBrowserPersistence(userId).catch(() => {});
      }
    }

    await encPersistence.persister.startAutoSave();
    return encPersistence;
  }

  const persistence = await createBrowserPersister(store, userId, onIgnoredError);
  await persistence.persister.load();
  await persistence.persister.startAutoSave();
  return persistence;
}

/** List all files in OPFS with their sizes. Returns empty array if OPFS is unavailable. */
export async function listBrowserPersistenceFiles(): Promise<Array<{name: string; size: number}>> {
  try {
    const dir = await getBrowserNavigator()?.storage?.getDirectory?.();
    if (!dir) return [];
    const files: Array<{name: string; size: number}> = [];
    type DirEntry = [string, {kind: string; getFile: () => Promise<File>}];
    for await (const [name, handle] of dir as unknown as AsyncIterable<DirEntry>) {
      if (handle.kind === 'file') {
        const file = await handle.getFile().catch(() => null);
        files.push({name, size: file?.size ?? -1});
      }
    }
    return files;
  } catch {
    return [];
  }
}

/** Delete the persisted store for a given user (best-effort, swallows errors). */
export async function clearBrowserPersistence(userId = 'anonymous'): Promise<void> {
  const names = buildStorageNames(userId);

  try {
    const directory = await getBrowserNavigator()?.storage?.getDirectory?.();
    if (directory) {
      await directory.removeEntry(names.fileSystemFileName).catch(() => {});
      await directory.removeEntry(names.fileSystemFileName + '.enc').catch(() => {});
      return;
    }
  } catch {
    // Fall through to localStorage
  }

  try {
    const ls = (globalThis as typeof globalThis & {localStorage?: Storage}).localStorage;
    ls?.removeItem(names.localStorageName);
    ls?.removeItem(names.localStorageName + ':encrypted');
  } catch {
    // Best-effort
  }
}
