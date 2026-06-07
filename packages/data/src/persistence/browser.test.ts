import {describe, expect, it, vi, test} from 'vitest';

import {buildStorageNames, clearBrowserPersistence} from './browser';

describe('buildStorageNames', () => {
  it('returns default names for anonymous user', () => {
    const names = buildStorageNames();
    expect(names.localStorageName).toBe(
      'local-first-kit:app-store:v1:anonymous',
    );
    expect(names.fileSystemFileName).toBe(
      'local-first-kit-app-store-v1-anonymous.json',
    );
  });

  it('returns correct names for a regular userId', () => {
    const names = buildStorageNames('user-42');
    expect(names.localStorageName).toBe(
      'local-first-kit:app-store:v1:user-42',
    );
    expect(names.fileSystemFileName).toBe(
      'local-first-kit-app-store-v1-user-42.json',
    );
  });

  it('returns correct names for UUID-format userId', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const names = buildStorageNames(id);
    expect(names.localStorageName).toBe(
      `local-first-kit:app-store:v1:${id}`,
    );
    expect(names.fileSystemFileName).toBe(
      `local-first-kit-app-store-v1-${id}.json`,
    );
  });

  it('handles userId with special characters', () => {
    const id = 'user@example.com';
    const names = buildStorageNames(id);
    expect(names.localStorageName).toBe(
      'local-first-kit:app-store:v1:user@example.com',
    );
    expect(names.fileSystemFileName).toBe(
      'local-first-kit-app-store-v1-user@example.com.json',
    );
  });

  it('handles empty string userId (falls through to empty, not anonymous)', () => {
    const names = buildStorageNames('');
    expect(names.localStorageName).toBe(
      'local-first-kit:app-store:v1:',
    );
    expect(names.fileSystemFileName).toBe(
      'local-first-kit-app-store-v1-.json',
    );
  });
});

describe('clearBrowserPersistence', () => {
  it('removes OPFS entries when navigator.storage.getDirectory is available', async () => {
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const getDirectory = vi.fn().mockResolvedValue({removeEntry});
    const storage = {getDirectory};

    // Stub globalThis.navigator.storage
    vi.stubGlobal('navigator', {storage});

    await clearBrowserPersistence('user-1');

    const names = buildStorageNames('user-1');
    expect(removeEntry).toHaveBeenCalledWith(names.fileSystemFileName);
    expect(removeEntry).toHaveBeenCalledWith(names.fileSystemFileName + '.enc');

    vi.unstubAllGlobals();
  });

  it('falls back to localStorage when OPFS is unavailable', async () => {
    const removeItem = vi.fn();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('localStorage', {removeItem});

    await clearBrowserPersistence('user-2');

    const names = buildStorageNames('user-2');
    expect(removeItem).toHaveBeenCalledWith(names.localStorageName);
    expect(removeItem).toHaveBeenCalledWith(names.localStorageName + ':encrypted');

    vi.unstubAllGlobals();
  });

  it('falls back to localStorage when getDirectory rejects', async () => {
    const removeItem = vi.fn();
    const getDirectory = vi.fn().mockRejectedValue(new Error('OPFS unavailable'));
    vi.stubGlobal('navigator', {storage: {getDirectory}});
    vi.stubGlobal('localStorage', {removeItem});

    await clearBrowserPersistence('user-3');

    const names = buildStorageNames('user-3');
    expect(removeItem).toHaveBeenCalledWith(names.localStorageName);
    expect(removeItem).toHaveBeenCalledWith(names.localStorageName + ':encrypted');

    vi.unstubAllGlobals();
  });
});

// tryPlaintextMigration is currently inlined in startBrowserPersistence() (lines 97-117 of browser.ts).
// It needs to be extracted as a standalone named export before it can be unit-tested.
// Skipping until that refactor happens.
test.skip('tryPlaintextMigration — needs extraction from startBrowserPersistence', () => {});