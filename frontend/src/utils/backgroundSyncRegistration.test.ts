import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestBackgroundSync } from './backgroundSyncRegistration';
import { BACKGROUND_SYNC_TAG } from '../sw/backgroundSyncProtocol';

function installServiceWorker(registration: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { getRegistration: vi.fn().mockResolvedValue(registration) },
    configurable: true,
  });
}

describe('requestBackgroundSync', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('registers the offline-sync tag where the browser supports Background Sync', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    installServiceWorker({ sync: { register } });

    await requestBackgroundSync();

    expect(register).toHaveBeenCalledExactlyOnceWith(BACKGROUND_SYNC_TAG);
  });

  it('does nothing in a browser without Background Sync, as Safari and Firefox are', async () => {
    installServiceWorker({});

    await expect(requestBackgroundSync()).resolves.toBeUndefined();
  });

  it('does nothing when no worker is registered, without waiting for one', async () => {
    installServiceWorker(undefined);

    await expect(requestBackgroundSync()).resolves.toBeUndefined();
  });

  it('never throws, so queuing an item cannot fail on it', async () => {
    installServiceWorker({ sync: { register: vi.fn().mockRejectedValue(new Error('NotAllowedError')) } });

    await expect(requestBackgroundSync()).resolves.toBeUndefined();
  });
});
