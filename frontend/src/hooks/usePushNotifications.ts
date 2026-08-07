import { useState, useEffect, useCallback } from 'react';
import api from '../services/apiClient';

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface UsePushNotifications {
  /** The browser can do push AND the server is configured to send it. */
  supported: boolean;
  /** This device already has a live subscription. */
  subscribed: boolean;
  /** Notification.permission, or 'default' before any prompt. */
  permission: NotificationPermission;
  /** True while a subscribe/unsubscribe round trip is in flight. */
  busy: boolean;
  /** Set when the last attempt failed, for display next to the control. */
  error: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}

/**
 * VAPID public keys are transported as base64url; PushManager.subscribe wants
 * raw bytes, and atob only understands standard base64 with padding.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  // Backed by an explicit ArrayBuffer: the default Uint8Array type parameter is
  // ArrayBufferLike, which admits SharedArrayBuffer and so is not assignable to
  // applicationServerKey's BufferSource.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function browserSupportsPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Manages this device's Web Push subscription.
 *
 * Push is only offered when the browser supports it *and* the server has VAPID
 * keys configured — otherwise the control is hidden rather than shown and
 * failing on tap. On iOS the whole API exists only once the PWA has been added
 * to the home screen, so an iPhone user in Safari correctly sees nothing here.
 */
export function usePushNotifications(): UsePushNotifications {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(
    browserSupportsPush() ? Notification.permission : 'default',
  );

  useEffect(() => {
    if (!browserSupportsPush()) return;
    let cancelled = false;

    void (async () => {
      try {
        // The notifications schemas do not use the camelCase alias generator,
        // so this endpoint responds in snake_case like the rest of the module.
        const { data } = await api.get<{ enabled: boolean; public_key: string | null }>(
          '/notifications/push/config',
        );
        if (cancelled) return;
        setConfig({ enabled: data.enabled, publicKey: data.public_key });

        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(existing !== null);
      } catch {
        // Config unreachable (offline, or endpoint absent on an older server):
        // treat push as unavailable rather than showing a broken toggle.
        if (!cancelled) setConfig({ enabled: false, publicKey: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!config?.enabled || !config.publicKey) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        // Denial is sticky: the browser will not prompt again, and the user has
        // to undo it in site settings. Say so rather than letting a silent
        // no-op look like a bug.
        setError(
          result === 'denied'
            ? 'Notifications are blocked for this site. Re-enable them in your browser settings.'
            : 'Notification permission was dismissed.',
        );
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Required to be true by every current browser: silent push is not
          // permitted, each message must show a notification.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        }));

      await api.post('/notifications/push/subscribe', sub.toJSON());
      setSubscribed(true);
      return true;
    } catch {
      setError('Could not enable push notifications on this device.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [config]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Tell the server first: if the browser-side unsubscribe succeeds but
        // the request fails, the server keeps pushing to a dead endpoint until
        // it is pruned on a 410.
        await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      setError('Could not turn off push notifications on this device.');
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    supported: browserSupportsPush() && config?.enabled === true,
    subscribed,
    permission,
    busy,
    error,
    subscribe,
    unsubscribe,
  };
}
