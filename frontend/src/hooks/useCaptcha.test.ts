/**
 * Tests for useCaptcha.
 *
 * The behaviours worth pinning: a deployment with CAPTCHA off must not load a
 * provider script or block submission, and a config-endpoint failure must not
 * make anonymous forms unsubmittable (the server still enforces the challenge
 * independently, so failing open here cannot bypass a live challenge).
 *
 * The hook memoizes the config fetch at module scope so that several forms on a
 * page share one request, which means each test needs a freshly imported copy
 * rather than a shared one carrying the previous test's config.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) as unknown },
}));

type HookModule = typeof import('./useCaptcha');

async function freshHook(): Promise<HookModule> {
  vi.resetModules();
  return import('./useCaptcha');
}

function scriptTags(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script'));
}

/** Mount the hook with a stub widget API and drive the script load. */
async function mountWithWidget(overrides: { reset?: ReturnType<typeof vi.fn> } = {}) {
  mockGet.mockResolvedValue({ data: { enabled: true, provider: 'turnstile', siteKey: 'site-key' } });

  let capture: ((token: string) => void) | undefined;
  const reset = overrides.reset ?? vi.fn();
  const render = vi.fn().mockImplementation((_el: HTMLElement, opts: Record<string, unknown>) => {
    capture = opts.callback as (token: string) => void;
    return 'widget-1';
  });
  (window as unknown as { turnstile: unknown }).turnstile = { render, reset };

  const { useCaptcha } = await freshHook();
  const { result } = renderHook(() => useCaptcha());

  await waitFor(() => {
    expect(result.current.required).toBe(true);
  });

  // renderHook mounts no DOM, so stand in for the <div ref={containerRef} />
  // the pages render. The widget needs a real element to render into.
  result.current.containerRef.current = document.createElement('div');

  // jsdom does not fetch the script, so drive the load callback directly.
  const script = scriptTags().find((el) => el.src.includes('challenges.cloudflare.com'));
  act(() => {
    script?.onload?.(new Event('load'));
  });
  await waitFor(() => {
    expect(render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object));
  });

  return { result, render, reset, capture: () => capture };
}

describe('useCaptcha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scriptTags().forEach((el) => el.remove());
  });

  afterEach(() => {
    scriptTags().forEach((el) => el.remove());
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  it('exposes the header name the backend reads', async () => {
    const { CAPTCHA_HEADER } = await freshHook();
    expect(CAPTCHA_HEADER).toBe('X-Captcha-Token');
  });

  it('reports not-required and loads no script when disabled', async () => {
    mockGet.mockResolvedValue({ data: { enabled: false, provider: null, siteKey: null } });

    const { useCaptcha } = await freshHook();
    const { result } = renderHook(() => useCaptcha());

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/v1/auth/captcha-config');
    });
    expect(result.current.required).toBe(false);
    expect(scriptTags()).toHaveLength(0);
    await expect(result.current.getToken()).resolves.toBeNull();
  });

  it('fails open when the config endpoint is unreachable', async () => {
    mockGet.mockRejectedValue(new Error('network down'));

    const { useCaptcha } = await freshHook();
    const { result } = renderHook(() => useCaptcha());

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/v1/auth/captcha-config');
    });
    // A form that cannot be submitted at all is worse than one whose challenge
    // is enforced server-side, which it still is.
    expect(result.current.required).toBe(false);
    await expect(result.current.getToken()).resolves.toBeNull();
  });

  it('loads the provider script and renders a widget when enabled', async () => {
    const { render } = await mountWithWidget();

    expect(scriptTags().some((el) => el.src.includes('challenges.cloudflare.com'))).toBe(true);
    const opts = render.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts.sitekey).toBe('site-key');
  });

  it('returns the token captured by the widget callback', async () => {
    const { result, capture } = await mountWithWidget();

    await expect(result.current.getToken()).resolves.toBeNull();
    act(() => {
      capture()?.('solved-token');
    });
    await expect(result.current.getToken()).resolves.toBe('solved-token');
  });

  it('discards the token on reset so a retry solves a fresh challenge', async () => {
    const reset = vi.fn();
    const { result, capture } = await mountWithWidget({ reset });

    act(() => {
      capture()?.('solved-token');
    });
    act(() => {
      result.current.reset();
    });

    await expect(result.current.getToken()).resolves.toBeNull();
    expect(reset).toHaveBeenCalledWith('widget-1');
  });
});
