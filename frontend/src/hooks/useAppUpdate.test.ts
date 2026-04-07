import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

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
      expect(fetchSpy).toHaveBeenCalledWith();
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
      expect(fetchSpy).toHaveBeenCalledWith();
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('handles non-ok response gracefully', async () => {
    fetchSpy.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useAppUpdate(), { wrapper });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith();
    });

    expect(result.current.updateAvailable).toBe(false);
  });

  it('dismiss hides the notification', async () => {
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
});
