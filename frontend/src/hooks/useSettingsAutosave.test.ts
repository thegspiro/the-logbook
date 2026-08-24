import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]): void => {
      mockToastError(...args);
    },
  },
}));

import { useSettingsAutosave } from './useSettingsAutosave';

/** Resolves after every already-queued microtask, so a chained saver can run. */
const flushMicrotasks = async () => {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
};

describe('useSettingsAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockToastError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Two writes overlapping is two whole settings objects racing, and the loser
  // is whichever the server happens to commit second — not whichever the member
  // chose second.
  it('runs writes one at a time, in the order they were made', async () => {
    const order: string[] = [];
    const slow = vi.fn(async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push('first:end');
    });
    const quick = vi.fn(async () => {
      order.push('second:start');
    });

    const { result } = renderHook(() => useSettingsAutosave());

    act(() => {
      void result.current.save(slow);
      void result.current.save(quick);
    });
    await flushMicrotasks();

    expect(order).toEqual(['first:start']);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  // Typing and immediately clicking away is the ordinary way to use a field
  // that saves itself. Dropping the timer there loses the edit with nothing on
  // screen having claimed to save it.
  it('flushes a pending debounced write when the screen unmounts', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useSettingsAutosave());

    act(() => {
      result.current.saveDebounced('name', saver);
    });
    expect(saver).not.toHaveBeenCalled();

    unmount();
    await flushMicrotasks();

    expect(saver).toHaveBeenCalled();
  });

  it('does not fire a debounced write twice when it already ran before unmount', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useSettingsAutosave());

    act(() => {
      result.current.saveDebounced('name', saver);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(saver).toHaveBeenCalledTimes(1);

    unmount();
    await flushMicrotasks();

    expect(saver).toHaveBeenCalledTimes(1);
  });

  // A later success must not paint over an earlier loss: the module toggle that
  // failed is still not saved, whatever the contact-visibility write did.
  it('keeps reporting an error while an earlier failure is unrecovered', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('nope'));
    const succeeding = vi.fn().mockResolvedValue('ok');

    const { result } = renderHook(() => useSettingsAutosave());

    await act(async () => {
      void result.current.save(failing);
      void result.current.save(succeeding);
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(succeeding).toHaveBeenCalled();
    expect(result.current.saveState).toBe('error');
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it('clears the error once the failed write is retried successfully', async () => {
    const saver = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('ok');

    const { result } = renderHook(() => useSettingsAutosave());

    await act(async () => {
      void result.current.save(saver);
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.saveState).toBe('error');

    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(saver).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe('saved');
  });

  // retry() re-runs the saver, so whatever the caller does with the response
  // has to live inside it. This pins that the same function is re-invoked.
  it('re-runs the failed saver itself rather than a bare request', async () => {
    const applied: string[] = [];
    const saver = vi.fn(async () => {
      if (applied.length === 0) {
        applied.push('attempted');
        throw new Error('nope');
      }
      applied.push('applied');
      return 'ok';
    });

    const { result } = renderHook(() => useSettingsAutosave());

    await act(async () => {
      void result.current.save(saver);
      await vi.advanceTimersByTimeAsync(800);
    });

    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(applied).toEqual(['attempted', 'applied']);
  });
});
