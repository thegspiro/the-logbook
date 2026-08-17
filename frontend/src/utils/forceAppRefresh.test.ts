import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canReachServer, forceAppRefresh, purgeAppCaches, purgeCacheStorage } from './forceAppRefresh';
import { getCached, setCache } from './apiCache';

/**
 * The reachability probe fetches /version.json. "Reachable" means a parseable
 * build id came back — not merely that something answered, which is what a
 * captive portal does.
 */
function mockReachable(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ buildId: 'server-build' }) })
  );
}

function mockOffline(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
}

/** A portal answers with a login page: HTTP 200, but not our version manifest. */
function mockCaptivePortal(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token <')) })
  );
}

function setOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

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
  setOnLine(true);
  mockReachable();
});

afterEach(() => {
  removeCaches();
  removeServiceWorker();
  setOnLine(true);
  vi.unstubAllGlobals();
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

describe('canReachServer', () => {
  it('is true when the app server answers with a real version manifest', async () => {
    await expect(canReachServer()).resolves.toBe(true);
  });

  it('is false when the request fails outright', async () => {
    mockOffline();
    await expect(canReachServer()).resolves.toBe(false);
  });

  it('is false behind a captive portal, which answers 200 with a login page', async () => {
    mockCaptivePortal();
    await expect(canReachServer()).resolves.toBe(false);
  });

  it('short-circuits without a request when the browser reports itself offline', async () => {
    setOnLine(false);

    await expect(canReachServer()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
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

  // The precache is the only offline copy of the app and workbox heals a
  // deleted entry only by fetching it, so purging offline would brick the
  // installed PWA until connectivity returned.
  it('touches nothing when the server is unreachable', async () => {
    mockOffline();
    const caches = installCaches(['app-chunks']);
    const registration = { update: vi.fn().mockResolvedValue(undefined) };
    installServiceWorker(registration);
    setCache('/events', [{ id: '1' }]);
    localStorage.setItem('departmentName', 'Old Name Fire Department');

    await expect(forceAppRefresh()).resolves.toBe('unreachable');

    expect(caches.delete).not.toHaveBeenCalled();
    expect(registration.update).not.toHaveBeenCalled();
    expect(getCached('/events')).not.toBeNull();
    expect(localStorage.getItem('departmentName')).toBe('Old Name Fire Department');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('touches nothing behind a captive portal', async () => {
    mockCaptivePortal();
    const caches = installCaches(['app-chunks']);

    await expect(forceAppRefresh()).resolves.toBe('unreachable');

    expect(caches.delete).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('reports that it is reloading when the purge does go ahead', async () => {
    installCaches([]);
    removeServiceWorker();

    await expect(forceAppRefresh()).resolves.toBe('reloading');
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
