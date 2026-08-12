import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  nudgeServiceWorkerUpdate,
  activateFreshServiceWorker,
  reloadForNewVersion,
  registerServiceWorker,
} from './serviceWorkerUpdate';

/**
 * jsdom has no navigator.serviceWorker, so each test that needs one installs
 * this mock container. Extending EventTarget gives us a real
 * addEventListener/dispatchEvent pair for controllerchange.
 */
class MockServiceWorkerContainer extends EventTarget {
  getRegistration = vi.fn();
  register = vi.fn();
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

describe('nudgeServiceWorkerUpdate', () => {
  afterEach(() => {
    removeContainer();
    vi.restoreAllMocks();
  });

  it('is a no-op when service workers are unsupported', () => {
    removeContainer();
    expect(() => nudgeServiceWorkerUpdate()).not.toThrow();
  });

  it('calls registration.update()', async () => {
    const registration = makeRegistration();
    installContainer(registration);

    nudgeServiceWorkerUpdate();
    await flushAsync();

    expect(registration.update).toHaveBeenCalledExactlyOnceWith();
  });

  it('swallows getRegistration failures', async () => {
    const container = installContainer(undefined);
    container.getRegistration.mockRejectedValue(new Error('boom'));

    expect(() => nudgeServiceWorkerUpdate()).not.toThrow();
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

  it('gives up after the timeout when registration.update() never resolves', async () => {
    const registration = makeRegistration();
    registration.update.mockReturnValue(new Promise(() => undefined));
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

describe('registerServiceWorker', () => {
  afterEach(() => {
    removeContainer();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does nothing outside production builds', () => {
    const container = installContainer(undefined);

    registerServiceWorker(); // import.meta.env.PROD is false under vitest

    expect(container.register).not.toHaveBeenCalled();
  });

  it('registers /sw.js with updateViaCache none in production', () => {
    vi.stubEnv('PROD', true);
    const container = installContainer(undefined);
    container.register.mockResolvedValue(undefined);

    registerServiceWorker(); // jsdom documents are already 'complete'

    expect(container.register).toHaveBeenCalledExactlyOnceWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
  });

  it('waits for window load when the document is still loading', () => {
    vi.stubEnv('PROD', true);
    const container = installContainer(undefined);
    container.register.mockResolvedValue(undefined);
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

    registerServiceWorker();
    expect(container.register).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('load'));
    expect(container.register).toHaveBeenCalledExactlyOnceWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
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
