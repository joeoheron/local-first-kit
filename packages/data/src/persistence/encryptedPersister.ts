import {createCustomPersister} from 'tinybase/persisters';
import type {AppStore} from '../stores/createAppStore';
import type {BrowserPersistence} from './browser';
import {buildStorageNames} from './browser';

type FileSystemDirectory = {
  getFileHandle: (name: string, options: {create: boolean}) => Promise<unknown>;
};

type WritableStream = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

type FileHandle = {
  createWritable: () => Promise<WritableStream>;
  getFile: () => Promise<File>;
};

function getBrowserNavigator(): {storage?: {getDirectory?: () => Promise<FileSystemDirectory>}} | undefined {
  const g = globalThis as typeof globalThis & {navigator?: unknown};
  return g.navigator as ReturnType<typeof getBrowserNavigator>;
}

async function getOpfsDirectory(): Promise<FileSystemDirectory | undefined> {
  try {
    return await getBrowserNavigator()?.storage?.getDirectory?.();
  } catch {
    return undefined;
  }
}

async function readOpfsFile(directory: FileSystemDirectory, fileName: string): Promise<Uint8Array | null> {
  try {
    const handle = await directory.getFileHandle(fileName, {create: false}) as FileHandle;
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function writeOpfsFile(directory: FileSystemDirectory, fileName: string, data: Uint8Array): Promise<void> {
  const handle = await directory.getFileHandle(fileName, {create: true}) as FileHandle;
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

function getLocalStorage(): Storage | undefined {
  return (globalThis as typeof globalThis & {localStorage?: Storage}).localStorage;
}

function lsReadBytes(key: string): Uint8Array | null {
  const b64 = getLocalStorage()?.getItem(key);
  if (!b64) return null;
  try {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function lsWriteBytes(key: string, data: Uint8Array): void {
  const b64 = btoa(String.fromCharCode(...data));
  getLocalStorage()?.setItem(key, b64);
}

async function encryptJson(key: CryptoKey, data: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, plaintext);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

async function decryptJson(key: CryptoKey, data: Uint8Array): Promise<unknown> {
  if (data.length < 12) throw new Error('Ciphertext too short');
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv}, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Creates a browser persister that encrypts all data with AES-256-GCM.
 * Uses OPFS if available, falls back to localStorage.
 * IV is a random 12 bytes prepended to each ciphertext.
 */
export async function createEncryptedBrowserPersister(
  store: AppStore,
  userId: string,
  encryptionKey: CryptoKey,
  onIgnoredError?: (error: unknown) => void,
): Promise<BrowserPersistence> {
  const names = buildStorageNames(userId);
  const encFileName = names.fileSystemFileName + '.enc';
  const lsKey = names.localStorageName + ':encrypted';

  const directory = await getOpfsDirectory();
  const kind = directory ? 'fileSystem' : 'localStorage';

  // Cast through unknown: the Persists const enum can't be used as a value with
  // verbatimModuleSyntax (it's ambient). The runtime persister API is identical
  // regardless of the Persist generic — only the inferred Content type changes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persister = (createCustomPersister as any)(
    store,
    async () => {
      try {
        const raw = directory
          ? await readOpfsFile(directory, encFileName)
          : lsReadBytes(lsKey);
        if (!raw || raw.length < 12) return undefined;
        return await decryptJson(encryptionKey, raw);
      } catch (err) {
        onIgnoredError?.(err);
        return undefined;
      }
    },
    async (getContent: () => unknown) => {
      try {
        const content = getContent();
        const encrypted = await encryptJson(encryptionKey, content);
        if (directory) {
          await writeOpfsFile(directory, encFileName, encrypted);
        } else {
          lsWriteBytes(lsKey, encrypted);
        }
      } catch (err) {
        onIgnoredError?.(err);
      }
    },
    (_listener: unknown) => undefined,
    (_listenerId: unknown) => undefined,
    onIgnoredError,
    2, // Persists.MergeableStoreOnly — cannot use const enum as value with verbatimModuleSyntax
  );

  return {kind, persister};
}
