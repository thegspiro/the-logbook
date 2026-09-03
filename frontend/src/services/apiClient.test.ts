import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

const mockAxiosPost = vi.fn();
const mockPurgeLocalMemberData = vi.fn();
const mockReportApiError = vi.fn();

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      // `create()` stays real — apiClient.ts's own interceptors must run
      // against a genuine axios instance. Only the standalone `axios.post`
      // call performSharedRefresh makes to /auth/refresh is replaced, so a
      // 401 test never hits the network.
      post: (...args: unknown[]) => mockAxiosPost(...args) as unknown,
    },
  };
});

vi.mock('../utils/purgeLocalMemberData', () => ({
  purgeLocalMemberData: () => mockPurgeLocalMemberData() as unknown,
}));

vi.mock('./errorReporting', () => ({
  reportApiError: (err: unknown) => mockReportApiError(err) as unknown,
  clearQueuedReports: () => undefined,
}));

// Import AFTER the mocks are in place.
import api from './apiClient';
import { clearCache } from '../utils/apiCache';

/**
 * Drives the real interceptor chain (as createApiClient.test.ts does for the
 * module factory) rather than mocking axios wholesale — stubbing the adapter
 * leaves the request/response interceptors genuine.
 */
function withAdapter(adapter: AxiosAdapter): void {
  api.defaults.adapter = adapter;
}

/** An adapter that fails the first n calls with `status`, then succeeds. */
function failThenOkAdapter(status: number, failures: number, seen: InternalAxiosRequestConfig[]): AxiosAdapter {
  let calls = 0;
  return (config) => {
    seen.push(config);
    calls += 1;
    if (calls <= failures) {
      return Promise.reject(
        Object.assign(new Error(`Request failed with status code ${status}`), {
          isAxiosError: true,
          config,
          response: { status, data: {}, statusText: '', headers: {}, config },
        })
      );
    }
    return Promise.resolve({
      data: { retried: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
  };
}

describe('apiClient — 401 handling on auth-flow endpoints', () => {
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosPost.mockResolvedValue(undefined);
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    localStorage.clear();
    // apiClient.ts's cache is a module-level singleton, so a prior test's
    // cached GET would otherwise serve a synthetic response here and skip
    // the adapter (and the 401 flow) entirely.
    clearCache();

    // Assigning window.location.href throws "Not implemented: navigation" in
    // jsdom, so stand in a plain object we can assert against (matches
    // createApiClient.test.ts's approach for the same reason).
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  // Regression guard: /auth/mfa/login intentionally returns 401 for a wrong
  // or expired TOTP/recovery code (backend: CodedHTTPException,
  // AUTH_MFA_CHALLENGE_EXPIRED). Before isAuthEndpoint included this path, the
  // interceptor mistook that for an expired session, attempted a refresh (no
  // session exists yet mid-MFA-challenge, so it always failed), and handed
  // off to handleExpiredSession — purging local member data and hard
  // redirecting to /login instead of showing "invalid code" on the MFA form.
  it('does not attempt a refresh on a 401 from /auth/mfa/login', async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    withAdapter(failThenOkAdapter(401, 99, seen));

    await api.post('/auth/mfa/login', { temp_token: 't', code: '000000' }).catch(() => undefined);

    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockPurgeLocalMemberData).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
    // Exactly one attempt — no retry loop against the failing endpoint.
    expect(seen).toHaveLength(1);
  });

  it('still attempts a refresh on a 401 from a genuine protected endpoint', async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    withAdapter(failThenOkAdapter(401, 1, seen));

    const response = await api.get('/inventory');

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      undefined,
      expect.objectContaining({ withCredentials: true })
    );
    expect(response.data).toEqual({ retried: true });
    expect(seen).toHaveLength(2);
  });

  it('purges local data and redirects when a protected-endpoint refresh fails', async () => {
    mockAxiosPost.mockRejectedValue(
      Object.assign(new Error('refresh failed'), {
        isAxiosError: true,
        config: { url: '/auth/refresh' },
        response: { status: 401 },
      })
    );
    withAdapter(failThenOkAdapter(401, 99, []));

    await api.get('/inventory').catch(() => undefined);

    expect(mockPurgeLocalMemberData).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login');
  });
});

/**
 * The stale-while-revalidate path hands the caller a cached body and starts a
 * background request to refresh the entry. That background request outlives
 * the call that triggered it, so it must not inherit the caller's
 * cancellation — see the abort assertions below.
 */
describe('apiClient — background revalidation of a stale entry', () => {
  let originalAdapter: typeof api.defaults.adapter;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
    originalAdapter = api.defaults.adapter;
    // Only Date: the interceptor chain runs on microtasks, and faking those
    // timers would stall the promises this test awaits.
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    api.defaults.adapter = originalAdapter;
    clearCache();
  });

  it('does not cancel the refresh when the caller aborts', async () => {
    const seenSignals: (AbortSignal | undefined)[] = [];
    let releaseBackground: (() => void) | undefined;
    let calls = 0;

    withAdapter((config) => {
      calls += 1;
      seenSignals.push(config.signal as AbortSignal | undefined);
      const ok = (data: unknown) => ({
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
      if (calls === 1) return Promise.resolve(ok({ generation: 1 }));
      // Hold the revalidation open past the caller's abort, so this test
      // measures the abort rather than racing it.
      return new Promise((resolve, reject) => {
        releaseBackground = () => resolve(ok({ generation: 2 }));
        config.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    const primer = new AbortController();
    await api.get('/inventory/items', { signal: primer.signal });
    expect(calls).toBe(1);

    // Into the stale window (30s-90s): served from cache, refreshed behind it.
    vi.setSystemTime(Date.now() + 45_000);

    const caller = new AbortController();
    const cached = await api.get('/inventory/items', { signal: caller.signal });
    expect(cached.data).toEqual({ generation: 1 });
    expect(calls).toBe(2);

    // What a page does on the next filter change or on unmount.
    caller.abort();
    releaseBackground?.();
    // Real timers (only Date is faked), so this yields to the revalidation's
    // .then(setCache) rather than merely to the microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The background request was issued without the caller's signal, so the
    // abort above could not reach it.
    expect(seenSignals[1]).toBeUndefined();

    // And the refreshed body actually landed in the cache: this third call is
    // inside the fresh window of the revalidated entry, so it is served from
    // cache without touching the adapter.
    const refreshed = await api.get('/inventory/items');
    expect(refreshed.data).toEqual({ generation: 2 });
    expect(calls).toBe(2);
  });

  it('does not repopulate the cache with a response issued before logout cleared it', async () => {
    // SEC: cache keys carry no user identity, so clearCache() on logout is the
    // only thing between one member's responses and the next member to sign in
    // on the same tab. Dropping the caller's abort from the revalidation above
    // removed the one thing that used to stop it outliving that logout, so the
    // write is gated on the cache era instead.
    let releaseBackground: (() => void) | undefined;
    let calls = 0;

    withAdapter((config) => {
      calls += 1;
      const ok = (data: unknown) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
      if (calls === 1) return Promise.resolve(ok({ member: 'first' }));
      return new Promise((resolve) => {
        releaseBackground = () => resolve(ok({ member: 'first-late' }));
      });
    });

    await api.get('/inventory/items');
    vi.setSystemTime(Date.now() + 45_000);
    await api.get('/inventory/items');
    expect(calls).toBe(2);

    // The first member signs out while that revalidation is still open.
    clearCache();
    releaseBackground?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The next member's request must reach the network, not be answered from a
    // cache the previous session's response quietly refilled.
    withAdapter((config) => {
      calls += 1;
      return Promise.resolve({
        data: { member: 'second' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });
    });

    const next = await api.get('/inventory/items');
    expect(next.data).toEqual({ member: 'second' });
    expect(calls).toBe(3);
  });
});
