/**
 * Where to send someone after they sign in.
 *
 * ProtectedRoute saves the location a signed-out visitor was stopped at, and
 * sign-in returns them there. It used to restore only the pathname, so a link
 * such as `/events?view=calendar` or `/scheduling?tab=open` landed on the
 * right page in its default state — the filter, tab or anchor the link was
 * shared for was gone.
 *
 * The target must stay inside the app: only a path beginning with a single
 * `/` is accepted, never `//host` (protocol-relative) or a full URL, so crafted
 * router state cannot turn sign-in into an open redirect.
 */
export const DEFAULT_POST_LOGIN_PATH = '/dashboard';

interface SavedLocation {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
}

export function postLoginRedirect(state: unknown): string {
  const from = (state as { from?: SavedLocation } | null)?.from;
  const pathname = from?.pathname;
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
    return DEFAULT_POST_LOGIN_PATH;
  }
  const search = typeof from?.search === 'string' && from.search.startsWith('?') ? from.search : '';
  const hash = typeof from?.hash === 'string' && from.hash.startsWith('#') ? from.hash : '';
  return `${pathname}${search}${hash}`;
}
