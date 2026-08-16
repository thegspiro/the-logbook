import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Transport-level behaviour of the onboarding API client: header construction,
 * CSRF handling, stale-session recovery and HTTP error mapping.
 *
 * The client is a module singleton that reads storage in its constructor, so
 * every test re-imports it after seeding storage rather than sharing one
 * instance. Session cleanup on completion is covered separately in
 * api-client.test.ts.
 */

type FetchArgs = [string, RequestInit];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

async function freshClient() {
  vi.resetModules();
  const { apiClient } = await import('./api-client');
  return apiClient;
}

function headersOf(call: FetchArgs): Record<string, string> {
  return (call[1].headers ?? {}) as Record<string, string>;
}

/** Parse the JSON body the client serialised, failing loudly if it sent none. */
function bodyOf(call: FetchArgs): Record<string, unknown> {
  const raw = call[1].body;
  if (typeof raw !== 'string') {
    throw new Error(`expected a serialised JSON body, got ${typeof raw}`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('onboarding API client transport', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = 'onboarding_csrf_token=; path=/; max-age=0';
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('request construction', () => {
    it('sends cookies so the server can bind the onboarding session', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).getStatus();

      expect((fetchMock.mock.calls[0] as FetchArgs)[1].credentials).toBe('include');
    });

    it('sends the session id as a header once a session exists', async () => {
      sessionStorage.setItem('onboarding_session_id', 'session-42');
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).getStatus();

      expect(headersOf(fetchMock.mock.calls[0] as FetchArgs)['X-Session-ID']).toBe('session-42');
    });

    it('omits the session header when there is no session', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).getStatus();

      expect(headersOf(fetchMock.mock.calls[0] as FetchArgs)['X-Session-ID']).toBeUndefined();
    });

    // The CSRF header is attached only to the calls that declare they need it,
    // which is the double-submit half the server checks on mutations.
    it('attaches the CSRF header on a mutation, reading it from the cookie', async () => {
      document.cookie = 'onboarding_csrf_token=csrf-abc; path=/';
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).saveAuthPlatform('google');

      expect(headersOf(fetchMock.mock.calls[0] as FetchArgs)['X-CSRF-Token']).toBe('csrf-abc');
    });

    it('does not attach the CSRF header on a plain read', async () => {
      document.cookie = 'onboarding_csrf_token=csrf-abc; path=/';
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).getStatus();

      expect(headersOf(fetchMock.mock.calls[0] as FetchArgs)['X-CSRF-Token']).toBeUndefined();
    });

    it('stores a rotated CSRF token in a cookie, never in localStorage', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ ok: true }, { headers: { 'X-CSRF-Token': 'rotated-token' } }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).getStatus();

      expect(document.cookie).toContain('onboarding_csrf_token=rotated-token');
      expect(localStorage.getItem('csrf_token')).toBeNull();
      expect(localStorage.getItem('onboarding_csrf_token')).toBeNull();
    });

    it('sends no body on a GET', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).getStatus();

      expect((fetchMock.mock.calls[0] as FetchArgs)[1].body).toBeUndefined();
    });
  });

  // An onboarding session id authorizes setup mutations, so it must not outlive
  // the tab or leak to unrelated ones. Older clients kept it in localStorage.
  describe('session storage hygiene', () => {
    it('evicts a session id left behind in localStorage by an older client', async () => {
      localStorage.setItem('onboarding_session_id', 'legacy-session');

      await freshClient();

      expect(localStorage.getItem('onboarding_session_id')).toBeNull();
    });

    it('reads the session id from sessionStorage, so it is scoped to the tab', async () => {
      sessionStorage.setItem('onboarding_session_id', 'tab-session');
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).getStatus();

      expect(headersOf(fetchMock.mock.calls[0] as FetchArgs)['X-Session-ID']).toBe('tab-session');
    });
  });

  // A wiped server-side session (typically a database reset) leaves the browser
  // holding an id the server no longer knows. The client recovers once rather
  // than stranding the operator mid-setup.
  describe('stale-session recovery on 401', () => {
    it('starts a fresh session and replays the request', async () => {
      sessionStorage.setItem('onboarding_session_id', 'stale-session');
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ detail: 'no session' }, { status: 401 }))
        .mockResolvedValueOnce(jsonResponse({ session_id: 'new-session', csrf_token: 'new-csrf' }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await (await freshClient()).getStatus();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[1] as FetchArgs)[0]).toContain('/onboarding/start');
      expect(result.data).toEqual({ ok: true });
    });

    it('retries only once, so a persistent 401 cannot loop', async () => {
      sessionStorage.setItem('onboarding_session_id', 'stale-session');
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/onboarding/start')) {
          return Promise.resolve(jsonResponse({ session_id: 'new-session' }));
        }
        return Promise.resolve(jsonResponse({ detail: 'still no' }, { status: 401 }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await (await freshClient()).getStatus();

      // original + session start + one replay, then it gives up
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.statusCode).toBe(401);
    });

    it('does not attempt recovery when there was no session to begin with', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'nope' }, { status: 401 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await (await freshClient()).getStatus();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.statusCode).toBe(401);
    });

    it('gives up cleanly when the replacement session cannot be created', async () => {
      sessionStorage.setItem('onboarding_session_id', 'stale-session');
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ detail: 'no session' }, { status: 401 }))
        .mockResolvedValueOnce(jsonResponse({ detail: 'down' }, { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await (await freshClient()).getStatus();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.error).toBeDefined();
    });
  });

  describe('HTTP error mapping', () => {
    it.each([
      [429, /too many requests/i],
      [403, /security validation failed/i],
      [500, /server error occurred/i],
      [503, /temporarily unavailable/i],
    ])('turns %i into a message an operator can act on', async (status, expected) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status })));

      const result = await (await freshClient()).getStatus();

      expect(result.error).toMatch(expected);
      expect(result.statusCode).toBe(status);
    });

    // FastAPI returns 422 detail as an ARRAY of per-field objects, not a string.
    // Rendering it directly would show "[object Object]" to the operator.
    it('expands a 422 validation array into per-field text', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(jsonResponse({ detail: [{ field: 'name', message: 'is required' }] }, { status: 422 }))
      );

      const result = await (await freshClient()).getStatus();

      expect(result.error).toBe('Name: is required');
      expect(result.error).not.toContain('[object Object]');
    });

    it('uses a plain 422 detail string as-is', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ detail: 'Port must be numeric' }, { status: 422 }))
      );

      expect((await (await freshClient()).getStatus()).error).toBe('Port must be numeric');
    });

    it('surfaces the server detail on a 409 conflict', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ detail: 'Organization exists' }, { status: 409 }))
      );

      expect((await (await freshClient()).getStatus()).error).toBe('Organization exists');
    });

    it('falls back to a generic message for an unmapped status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 418 })));

      const result = await (await freshClient()).getStatus();

      expect(result.error).toMatch(/unexpected error/i);
      expect(result.statusCode).toBe(418);
    });

    it('survives an error response whose body is not JSON', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 500 })));

      expect((await (await freshClient()).getStatus()).error).toMatch(/server error occurred/i);
    });
  });

  describe('network failures', () => {
    it('names the backend as unreachable when fetch cannot connect', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const result = await (await freshClient()).getStatus();

      expect(result.error).toMatch(/unable to reach the server/i);
      expect(result.statusCode).toBe(0);
    });

    it('reports a cancelled request as cancelled, not as a failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));

      expect((await (await freshClient()).getStatus()).error).toMatch(/cancelled/i);
    });

    it('falls back to a generic message for any other transport error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('something else')));

      expect((await (await freshClient()).getStatus()).error).toMatch(/network error/i);
    });
  });

  describe('createOrganization defaults', () => {
    it('defaults the type and timezone when the caller omits them', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }));
      vi.stubGlobal('fetch', fetchMock);

      await (await freshClient()).createOrganization({ name: 'FCVFD' });

      const body = bodyOf(fetchMock.mock.calls[0] as FetchArgs);
      expect(body.organization_type).toBe('fire_department');
      expect(body.timezone).toBe('America/New_York');
    });

    it('keeps the caller values when they are supplied', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }));
      vi.stubGlobal('fetch', fetchMock);

      await (
        await freshClient()
      ).createOrganization({
        name: 'FCVFD',
        organization_type: 'ems_only',
        timezone: 'America/Chicago',
      });

      const body = bodyOf(fetchMock.mock.calls[0] as FetchArgs);
      expect(body.organization_type).toBe('ems_only');
      expect(body.timezone).toBe('America/Chicago');
    });

    // An empty string is what a cleared form field sends. `||` coerces it to the
    // default; `??` would forward '' and the server would reject it. This is
    // CLAUDE.md pitfall #1, pinned at the boundary that actually serialises.
    it('treats an empty string as absent rather than forwarding it', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }));
      vi.stubGlobal('fetch', fetchMock);

      await (
        await freshClient()
      ).createOrganization({
        name: 'FCVFD',
        organization_type: '',
        timezone: '',
      });

      const body = bodyOf(fetchMock.mock.calls[0] as FetchArgs);
      expect(body.organization_type).toBe('fire_department');
      expect(body.timezone).toBe('America/New_York');
    });
  });
});
