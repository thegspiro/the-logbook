/**
 * Where to send someone after they sign in.
 *
 * ProtectedRoute saves the location a signed-out visitor was stopped at, and
 * sign-in returns them there. It used to restore only the pathname, so a link
 * such as `/events?view=calendar` or `/scheduling?tab=open` landed on the
 * right page in its default state — the filter, tab or anchor the link was
 * shared for was gone.
 *
 * A session that expires *under* a page arrives differently: the API client
 * finds out from a 401 and has to leave with a full page load, which carries
 * no router state. It puts the page in the login URL's `from` parameter
 * instead (`loginPathReturningTo`), and the same check reads it from there.
 * That is what returns a member who tapped a room's NFC tag with a stale
 * session to the room rather than the dashboard (LOC-37).
 *
 * The target must stay inside the app: only a path beginning with a single
 * `/` is accepted, never `//host` (protocol-relative), `/\host` (which a
 * browser reads as `//host`) or a full URL, so crafted router state or a
 * crafted `?from=` cannot turn sign-in into an open redirect.
 */
export const DEFAULT_POST_LOGIN_PATH = '/dashboard';

/** The login URL's query parameter naming the page to return to. */
export const RETURN_TO_PARAM = 'from';

interface SavedLocation {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
}

// A backslash is read as `/` by a browser, and control characters are never
// part of a path the router produced — a tab or newline inside one is how
// `/\t/host` style tricks get past a prefix check.
function hasUnsafeChar(path: string): boolean {
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

function isAppPath(pathname: unknown): pathname is string {
  return (
    typeof pathname === 'string' && pathname.startsWith('/') && !pathname.startsWith('//') && !hasUnsafeChar(pathname)
  );
}

/**
 * Read a `?from=` the API client wrote into the login URL back into the shape
 * ProtectedRoute saves, or `null` when there is none worth trusting. The value
 * is parsed against a throwaway origin and accepted only if it stays on it.
 */
function savedLocationFromQuery(search: string): SavedLocation | null {
  const raw = new URLSearchParams(search).get(RETURN_TO_PARAM);
  if (!isAppPath(raw)) return null;
  const base = 'https://app.invalid';
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    return null;
  }
  if (parsed.origin !== base) return null;
  return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
}

/**
 * @param state  the login route's router state (`{ from }` from ProtectedRoute)
 * @param search the login URL's query string, read only when the state names
 *               no page — router state wins because it never left the app
 */
export function postLoginRedirect(state: unknown, search = ''): string {
  const fromState = (state as { from?: SavedLocation } | null)?.from;
  const from = isAppPath(fromState?.pathname) ? fromState : savedLocationFromQuery(search);
  const pathname = from?.pathname;
  if (!isAppPath(pathname)) {
    return DEFAULT_POST_LOGIN_PATH;
  }
  const query = typeof from?.search === 'string' && from.search.startsWith('?') ? from.search : '';
  const hash = typeof from?.hash === 'string' && from.hash.startsWith('#') ? from.hash : '';
  return `${pathname}${query}${hash}`;
}

/**
 * The login URL for a full-page redirect that should come back to `current`
 * after sign-in. A page that is already the login page, or the bare root
 * (which only forwards to the dashboard), returns plain `/login`.
 */
export function loginPathReturningTo(current: { pathname: string; search?: string; hash?: string }): string {
  const { pathname } = current;
  if (!isAppPath(pathname) || pathname === '/' || pathname === '/login' || pathname.startsWith('/login/')) {
    return '/login';
  }
  const target = `${pathname}${current.search ?? ''}${current.hash ?? ''}`;
  return `/login?${new URLSearchParams({ [RETURN_TO_PARAM]: target }).toString()}`;
}
