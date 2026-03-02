import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentType } from 'react';

// We need to mock React.lazy so we can inspect the factory function
// passed to it, without actually invoking React's lazy machinery.
const mockLazy = vi.fn();
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    lazy: (...args: unknown[]) => mockLazy(...args) as unknown,
  };
});

import { lazyWithRetry, clearChunkReloadFlag } from './lazyWithRetry';

// Helper: create a chunk-load error (matches isChunkLoadError patterns)
function chunkError(msg = 'Failed to fetch dynamically imported module /assets/Page-abc123.js'): Error {
  return new Error(msg);
}

// Helper: extract the factory function that lazyWithRetry passes to React.lazy
function captureFactory<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
): () => Promise<{ default: T }> {
  lazyWithRetry(importFn);
  // mockLazy is called with the factory as first argument
  const lastCall = mockLazy.mock.calls[mockLazy.mock.calls.length - 1];
  if (!lastCall) throw new Error('Expected mockLazy to have been called');
  const factory = lastCall[0] as () => Promise<{ default: T }>;
  return factory;
}

describe('lazyWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Reset location to a known state
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/dashboard',
        search: '',
        reload: vi.fn(),
      },
    });
  });

  it('calls React.lazy with a factory function', () => {
    const importFn = vi.fn().mockResolvedValue({ default: (() => null) as unknown as ComponentType<unknown> });
    lazyWithRetry(importFn);
    expect(mockLazy).toHaveBeenCalledOnce();
    const firstCall = mockLazy.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(typeof firstCall?.[0]).toBe('function');
  });

  it('resolves successfully on the first import attempt', async () => {
    const FakeComponent = (() => null) as unknown as ComponentType<unknown>;
    const importFn = vi.fn().mockResolvedValue({ default: FakeComponent });

    const factory = captureFactory(importFn);
    const result = await factory();

    expect(result.default).toBe(FakeComponent);
    expect(importFn).toHaveBeenCalledOnce();
  });

  it('retries once on transient failure and resolves on second attempt', async () => {
    const FakeComponent = (() => null) as unknown as ComponentType<unknown>;
    const importFn = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ default: FakeComponent });

    const factory = captureFactory(importFn);
    const result = await factory();

    expect(result.default).toBe(FakeComponent);
    expect(importFn).toHaveBeenCalledTimes(2);
  });

  it('reloads page on chunk-load error when not previously reloaded for this page', async () => {
    const importFn = vi.fn().mockRejectedValue(chunkError());

    const factory = captureFactory(importFn);

    // The factory returns a never-resolving promise during reload, so we
    // race it against a timeout to confirm it does not resolve or reject.
    const result = factory();
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('timed_out'), 50));
    const winner = await Promise.race([result.then(() => 'resolved').catch(() => 'rejected'), timeout]);

    expect(winner).toBe('timed_out');
    expect(window.location.reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('chunk_reload')).toBe('/dashboard');
  });

  it('throws error instead of reloading if page was already reloaded', async () => {
    // Simulate that a reload was already attempted for this page
    sessionStorage.setItem('chunk_reload', '/dashboard');

    const importFn = vi.fn().mockRejectedValue(chunkError());

    const factory = captureFactory(importFn);
    await expect(factory()).rejects.toThrow('Failed to fetch dynamically imported module');

    // reload should NOT be called again
    expect(window.location.reload).not.toHaveBeenCalled();
    // The flag should be cleared so a future error on the same page can trigger a reload
    expect(sessionStorage.getItem('chunk_reload')).toBeNull();
  });

  it('reloads when the stored page differs from current page', async () => {
    // A different page was previously reloaded
    sessionStorage.setItem('chunk_reload', '/settings');

    const importFn = vi.fn().mockRejectedValue(chunkError());

    const factory = captureFactory(importFn);
    // Should trigger reload since current page (/dashboard) differs from stored (/settings)
    const result = factory();
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('timed_out'), 50));
    const winner = await Promise.race([result.then(() => 'resolved').catch(() => 'rejected'), timeout]);

    expect(winner).toBe('timed_out');
    expect(window.location.reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('chunk_reload')).toBe('/dashboard');
  });

  it('includes search params in the page key for reload tracking', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/events',
        search: '?filter=upcoming',
        reload: vi.fn(),
      },
    });

    const importFn = vi.fn().mockRejectedValue(chunkError());

    const factory = captureFactory(importFn);
    void factory();

    // Wait a tick for the async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sessionStorage.getItem('chunk_reload')).toBe('/events?filter=upcoming');
  });

  it('throws the retry error for non-chunk-load errors after both attempts fail', async () => {
    const originalError = new Error('Syntax error');
    const retryError = new Error('Syntax error again');
    const importFn = vi.fn()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(retryError);

    const factory = captureFactory(importFn);
    await expect(factory()).rejects.toThrow('Syntax error again');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('throws original error if retry error is falsy', async () => {
    const originalError = new Error('Original failure');
    const importFn = vi.fn()
      .mockRejectedValueOnce(originalError)
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      .mockRejectedValueOnce(undefined);

    const factory = captureFactory(importFn);
    await expect(factory()).rejects.toThrow('Original failure');
  });

  it('detects various chunk-load error message patterns', async () => {
    const errorMessages = [
      'Failed to fetch dynamically imported module /assets/Page.js',
      'Loading chunk 42 failed',
      'Loading CSS chunk main-abc failed',
      'Importing a module script failed',
    ];

    for (const msg of errorMessages) {
      vi.clearAllMocks();
      sessionStorage.clear();

      const importFn = vi.fn().mockRejectedValue(new Error(msg));
      const factory = captureFactory(importFn);
      void factory();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(window.location.reload).toHaveBeenCalled();
    }
  });

  it('does not treat non-Error values as chunk-load errors', async () => {
    const importFn = vi.fn()
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      .mockRejectedValueOnce('string error')
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      .mockRejectedValueOnce('string error again');

    const factory = captureFactory(importFn);
    await expect(factory()).rejects.toBe('string error again');
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

describe('clearChunkReloadFlag', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('removes the chunk_reload key from sessionStorage', () => {
    sessionStorage.setItem('chunk_reload', '/some-page');
    clearChunkReloadFlag();
    expect(sessionStorage.getItem('chunk_reload')).toBeNull();
  });

  it('does nothing when the flag is not set', () => {
    // Should not throw
    expect(() => clearChunkReloadFlag()).not.toThrow();
    expect(sessionStorage.getItem('chunk_reload')).toBeNull();
  });
});
