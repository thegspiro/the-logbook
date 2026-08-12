import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('onboarding API client session cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.cookie = 'onboarding_csrf_token=; path=/; max-age=0';
    vi.unstubAllGlobals();
  });

  it('keeps the authenticated-session hint while clearing onboarding data on completion', async () => {
    localStorage.setItem('onboarding_session_id', 'session-1');
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
    expect(localStorage.getItem('onboarding_session_id')).toBeNull();
    expect(localStorage.getItem('onboarding-storage')).toBeNull();
  });

  it('clears the authenticated-session hint for destructive or stale-session cleanup', async () => {
    localStorage.setItem('has_session', '1');

    const { apiClient } = await import('./api-client');
    apiClient.clearSession();

    expect(localStorage.getItem('has_session')).toBeNull();
  });
});
