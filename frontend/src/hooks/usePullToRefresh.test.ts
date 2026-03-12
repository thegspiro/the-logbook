import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePullToRefresh } from './usePullToRefresh';

function simulatePull(startY: number, endY: number) {
  const touchStart = new TouchEvent('touchstart', {
    touches: [{ clientY: startY } as Touch],
  });
  const touchMove = new TouchEvent('touchmove', {
    touches: [{ clientY: endY } as Touch],
  });
  const touchEnd = new TouchEvent('touchend');

  document.dispatchEvent(touchStart);
  document.dispatchEvent(touchMove);
  document.dispatchEvent(touchEnd);
}

describe('usePullToRefresh', () => {
  let onRefresh: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    onRefresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh })
    );
    expect(result.current.pulling).toBe(false);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.pullDistance).toBe(0);
  });

  it('sets pulling state on touch move', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh })
    );

    act(() => {
      document.dispatchEvent(
        new TouchEvent('touchstart', {
          touches: [{ clientY: 0 } as Touch],
        })
      );
      document.dispatchEvent(
        new TouchEvent('touchmove', {
          touches: [{ clientY: 60 } as Touch],
        })
      );
    });

    expect(result.current.pulling).toBe(true);
    expect(result.current.pullDistance).toBeGreaterThan(0);
  });

  it('triggers refresh when pulled past threshold', async () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 40 })
    );

    act(() => {
      // Pull distance is (endY - startY) * 0.5 = (200-0)*0.5 = 100, which > 40
      simulatePull(0, 200);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
  });

  it('does not trigger refresh when pull is below threshold', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 80 })
    );

    act(() => {
      // Pull distance is (20-0)*0.5 = 10, which < 80
      simulatePull(0, 20);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.refreshing).toBe(false);
  });

  it('does nothing when disabled', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, disabled: true })
    );

    act(() => {
      simulatePull(0, 200);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.pulling).toBe(false);
  });

  it('does not activate when page is scrolled down', () => {
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true });

    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh })
    );

    act(() => {
      simulatePull(0, 200);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.pulling).toBe(false);
  });

  it('resets state after refresh completes', async () => {
    let resolveRefresh: () => void;
    const pendingRefresh = new Promise<void>((r) => {
      resolveRefresh = r;
    });
    onRefresh.mockReturnValue(pendingRefresh);

    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 40 })
    );

    act(() => {
      simulatePull(0, 200);
    });

    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      resolveRefresh?.();
      await pendingRefresh;
    });

    expect(result.current.refreshing).toBe(false);
    expect(result.current.pulling).toBe(false);
    expect(result.current.pullDistance).toBe(0);
  });

  it('clamps pull distance to 1.5x threshold', () => {
    const threshold = 40;
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold })
    );

    act(() => {
      document.dispatchEvent(
        new TouchEvent('touchstart', {
          touches: [{ clientY: 0 } as Touch],
        })
      );
      // (1000)*0.5 = 500, but should clamp to 40*1.5 = 60
      document.dispatchEvent(
        new TouchEvent('touchmove', {
          touches: [{ clientY: 1000 } as Touch],
        })
      );
    });

    expect(result.current.pullDistance).toBe(threshold * 1.5);
  });
});
