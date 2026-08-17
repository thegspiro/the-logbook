import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('onboarding API client session cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = 'onboarding_csrf_token=; path=/; max-age=0';
    vi.unstubAllGlobals();
  });

  it('keeps the authenticated-session hint while clearing onboarding data on completion', async () => {
    sessionStorage.setItem('onboarding_session_id', 'session-1');
    localStorage.setItem('onboarding-storage', '{"state":{"departmentName":"Example"}}');
    localStorage.setItem('has_session', '1');
    document.cookie = 'onboarding_csrf_token=csrf-1; path=/';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'complete' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { apiClient } = await import('./api-client');
    const response = await apiClient.completeOnboarding();

    expect(response.statusCode).toBe(200);
    expect(localStorage.getItem('has_session')).toBe('1');
    expect(sessionStorage.getItem('onboarding_session_id')).toBeNull();
    expect(localStorage.getItem('onboarding-storage')).toBeNull();
  });

  it('clears the authenticated-session hint for destructive or stale-session cleanup', async () => {
    localStorage.setItem('has_session', '1');

    const { apiClient } = await import('./api-client');
    apiClient.clearSession();

    expect(localStorage.getItem('has_session')).toBeNull();
  });

  it('migrates a legacy localStorage session id into this tab instead of discarding it', async () => {
    // A client from before tab-scoping only has the id in localStorage. It is
    // the only copy — /onboarding/start refuses once an organization exists —
    // so it must be adopted, not deleted.
    localStorage.setItem('onboarding_session_id', 'legacy-persistent-session');

    const { apiClient } = await import('./api-client');

    expect(apiClient.hasSession()).toBe(true);
    expect(apiClient.getSessionId()).toBe('legacy-persistent-session');
    expect(sessionStorage.getItem('onboarding_session_id')).toBe('legacy-persistent-session');
    expect(localStorage.getItem('onboarding_session_id')).toBeNull();
  });

  it('prefers the tab-scoped session id over a legacy localStorage id and removes the legacy copy', async () => {
    sessionStorage.setItem('onboarding_session_id', 'tab-session');
    localStorage.setItem('onboarding_session_id', 'legacy-persistent-session');

    const { apiClient } = await import('./api-client');

    expect(apiClient.getSessionId()).toBe('tab-session');
    expect(sessionStorage.getItem('onboarding_session_id')).toBe('tab-session');
    expect(localStorage.getItem('onboarding_session_id')).toBeNull();
  });

  it('stores the CSRF token tab-scoped on session start without writing a shared cookie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ session_id: 'session-1', expires_at: '2099-01-01T00:00:00Z', csrf_token: 'csrf-new' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./api-client');
    await apiClient.startSession();

    expect(sessionStorage.getItem('onboarding_session_id')).toBe('session-1');
    expect(sessionStorage.getItem('onboarding_csrf_token')).toBe('csrf-new');
    expect(document.cookie).not.toContain('onboarding_csrf_token');
  });

  it('sends the tab-scoped CSRF token as a header on mutations', async () => {
    sessionStorage.setItem('onboarding_session_id', 'session-1');
    sessionStorage.setItem('onboarding_csrf_token', 'csrf-tab');
    // A concurrent tab's legacy cookie must not override this tab's token.
    document.cookie = 'onboarding_csrf_token=csrf-other-tab; path=/';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./api-client');
    await apiClient.saveAuthPlatform('local');

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as
      Record<string, string> | undefined;
    expect(headers?.['X-CSRF-Token']).toBe('csrf-tab');
    expect(headers?.['X-Session-ID']).toBe('session-1');
  });

  it('adopts a legacy cookie CSRF token into sessionStorage and retires the cookie', async () => {
    // Pre-deploy state: session id (possibly just migrated from localStorage)
    // with the CSRF token still in the origin-wide cookie.
    localStorage.setItem('onboarding_session_id', 'legacy-persistent-session');
    document.cookie = 'onboarding_csrf_token=csrf-legacy; path=/';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { apiClient } = await import('./api-client');

    expect(sessionStorage.getItem('onboarding_csrf_token')).toBe('csrf-legacy');
    expect(document.cookie).not.toContain('onboarding_csrf_token');

    await apiClient.saveAuthPlatform('local');
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as
      Record<string, string> | undefined;
    expect(headers?.['X-CSRF-Token']).toBe('csrf-legacy');
  });

  it('does not adopt a legacy cookie CSRF token when this tab has no session', async () => {
    document.cookie = 'onboarding_csrf_token=csrf-legacy; path=/';

    const { apiClient } = await import('./api-client');

    expect(apiClient.hasSession()).toBe(false);
    expect(sessionStorage.getItem('onboarding_csrf_token')).toBeNull();
  });

  it('stores a rotated CSRF token from a response header tab-scoped', async () => {
    sessionStorage.setItem('onboarding_session_id', 'session-1');
    sessionStorage.setItem('onboarding_csrf_token', 'csrf-old');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-rotated' },
        })
      )
    );

    const { apiClient } = await import('./api-client');
    await apiClient.getStatus();

    expect(sessionStorage.getItem('onboarding_csrf_token')).toBe('csrf-rotated');
    expect(document.cookie).not.toContain('onboarding_csrf_token');
  });

  it('clears the tab-scoped CSRF token and session id on clearSession', async () => {
    sessionStorage.setItem('onboarding_session_id', 'session-1');
    sessionStorage.setItem('onboarding_csrf_token', 'csrf-1');

    const { apiClient } = await import('./api-client');
    apiClient.clearSession();

    expect(sessionStorage.getItem('onboarding_session_id')).toBeNull();
    expect(sessionStorage.getItem('onboarding_csrf_token')).toBeNull();
  });
});
