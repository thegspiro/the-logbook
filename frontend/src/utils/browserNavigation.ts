/**
 * Leave the SPA for another site (an OAuth client's redirect URI, a sign-in
 * provider). A function of its own so a test can mock it: jsdom's
 * `window.location.assign` is non-configurable and cannot be spied on.
 */
export function leaveApp(url: string): void {
  window.location.assign(url);
}

/**
 * `target` if it is an http(s) URL, else null. The OAuth consent screen
 * follows only a web address — defence in depth behind the backend, which
 * builds the URL from the client's registered redirect URI — so a value that
 * somehow carried `javascript:` or `data:` is refused, not navigated to.
 */
export function safeRedirect(target: string): string | null {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
