/**
 * This device's Web Push subscription at the boundary between members.
 *
 * A push subscription belongs to the browser profile, not to the member who
 * enabled it, and the server delivers to it by the account that registered it.
 * On a shared station computer that left the previous member's notifications
 * (event titles, certification alerts, officer notices) arriving on a lock
 * screen after they had gone, while the next member's settings read "on" for a
 * subscription the server had filed under someone else.
 *
 * Both functions look the registration up with `getRegistration()` rather than
 * waiting on `navigator.serviceWorker.ready`, which never settles when no
 * worker is registered and would hold the sign-in that awaits it. Both are
 * non-throwing: push is an enhancement, and a failure here must never stop a
 * member signing in.
 */

import api from '../services/apiClient';

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || typeof window === 'undefined' || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Drop this device's subscription because a different member has signed in.
 *
 * Unsubscribing in the browser revokes the endpoint at the push service, which
 * then answers the server's next send with 410; PushService.send_to_user prunes
 * the previous member's row on that answer. The server cannot be asked to
 * delete it directly: the session is already the new member's, and unsubscribe
 * is scoped to the caller's own subscriptions. The new member opts in again
 * themselves, on a browser permission they grant.
 */
export async function releaseDevicePushSubscription(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to release, or the browser refused. Sign-in carries on.
  }
}

/**
 * Re-register this device with the server for the member signing back in.
 *
 * The server can lose a subscription the browser still holds (a prune after a
 * push-service error, a database restore), and the settings toggle reads only
 * the browser, so it would show "on" for a device that receives nothing. The
 * subscribe endpoint is an idempotent refresh for an endpoint this member
 * already owns.
 */
export async function resyncDevicePushSubscription(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    if (subscription) await api.post('/notifications/push/subscribe', subscription.toJSON());
  } catch {
    // Push not configured on this server, or offline. The next sign-in retries.
  }
}
