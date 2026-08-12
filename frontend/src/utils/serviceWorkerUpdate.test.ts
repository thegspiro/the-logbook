import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForServiceWorkerUpdate, activateFreshServiceWorker, reloadForNewVersion } from './serviceWorkerUpdate';

/**
 * jsdom has no navigator.serviceWorker, so each test that needs one installs
 * this mock container. Extending EventTarget gives us a real
 * addEventListener/dispatchEvent pair for controllerchange.
 */
class MockServiceWorkerContainer extends EventTarget {
  getRegistration = vi.fn();
}

interface MockRegistration {
  update: ReturnType<typeof vi.fn>;
  installing: ServiceWorker | null;
  waiting: ServiceWorker | null;
}

function makeRegistration(overrides: Partial<MockRegistration> = {}): MockRegistration {
  return {
    update: vi.fn().mockResolvedValue(undefined),
    installing: null,
    waiting: null,
    ...overrides,
  };
}

function installContainer(registration: MockRegistration | undefined): MockServiceWorkerContainer {
  const container = new MockServiceWorkerContainer();
  container.getRegistration.mockResolvedValue(registration);
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  });
  return container;
}

function removeContainer(): void {
  Reflect.deleteProperty(window.navigator, 'serviceWorker');
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('checkForServiceWorkerUpdate', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    removeContainer();
    vi.restoreAllMocks();
  });

  it('is a no-op when service workers are unsupported', () => {
    removeContainer();
    expect(() => checkForServiceWorkerUpdate(true)).not.toThrow();
  });

  it('calls registration.update() when forced', async () => {
    const registration = makeRegistration();
    installContainer(registration);

    checkForServiceWorkerUpdate(true);
    await flushAsync();

    expect(registration.update).toHaveBeenCalledExactlyOnceWith();
  });

  it('does not check while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const registration = makeRegistration();
    const container = installContainer(registration);

    checkForServiceWorkerUpdate(true);
    await flushAsync();

    expect(container.getRegistration).not.toHaveBeenCalled();
  });

  it('rate-limits unforced checks and lets them through after the window', async () => {
    const registration = makeRegistration();
    installContainer(registration);

    const nowSpy = vi.spyOn(Date, 'now');
    const base = 1_700_000_000_000;

    // Forced check stamps the rate-limit clock at `base`.
    nowSpy.mockReturnValue(base);
    checkForServiceWorkerUpdate(true);
    await flushAsync();
    expect(registration.update).toHaveBeenCalledTimes(1);

    // 10s later — inside the 60s window, unforced check is suppressed.
    nowSpy.mockReturnValue(base + 10_000);
    checkForServiceWorkerUpdate();
    await flushAsync();
    expect(registration.update).toHaveBeenCalledTimes(1);

    // 61s later — window elapsed, check goes through.
    nowSpy.mockReturnValue(base + 61_000);
    checkForServiceWorkerUpdate();
    await flushAsync();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('swallows getRegistration failures', async () => {
    const container = installContainer(undefined);
    container.getRegistration.mockRejectedValue(new Error('boom'));

    expect(() => checkForServiceWorkerUpdate(true)).not.toThrow();
    await flushAsync();
  });
});

describe('activateFreshServiceWorker', () => {
  afterEach(() => {
    removeContainer();
    vi.restoreAllMocks();
  });

  it('resolves immediately when service workers are unsupported', async () => {
    removeContainer();
    await expect(activateFreshServiceWorker()).resolves.toBeUndefined();
  });

  it('resolves when there is no registration', async () => {
    installContainer(undefined);
    await expect(activateFreshServiceWorker()).resolves.toBeUndefined();
  });

  it('resolves without waiting when the update check finds nothing new', async () => {
    const registration = makeRegistration();
    installContainer(registration);

    // No timeout advance needed — must resolve on its own.
    await expect(activateFreshServiceWorker(10_000)).resolves.toBeUndefined();
    expect(registration.update).toHaveBeenCalledExactlyOnceWith();
  });

  it('waits for controllerchange when a new worker is installing', async () => {
    const registration = makeRegistration({ installing: {} as ServiceWorker });
    const container = installContainer(registration);

    let resolved = false;
    const promise = activateFreshServiceWorker(10_000).then(() => {
      resolved = true;
    });
    await flushAsync();
    expect(resolved).toBe(false);

    container.dispatchEvent(new Event('controllerchange'));
    await promise;
    expect(resolved).toBe(true);
  });

  it('gives up after the timeout when controllerchange never fires', async () => {
    const registration = makeRegistration({ installing: {} as ServiceWorker });
    installContainer(registration);

    await expect(activateFreshServiceWorker(20)).resolves.toBeUndefined();
  });

  it('resolves when registration.update() rejects', async () => {
    const registration = makeRegistration();
    registration.update.mockRejectedValue(new Error('sw fetch failed'));
    installContainer(registration);

    await expect(activateFreshServiceWorker(10_000)).resolves.toBeUndefined();
  });
});

describe('reloadForNewVersion', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { reload: vi.fn() },
    });
  });

  afterEach(() => {
    removeContainer();
    vi.restoreAllMocks();
  });

  it('reloads even when service workers are unsupported', async () => {
    removeContainer();
    await reloadForNewVersion();
    expect(window.location.reload).toHaveBeenCalledExactlyOnceWith();
  });

  it('activates the fresh worker before reloading', async () => {
    const registration = makeRegistration();
    installContainer(registration);

    await reloadForNewVersion();

    expect(registration.update).toHaveBeenCalledExactlyOnceWith();
    expect(window.location.reload).toHaveBeenCalledExactlyOnceWith();
  });
});
