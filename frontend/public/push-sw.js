/* global self, clients */
/**
 * Web Push handlers, pulled into the generated service worker via
 * `workbox.importScripts` in vite.config.ts.
 *
 * This lives as a separate plain-JS file rather than a custom service worker so
 * the build can stay on Workbox's generateSW mode — switching to injectManifest
 * to add two event listeners would mean hand-maintaining the precache and
 * runtime-caching rules that config already expresses.
 *
 * Payloads are JSON produced by PushService.send_to_user:
 *   { title, body, url, tag }
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push with a non-JSON body is not ours; showing raw text would leak
    // whatever it contains into a notification.
    return;
  }

  const title = payload.title || 'The Logbook';
  const options = {
    body: payload.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    // Collapses repeat notifications of the same kind rather than stacking
    // twelve "shift reminder" banners on the lock screen.
    tag: payload.tag || 'logbook',
    renotify: true,
    data: { url: payload.url || '/notifications?tab=inbox' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Prefer focusing an already-open window over opening a second copy of
      // the app, which on mobile leaves the user with duplicate task entries.
      for (const client of windowClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(target);
            } catch {
              // Cross-origin or otherwise not navigable — focus alone is fine.
            }
          }
          return;
        }
      }

      if (clients.openWindow) await clients.openWindow(target);
    })(),
  );
});
