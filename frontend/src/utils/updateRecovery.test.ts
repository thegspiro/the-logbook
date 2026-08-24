import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReloadForNewVersion = vi.fn();
const mockPurgeAppCaches = vi.fn();
const mockCanReachServer = vi.fn();

vi.mock('./serviceWorkerUpdate', () => ({
  reloadForNewVersion: () => mockReloadForNewVersion() as Promise<void>,
}));

vi.mock('./forceAppRefresh', () => ({
  purgeAppCaches: () => mockPurgeAppCaches() as Promise<void>,
  canReachServer: () => mockCanReachServer() as Promise<boolean>,
}));

// Imported AFTER the mocks are in place.
import { applyAppUpdate, clearUpdateAttempts, nextRemedy, recordUpdateAttempt } from './updateRecovery';

const STORAGE_KEY = 'logbook:update-attempts';

describe('nextRemedy', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts at a plain reload when nothing has been tried', () => {
    expect(nextRemedy('build-a')).toBe('reload');
  });

  it('escalates to a cache purge after one failed attempt', () => {
    recordUpdateAttempt('build-a');
    expect(nextRemedy('build-a')).toBe('purge');
  });

  it('gives up after the purge rather than reloading forever', () => {
    recordUpdateAttempt('build-a');
    recordUpdateAttempt('build-a');
    expect(nextRemedy('build-a')).toBe('exhausted');
  });

  it('counts attempts per build, so a new deployment starts over', () => {
    recordUpdateAttempt('build-a');
    recordUpdateAttempt('build-a');
    expect(nextRemedy('build-a')).toBe('exhausted');

    // Whatever wedged this device may well be fixed by the build it is now
    // being offered — it must not inherit the previous build's failures.
    expect(nextRemedy('build-b')).toBe('reload');
  });

  it('forgets attempts older than a day', () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buildId: 'build-a', attempts: 2, at: twoDaysAgo }));

    expect(nextRemedy('build-a')).toBe('reload');
  });

  it('treats a malformed record as no record at all', () => {
    localStorage.setItem(STORAGE_KEY, 'not json');
    expect(nextRemedy('build-a')).toBe('reload');

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buildId: 7, attempts: 'lots' }));
    expect(nextRemedy('build-a')).toBe('reload');
  });

  it('is reset by clearUpdateAttempts', () => {
    recordUpdateAttempt('build-a');
    clearUpdateAttempts();
    expect(nextRemedy('build-a')).toBe('reload');
  });

  it('survives storage being unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => recordUpdateAttempt('build-a')).not.toThrow();
    // Without storage every attempt reads as the first, which retries the
    // plain reload rather than escalating — the safe direction.
    expect(nextRemedy('build-a')).toBe('reload');

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe('applyAppUpdate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockReloadForNewVersion.mockResolvedValue(undefined);
    mockPurgeAppCaches.mockResolvedValue(undefined);
    mockCanReachServer.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reloads without purging on the first attempt', async () => {
    await expect(applyAppUpdate('build-a')).resolves.toBe('reload');

    expect(mockPurgeAppCaches).not.toHaveBeenCalled();
    expect(mockReloadForNewVersion).toHaveBeenCalledExactlyOnceWith();
  });

  it('purges the caches on the second attempt at the same build', async () => {
    await applyAppUpdate('build-a');
    await expect(applyAppUpdate('build-a')).resolves.toBe('purge');

    expect(mockPurgeAppCaches).toHaveBeenCalledExactlyOnceWith();
    expect(mockReloadForNewVersion).toHaveBeenCalledTimes(2);
  });

  it('stops reloading once the ladder is exhausted', async () => {
    await applyAppUpdate('build-a');
    await applyAppUpdate('build-a');
    mockReloadForNewVersion.mockClear();

    await expect(applyAppUpdate('build-a')).resolves.toBe('exhausted');

    // The whole point: an app that reloads itself forever is worse than one
    // that admits it is stuck and points at Force refresh.
    expect(mockReloadForNewVersion).not.toHaveBeenCalled();
  });

  it('refuses to purge while the server is unreachable', async () => {
    await applyAppUpdate('build-a');
    mockCanReachServer.mockResolvedValue(false);

    await expect(applyAppUpdate('build-a')).resolves.toBe('reload');

    // Purging offline would delete the only working copy of the app.
    expect(mockPurgeAppCaches).not.toHaveBeenCalled();
    expect(mockReloadForNewVersion).toHaveBeenCalledTimes(2);
  });

  it('does not count an attempt it could not carry out, so the purge is still owed', async () => {
    await applyAppUpdate('build-a');
    mockCanReachServer.mockResolvedValue(false);
    await applyAppUpdate('build-a');

    mockCanReachServer.mockResolvedValue(true);
    await expect(applyAppUpdate('build-a')).resolves.toBe('purge');
    expect(mockPurgeAppCaches).toHaveBeenCalledExactlyOnceWith();
  });

  it('falls back to a plain reload when there is no build id to count against', async () => {
    await expect(applyAppUpdate()).resolves.toBe('reload');
    await expect(applyAppUpdate()).resolves.toBe('reload');

    expect(mockPurgeAppCaches).not.toHaveBeenCalled();
    expect(mockReloadForNewVersion).toHaveBeenCalledTimes(2);
  });
});
