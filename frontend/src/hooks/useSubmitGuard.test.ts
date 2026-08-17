import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSubmitGuard } from './useSubmitGuard';

/** A promise whose resolution this test controls. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSubmitGuard', () => {
  it('ignores a second call while the first is in flight', async () => {
    const d = deferred();
    const action = vi.fn(() => d.promise);
    const { result } = renderHook(() => useSubmitGuard());

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.run(action);
      second = result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve();
      await Promise.all([first, second]);
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('blocks the second of two clicks in the same frame, which state alone would not', async () => {
    // The regression this exists for: React batches both handlers, so a
    // useState flag reads false in both and both requests go out.
    const d = deferred();
    const action = vi.fn(() => d.promise);
    const { result } = renderHook(() => useSubmitGuard());

    act(() => {
      void result.current.run(action);
      void result.current.run(action);
      void result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve();
    });
  });

  it('allows a fresh call once the first settles', async () => {
    const action = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useSubmitGuard());

    await act(async () => {
      await result.current.run(action);
    });
    await act(async () => {
      await result.current.run(action);
    });

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when the action rejects', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('nope')));
    const { result } = renderHook(() => useSubmitGuard());

    // A create that 422s must not wedge its own button forever.
    await act(async () => {
      await expect(result.current.run(failing)).rejects.toThrow('nope');
    });
    expect(result.current.busy).toBe(false);

    await act(async () => {
      await result.current.run(failing).catch(() => undefined);
    });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('exposes busy for the duration so the button can disable', async () => {
    const d = deferred();
    const { result } = renderHook(() => useSubmitGuard());

    expect(result.current.busy).toBe(false);
    act(() => {
      void result.current.run(() => d.promise);
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      d.resolve();
      await d.promise;
    });
    expect(result.current.busy).toBe(false);
  });
});
