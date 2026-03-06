/**
 * Authentication Store
 *
 * Manages authentication state using Zustand.
 *
 * SEC: Auth tokens are stored exclusively in httpOnly cookies set by the
 * backend. We never store access_token or refresh_token in localStorage.
 * A lightweight `has_session` flag tells loadUser whether to attempt an
 * API call on page refresh. Legacy localStorage tokens (from older
 * versions) are cleaned up automatically.
 */

import { create } from 'zustand';
import { authService } from '../services/api';
import { markLoginComplete, clearTempAccessToken } from '../services/apiClient';
import type { CurrentUser, LoginCredentials, RegisterData } from '../types/auth';
import { toAppError, getErrorMessage } from '../utils/errorHandling';

/** Number of failed attempts before client-side lockout kicks in. */
const LOGIN_LOCKOUT_THRESHOLD = 5;

/** Base delay in ms for exponential backoff (doubles each attempt beyond threshold). */
const LOGIN_BACKOFF_BASE_MS = 2_000;

/** Maximum client-side lockout duration in ms (5 minutes). */
const LOGIN_MAX_LOCKOUT_MS = 5 * 60 * 1_000;

/** sessionStorage key for persisting lockout state across page refreshes. */
const LOCKOUT_STORAGE_KEY = 'login_lockout';

/** Max time (ms) to wait for Set-Cookie headers to be processed after login. */
const COOKIE_SETTLE_MAX_MS = 500;

/** Polling interval (ms) when waiting for login cookies to settle. */
const COOKIE_SETTLE_POLL_MS = 25;

/**
 * Read the csrf_token cookie value (the only login cookie readable by JS).
 * Returns null if the cookie is absent.
 */
function getCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match?.[1] ?? null;
}

/**
 * Wait until the browser has processed the Set-Cookie headers from the
 * login response.  The login endpoint sets three cookies — httpOnly
 * `access_token`, httpOnly `refresh_token`, and JS-readable `csrf_token`.
 * We poll for a *change* in the csrf_token value (which is regenerated
 * on every login) to confirm all three have been stored.  Under normal
 * conditions the cookies are available synchronously and this returns
 * immediately; the polling is a safety net for environments where
 * response headers travel through middleware/proxy layers that introduce
 * a brief delay.
 */
async function waitForLoginCookies(csrfBefore: string | null): Promise<void> {
  for (let elapsed = 0; elapsed < COOKIE_SETTLE_MAX_MS; elapsed += COOKIE_SETTLE_POLL_MS) {
    const csrfNow = getCsrfCookie();
    // New cookie appeared (fresh session) or value changed (re-login)
    if (csrfNow && csrfNow !== csrfBefore) return;
    await new Promise(r => setTimeout(r, COOKIE_SETTLE_POLL_MS));
  }
  // Timed out — proceed anyway; dashboard calls may still succeed
  // if the httpOnly cookies were stored independently of the csrf one.
}

/** Read lockout state from sessionStorage (survives page refresh, cleared on tab close). */
function loadLockoutState(): { loginAttempts: number; lockedUntil: number | null } {
  try {
    const raw = sessionStorage.getItem(LOCKOUT_STORAGE_KEY);
    if (!raw) return { loginAttempts: 0, lockedUntil: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { loginAttempts: 0, lockedUntil: null };
    const obj = parsed as Record<string, unknown>;
    const attempts = typeof obj.loginAttempts === 'number' ? obj.loginAttempts : 0;
    const until = typeof obj.lockedUntil === 'number' ? obj.lockedUntil : null;
    // Clear expired lockouts
    if (until !== null && Date.now() >= until) {
      sessionStorage.removeItem(LOCKOUT_STORAGE_KEY);
      return { loginAttempts: 0, lockedUntil: null };
    }
    return { loginAttempts: attempts, lockedUntil: until };
  } catch {
    return { loginAttempts: 0, lockedUntil: null };
  }
}

/** Persist lockout state to sessionStorage. */
function saveLockoutState(loginAttempts: number, lockedUntil: number | null): void {
  try {
    if (loginAttempts === 0 && lockedUntil === null) {
      sessionStorage.removeItem(LOCKOUT_STORAGE_KEY);
    } else {
      sessionStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify({ loginAttempts, lockedUntil }));
    }
  } catch {
    // sessionStorage unavailable (e.g. private browsing quota exceeded) — ignore
  }
}

interface AuthState {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Brute-force tracking (client-side defense-in-depth)
  loginAttempts: number;
  lockedUntil: number | null; // epoch ms

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
  checkPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  hasPosition: (position: string) => boolean;
}

const initialLockout = loadLockoutState();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  loginAttempts: initialLockout.loginAttempts,
  lockedUntil: initialLockout.lockedUntil,

  login: async (credentials: LoginCredentials) => {
    // Client-side lockout check (defense-in-depth; backend enforces the real limit)
    const { lockedUntil } = get();
    if (lockedUntil && Date.now() < lockedUntil) {
      const remainingSec = Math.ceil((lockedUntil - Date.now()) / 1_000);
      set({
        error: `Too many failed attempts. Please wait ${remainingSec} seconds before trying again.`,
      });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // Snapshot the csrf_token BEFORE login so we can detect when
      // the new Set-Cookie headers have been processed by the browser.
      const csrfBefore = getCsrfCookie();

      const loginResponse = await authService.login(credentials);

      // SEC: Tokens are stored in httpOnly cookies by the backend response.
      // Only persist a lightweight session flag — never the actual tokens.
      localStorage.setItem('has_session', '1');

      // Wait for auth cookies to be stored before navigating to the
      // dashboard.  Without this, the dashboard can fire API calls
      // before the browser has finished processing the Set-Cookie
      // headers from the login response, causing spurious 401s that
      // trigger a refresh cascade and kick the user back to login.
      await waitForLoginCookies(csrfBefore);

      // Tell the 401 interceptor that a login just completed and
      // provide the access_token from the response body.  The request
      // interceptor will attach it as an Authorization: Bearer header
      // until httpOnly cookies are established — this bridges the gap
      // where the browser hasn't processed Set-Cookie headers yet.
      markLoginComplete(loginResponse?.access_token, loginResponse?.refresh_token);

      // Use user data from the login response if available. This avoids
      // a separate GET /auth/me call which can fail due to a race condition
      // where the browser hasn't processed the Set-Cookie header yet.
      if (loginResponse?.user) {
        const normalizedUser: CurrentUser = {
          ...loginResponse.user,
          positions: loginResponse.user.positions ?? loginResponse.user.roles ?? [],
          rank: loginResponse.user.rank ?? null,
          membership_type: loginResponse.user.membership_type ?? 'member',
          must_change_password: loginResponse.user.must_change_password ?? false,
        };
        set({ user: normalizedUser, isAuthenticated: true });
      } else {
        await get().loadUser();
      }

      // Reset brute-force counters on successful login
      saveLockoutState(0, null);
      set({ isLoading: false, loginAttempts: 0, lockedUntil: null });
    } catch (err: unknown) {
      const appError = toAppError(err);

      // Track failed attempts for client-side progressive lockout
      const attempts = get().loginAttempts + 1;
      let newLockedUntil: number | null = null;

      if (attempts >= LOGIN_LOCKOUT_THRESHOLD) {
        const backoffMs = Math.min(
          LOGIN_BACKOFF_BASE_MS * Math.pow(2, attempts - LOGIN_LOCKOUT_THRESHOLD),
          LOGIN_MAX_LOCKOUT_MS,
        );
        newLockedUntil = Date.now() + backoffMs;
      }

      // If the backend returned a Retry-After header (429), honour it
      const rawRetryAfter = appError.status === 429
        ? appError.details?.retryAfter
        : undefined;
      const retryAfter = typeof rawRetryAfter === 'number'
        ? rawRetryAfter
        : parseInt(typeof rawRetryAfter === 'string' ? rawRetryAfter : '0', 10);
      if (retryAfter > 0) {
        newLockedUntil = Date.now() + retryAfter * 1_000;
      }

      saveLockoutState(attempts, newLockedUntil);
      set({
        isLoading: false,
        loginAttempts: attempts,
        lockedUntil: newLockedUntil,
        error: getErrorMessage(err, 'Login failed. Please try again.'),
      });
      throw Object.assign(new Error(appError.message), appError);
    }
  },

  register: async (data: RegisterData) => {
    set({ isLoading: true, error: null });

    try {
      await authService.register(data);

      // SEC: Tokens are stored in httpOnly cookies by the backend response.
      localStorage.setItem('has_session', '1');

      await get().loadUser();

      set({ isLoading: false });
    } catch (err: unknown) {
      const appError = toAppError(err);
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Registration failed. Please try again.'),
      });
      throw Object.assign(new Error(appError.message), appError);
    }
  },

  logout: async () => {
    try {
      await authService.logout();
    } catch {
      // Logout errors are non-critical; cookies are cleared by the backend
    } finally {
      // SEC: Clear session flag, temporary in-memory token, and any
      // legacy token remnants from localStorage
      clearTempAccessToken();
      localStorage.removeItem('has_session');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      set({
        user: null,
        isAuthenticated: false,
        error: null,
      });
    }
  },

  loadUser: async () => {
    // SEC: We no longer store tokens in localStorage. The httpOnly cookie
    // is the sole auth credential. Check for a lightweight session flag
    // to decide whether to attempt an API call on page load.
    const hasSession = localStorage.getItem('has_session');

    // Clean up legacy tokens from older versions that stored them in localStorage
    const legacyToken = localStorage.getItem('access_token');
    if (legacyToken) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      // Legacy tokens imply there may be an active httpOnly cookie session
      localStorage.setItem('has_session', '1');
    }

    if (!hasSession && !legacyToken) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    set({ isLoading: true });

    try {
      const user = await authService.getCurrentUser();
      // Ensure new taxonomy fields have safe defaults for backward compatibility
      const normalizedUser: CurrentUser = {
        ...user,
        positions: user.positions ?? user.roles ?? [],
        rank: user.rank ?? null,
        membership_type: user.membership_type ?? 'member',
        must_change_password: user.must_change_password ?? false,
      };
      set({
        user: normalizedUser,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err: unknown) {
      // Clear session state regardless of error type
      localStorage.removeItem('has_session');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });

      // 401/403 are expected when the session has expired or user is not
      // authenticated — silently handle them. Any other error is unexpected
      // and should be logged so it surfaces in dev tools.
      const appError = toAppError(err);
      if (appError.status !== 401 && appError.status !== 403) {
        console.error('loadUser failed with unexpected error:', appError.message);
      }
    }
  },

  clearError: () => {
    set({ error: null });
  },

  checkPermission: (permission: string) => {
    const { user } = get();
    if (!user?.permissions) return false;
    // Global wildcard "*" grants all permissions (it_manager / System Owner position)
    if (user.permissions.includes('*')) return true;
    // Exact match
    if (user.permissions.includes(permission)) return true;
    // Module wildcard: "settings.*" matches "settings.manage", etc.
    if (permission.includes('.')) {
      const module = permission.split('.')[0] ?? '';
      if (user.permissions.includes(`${module}.*`)) return true;
    }
    return false;
  },

  hasRole: (role: string) => {
    const { user } = get();
    return user?.roles?.includes(role) || user?.positions?.includes(role) || false;
  },

  hasPosition: (position: string) => {
    const { user } = get();
    return user?.positions?.includes(position) || false;
  },
}));
