import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScanFeedback } from './useScanFeedback';

describe('useScanFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flashes on success and clears the flash after the timeout', () => {
    const { result } = renderHook(() => useScanFeedback());
    expect(result.current.flashing).toBe(false);

    act(() => {
      result.current.signalScanSuccess();
    });
    expect(result.current.flashing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.flashing).toBe(false);
  });

  it('vibrates when the Vibration API is available (Android), and does not throw without it (iOS)', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    const { result } = renderHook(() => useScanFeedback());
    act(() => {
      result.current.signalScanSuccess();
    });
    expect(vibrate).toHaveBeenCalledWith(60);

    // iOS Safari: no vibrate — must not throw.
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
    expect(() => act(() => result.current.signalScanSuccess())).not.toThrow();
  });
});
