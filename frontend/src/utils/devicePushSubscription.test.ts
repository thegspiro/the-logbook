import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
vi.mock('../services/apiClient', () => ({
  default: {
    post: (...a: unknown[]) => mockPost(...a) as unknown,
  },
}));

import { releaseDevicePushSubscription, resyncDevicePushSubscription } from './devicePushSubscription';

const SUB_JSON = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k', auth: 'a' } };

function makeSubscription() {
  return {
    endpoint: SUB_JSON.endpoint,
    toJSON: () => SUB_JSON,
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

/** `registration` undefined models a browser with no worker registered. */
function installServiceWorker(registration: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      // Never settles, as in a browser with no registration: anything that
      // waited on it would hang the sign-in that awaits these functions.
      ready: new Promise(() => {}),
    },
    configurable: true,
  });
}

function registrationWith(subscription: unknown) {
  return { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
}

describe('releaseDevicePushSubscription', () => {
  beforeEach(() => {
    mockPost.mockReset();
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
  });

  it('revokes the subscription in the browser', async () => {
    const subscription = makeSubscription();
    installServiceWorker(registrationWith(subscription));

    await releaseDevicePushSubscription();

    expect(subscription.unsubscribe).toHaveBeenCalledExactlyOnceWith();
    // The new member's session cannot delete the previous member's row; the
    // push service's 410 on the next send is what removes it.
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('resolves without a registration instead of waiting for one', async () => {
    installServiceWorker(undefined);

    await expect(releaseDevicePushSubscription()).resolves.toBeUndefined();
  });

  it('does not throw when the browser refuses to unsubscribe', async () => {
    const subscription = makeSubscription();
    subscription.unsubscribe.mockRejectedValue(new Error('refused'));
    installServiceWorker(registrationWith(subscription));

    await expect(releaseDevicePushSubscription()).resolves.toBeUndefined();
  });
});

describe('resyncDevicePushSubscription', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {} });
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
  });

  it('re-registers the browser subscription with the server', async () => {
    installServiceWorker(registrationWith(makeSubscription()));

    await resyncDevicePushSubscription();

    expect(mockPost).toHaveBeenCalledExactlyOnceWith('/notifications/push/subscribe', SUB_JSON);
  });

  it('sends nothing when this device has no subscription', async () => {
    installServiceWorker(registrationWith(null));

    await resyncDevicePushSubscription();

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not throw when the server has push turned off', async () => {
    installServiceWorker(registrationWith(makeSubscription()));
    mockPost.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { status: 503 }));

    await expect(resyncDevicePushSubscription()).resolves.toBeUndefined();
  });
});
