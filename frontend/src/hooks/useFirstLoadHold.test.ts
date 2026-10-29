import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_LOAD_HOLD_MS, useFirstLoadHold } from './useFirstLoadHold';

describe('useFirstLoadHold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds while waiting and lets go when the wait ends', () => {
    const { result, rerender } = renderHook(({ waiting }) => useFirstLoadHold(waiting), {
      initialProps: { waiting: true },
    });
    expect(result.current).toBe(true);

    rerender({ waiting: false });
    expect(result.current).toBe(false);
  });

  it('never holds when there is nothing to wait for', () => {
    const { result } = renderHook(() => useFirstLoadHold(false));
    expect(result.current).toBe(false);
  });

  it('lets go after the cap however long the wait runs', () => {
    const { result } = renderHook(() => useFirstLoadHold(true));

    act(() => {
      vi.advanceTimersByTime(FIRST_LOAD_HOLD_MS - 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  // A refresh after the first load must keep the page on screen.
  it('does not hold again once it has let go', () => {
    const { result, rerender } = renderHook(({ waiting }) => useFirstLoadHold(waiting), {
      initialProps: { waiting: true },
    });
    rerender({ waiting: false });
    rerender({ waiting: true });
    expect(result.current).toBe(false);
  });
});
