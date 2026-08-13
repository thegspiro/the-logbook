import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter, MemoryRouter, useNavigate } from 'react-router';

// Must define __BUILD_ID__ before importing the hook
vi.stubGlobal('__BUILD_ID__', 'test-build-123');

import { useAppUpdate } from './useAppUpdate';

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(BrowserRouter, null, children);
}

describe('useAppUpdate', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with updateAvailable as false', () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'test-build-123' }),
    });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });
    expect(result.current.updateAvailable).toBe(false);
  });

  it('detects an update when server buildId differs', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'new-build-456' }),
    });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });
  });

  it('does not flag update when buildId matches', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'test-build-123' }),
    });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('does not fetch when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    renderHook(() => useAppUpdate(), { wrapper });

    // Give the effect a chance to run
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('handles fetch failure gracefully', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAppUpdate(), { wrapper });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('handles non-ok response gracefully', async () => {
    fetchSpy.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('dismiss hides the notification without re-fetching version.json', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'new-build-789' }),
    });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.updateAvailable).toBe(false);
    // The dismissed buildId is remembered from the detecting check itself.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-flag a dismissed build on a later check', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'new-build-789' }),
    });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });

    act(() => {
      result.current.dismiss();
    });

    // Step past the 60s rate limit and trigger another check.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    expect(result.current.updateAvailable).toBe(false);
  });

  it('nudges the service worker registration on each allowed check', async () => {
    const registration = { update: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockResolvedValue(registration) },
      configurable: true,
    });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'test-build-123' }),
    });

    renderHook(() => useAppUpdate(), { wrapper });

    await waitFor(() => {
      expect(registration.update).toHaveBeenCalledExactlyOnceWith();
    });

    Reflect.deleteProperty(window.navigator, 'serviceWorker');
  });

  describe('auto-reload on next navigation', () => {
    const originalLocation = window.location;

    // MemoryRouter navigations never touch window.location, so it can be
    // safely replaced with a reload spy for these tests.
    function memoryWrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(MemoryRouter, { initialEntries: ['/dashboard'] }, children);
    }

    function renderWithNavigate() {
      return renderHook(() => ({ update: useAppUpdate(), navigate: useNavigate() }), {
        wrapper: memoryWrapper,
      });
    }

    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { reload: vi.fn() },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation,
      });
    });

    it('applies a pending update on the next route change', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'new-build-456' }),
      });

      const { result } = renderWithNavigate();

      await waitFor(() => {
        expect(result.current.update.updateAvailable).toBe(true);
      });

      act(() => {
        void result.current.navigate('/settings');
      });

      await waitFor(() => {
        expect(window.location.reload).toHaveBeenCalledExactlyOnceWith();
      });
    });

    it('does not reload on navigation when no update is pending', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'test-build-123' }),
      });

      const { result } = renderWithNavigate();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        void result.current.navigate('/settings');
        await Promise.resolve();
      });

      expect(window.location.reload).not.toHaveBeenCalled();
    });

    it('does not reload on navigation after the update was dismissed', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'new-build-456' }),
      });

      const { result } = renderWithNavigate();

      await waitFor(() => {
        expect(result.current.update.updateAvailable).toBe(true);
      });

      act(() => {
        result.current.update.dismiss();
      });

      await act(async () => {
        void result.current.navigate('/settings');
        await Promise.resolve();
      });

      expect(window.location.reload).not.toHaveBeenCalled();
    });
  });

  it('checks on visibility change after rate-limit window', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'test-build-123' }),
    });

    renderHook(() => useAppUpdate(), { wrapper });

    // Wait for initial check
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Visibility change immediately — should be rate-limited
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Still only 1 call because of rate limiting
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('checks immediately after connectivity is restored', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'test-build-123' }),
    });

    renderHook(() => useAppUpdate(), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('does not make another request merely to remember a deferred build', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ buildId: 'new-build-789' }),
    });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));

    act(() => result.current.dismiss());

    expect(result.current.updateAvailable).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
