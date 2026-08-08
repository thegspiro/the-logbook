import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('../services/apiClient', () => ({
  default: {
    get: (...a: unknown[]) => mockGet(...a) as unknown,
    post: (...a: unknown[]) => mockPost(...a) as unknown,
  },
}));

import { usePushNotifications } from './usePushNotifications';

const SUB = {
  endpoint: 'https://push.example/abc',
  toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

function installServiceWorker(existing: unknown = null) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(SUB),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  return pushManager;
}

function installNotification(permission: NotificationPermission, requestResult = permission) {
  const NotificationMock = {
    permission,
    requestPermission: vi.fn().mockResolvedValue(requestResult),
  };
  Object.defineProperty(window, 'Notification', {
    value: NotificationMock,
    configurable: true,
  });
  return NotificationMock;
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
    installServiceWorker(null);
    installNotification('default');
    // 'test' base64url-decodes fine; the value itself is not meaningful here.
    mockGet.mockResolvedValue({ data: { enabled: true, public_key: 'dGVzdA' } });
    mockPost.mockResolvedValue({ data: {} });
  });

  it('reports unsupported when the server has no VAPID keys configured', async () => {
    mockGet.mockResolvedValue({ data: { enabled: false, public_key: null } });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.supported).toBe(false));
  });

  it('reports supported once config and service worker are available', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.supported).toBe(true));
    expect(result.current.subscribed).toBe(false);
  });

  it('treats an unreachable config endpoint as push unavailable', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.supported).toBe(false));
  });

  it('detects an existing subscription on this device', async () => {
    installServiceWorker(SUB);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.subscribed).toBe(true));
  });

  it('registers the subscription with the server on subscribe', async () => {
    const pm = installServiceWorker(null);
    installNotification('default', 'granted');
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.supported).toBe(true));

    await act(async () => {
      await result.current.subscribe();
    });

    expect(pm.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(mockPost).toHaveBeenCalledWith('/notifications/push/subscribe', SUB.toJSON());
    expect(result.current.subscribed).toBe(true);
  });

  it('explains that a denied permission must be undone in browser settings', async () => {
    installNotification('default', 'denied');
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.supported).toBe(true));

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.subscribed).toBe(false);
    expect(result.current.error).toMatch(/browser settings/i);
  });

  it('tells the server before dropping the local subscription', async () => {
    installServiceWorker(SUB);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.subscribed).toBe(true));

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(mockPost).toHaveBeenCalledWith('/notifications/push/unsubscribe', {
      endpoint: SUB.endpoint,
    });
    expect(SUB.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.subscribed).toBe(false);
  });
});
