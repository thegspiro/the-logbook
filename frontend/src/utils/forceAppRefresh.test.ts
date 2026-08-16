import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forceAppRefresh, purgeAppCaches, purgeCacheStorage } from './forceAppRefresh';
import { getCached, setCache } from './apiCache';

/**
 * jsdom implements neither Cache Storage nor navigator.serviceWorker, so both
 * are installed per-test and torn down afterwards.
 */
interface MockCacheStorage {
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function installCaches(keys: string[]): MockCacheStorage {
  const mock: MockCacheStorage = {
    keys: vi.fn().mockResolvedValue(keys),
    delete: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(globalThis, 'caches', { value: mock, configurable: true, writable: true });
  return mock;
}

function removeCaches(): void {
  Reflect.deleteProperty(globalThis, 'caches');
}

class MockServiceWorkerContainer extends EventTarget {
  getRegistration = vi.fn();
  register = vi.fn();
}

function installServiceWorker(registration: { update: ReturnType<typeof vi.fn> } | undefined): void {
  const container = new MockServiceWorkerContainer();
  container.getRegistration.mockResolvedValue(registration);
  Object.defineProperty(window.navigator, 'serviceWorker', { value: container, configurable: true });
}

function removeServiceWorker(): void {
  Reflect.deleteProperty(window.navigator, 'serviceWorker');
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'location', { writable: true, value: { reload: vi.fn() } });
});

afterEach(() => {
  removeCaches();
  removeServiceWorker();
  vi.restoreAllMocks();
});

describe('purgeCacheStorage', () => {
  it('deletes every cache bucket', async () => {
    const caches = installCaches(['workbox-precache-v2-https://logbook/', 'app-chunks']);

    await purgeCacheStorage();

    expect(caches.delete).toHaveBeenCalledTimes(2);
    expect(caches.delete).toHaveBeenCalledWith('app-chunks');
  });

  it('resolves when the Cache Storage API is unavailable', async () => {
    removeCaches();
    await expect(purgeCacheStorage()).resolves.toBeUndefined();
  });

  it('does not reject when a single delete fails', async () => {
    const caches = installCaches(['app-chunks', 'workbox-precache']);
    caches.delete.mockRejectedValueOnce(new Error('storage busy'));

    await expect(purgeCacheStorage()).resolves.toBeUndefined();
    expect(caches.delete).toHaveBeenCalledTimes(2);
  });

  it('does not reject when keys() itself fails', async () => {
    const caches = installCaches([]);
    caches.keys.mockRejectedValue(new Error('blocked'));

    await expect(purgeCacheStorage()).resolves.toBeUndefined();
  });
});

describe('purgeAppCaches', () => {
  it('drops in-memory API responses', async () => {
    installCaches([]);
    setCache('/events', [{ id: '1' }]);
    expect(getCached('/events')).not.toBeNull();

    await purgeAppCaches();

    expect(getCached('/events')).toBeNull();
  });

  it('drops the branding copies that AppLayout would otherwise reuse forever', async () => {
    installCaches([]);
    localStorage.setItem('departmentName', 'Old Name Fire Department');
    localStorage.setItem('logoData', 'https://cdn.example/old-logo.png');

    await purgeAppCaches();

    expect(localStorage.getItem('departmentName')).toBeNull();
    expect(localStorage.getItem('logoData')).toBeNull();
  });

  it('keeps the session flag — a refresh is not a logout', async () => {
    installCaches([]);
    localStorage.setItem('has_session', 'true');

    await purgeAppCaches();

    expect(localStorage.getItem('has_session')).toBe('true');
  });
});

describe('forceAppRefresh', () => {
  it('purges, pulls a fresh worker, then reloads', async () => {
    const caches = installCaches(['app-chunks']);
    const registration = { update: vi.fn().mockResolvedValue(undefined) };
    installServiceWorker(registration);
    setCache('/events', [{ id: '1' }]);

    await forceAppRefresh();

    expect(caches.delete).toHaveBeenCalledWith('app-chunks');
    expect(registration.update).toHaveBeenCalledExactlyOnceWith();
    expect(getCached('/events')).toBeNull();
    expect(window.location.reload).toHaveBeenCalledExactlyOnceWith();
  });

  it('reloads even with no service worker and no Cache Storage', async () => {
    removeCaches();
    removeServiceWorker();

    await forceAppRefresh();

    expect(window.location.reload).toHaveBeenCalledExactlyOnceWith();
  });

  it('reloads even when the purge throws', async () => {
    const caches = installCaches([]);
    caches.keys.mockImplementation(() => {
      throw new Error('storage disabled');
    });
    removeServiceWorker();

    await forceAppRefresh();

    expect(window.location.reload).toHaveBeenCalledExactlyOnceWith();
  });
});
