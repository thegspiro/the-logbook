import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchServerBuildId, formatBuildId, getCurrentBuildId, getCurrentBuildTime } from './appVersion';

declare global {
  var __BUILD_ID__: string | undefined;
  var __BUILD_TIME__: string | undefined;
}

function mockVersionResponse(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      json: () => Promise.resolve(body),
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, '__BUILD_ID__');
  Reflect.deleteProperty(globalThis, '__BUILD_TIME__');
});

describe('getCurrentBuildId', () => {
  it('returns the build stamped into the bundle', () => {
    globalThis.__BUILD_ID__ = 'abc123def456789';
    expect(getCurrentBuildId()).toBe('abc123def456789');
  });

  it('returns undefined in dev, where the define is absent', () => {
    expect(getCurrentBuildId()).toBeUndefined();
  });
});

describe('fetchServerBuildId', () => {
  it('bypasses every cache layer so a stale copy cannot mask a deployment', async () => {
    mockVersionResponse({ buildId: 'server-build' });

    await fetchServerBuildId();

    expect(fetch).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
  });

  it('returns the served build id', async () => {
    mockVersionResponse({ buildId: 'server-build' });
    await expect(fetchServerBuildId()).resolves.toBe('server-build');
  });

  it('returns null on a non-2xx response', async () => {
    mockVersionResponse({ buildId: 'server-build' }, false);
    await expect(fetchServerBuildId()).resolves.toBeNull();
  });

  it('returns null when the body has no usable buildId', async () => {
    mockVersionResponse({ buildId: 42 });
    await expect(fetchServerBuildId()).resolves.toBeNull();
  });

  it('returns null when offline rather than throwing at the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchServerBuildId()).resolves.toBeNull();
  });
});

describe('getCurrentBuildTime', () => {
  it('returns the UTC timestamp stamped into the bundle', () => {
    globalThis.__BUILD_TIME__ = '2026-08-25T19:14:00.000Z';
    expect(getCurrentBuildTime()).toBe('2026-08-25T19:14:00.000Z');
  });

  // The App settings panel leaves the release date out rather than printing a
  // stand-in date that would read as fact.
  it('returns undefined in dev, where the define is absent', () => {
    expect(getCurrentBuildTime()).toBeUndefined();
  });
});

describe('formatBuildId', () => {
  it('truncates a long build id to something quotable', () => {
    expect(formatBuildId('0123456789abcdefghij')).toBe('0123456789ab');
  });

  it('leaves a short build id alone', () => {
    expect(formatBuildId('abc123')).toBe('abc123');
  });

  it('labels a bundle with no build id as development', () => {
    expect(formatBuildId(undefined)).toBe('development');
  });
});
