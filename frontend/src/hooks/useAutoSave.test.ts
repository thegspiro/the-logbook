import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from './useAutoSave';

const INTERVAL = 1000;

/**
 * Advance past n save ticks. The hook sets state when a save settles, so the
 * timer advance is wrapped in act().
 */
const tick = async (times = 1) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(INTERVAL * times);
  });
};

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves once the interval elapses and the data has changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: INTERVAL }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await tick();

    expect(onSave).toHaveBeenCalledWith({ score: 2 });
  });

  // Every tick firing a write would hammer the API for an examiner who is
  // reading rather than scoring.
  it('does not save when nothing changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoSave({ data: { score: 1 }, onSave, interval: INTERVAL }));

    await tick(3);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not save again until the data changes again', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: INTERVAL }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await tick();
    await tick(3);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: INTERVAL, enabled: false }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await tick(3);

    expect(onSave).not.toHaveBeenCalled();
  });

  // A dropped connection must not stop later attempts: the examiner is still
  // scoring, and the next tick is the next chance to get the work persisted.
  it('keeps trying after a failed save', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: INTERVAL }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await tick();
    expect(onSave).toHaveBeenCalledTimes(1);

    // Same data, still unsaved — the next tick retries rather than giving up.
    await tick();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ score: 2 });
  });

  // A background save has no promise for the user to await and no click to
  // respond to. If the hook keeps the failure to itself, the examiner goes on
  // scoring into a form they believe is saving — so the status is the contract.
  describe('reporting failures to the caller', () => {
    it('reports a failed save rather than swallowing it', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Network unreachable'));
      const { result, rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: INTERVAL }), {
        initialProps: { data: { score: 1 } },
      });

      rerender({ data: { score: 2 } });
      await tick();

      expect(result.current.status).toBe('failed');
      expect(result.current.error?.message).toBe('Network unreachable');
      expect(result.current.failureCount).toBe(1);
      expect(result.current.lastSavedAt).toBeNull();
    });

    it('counts consecutive failures so a caller can escalate', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Network unreachable'));
      const { result, rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: INTERVAL }), {
        initialProps: { data: { score: 1 } },
      });

      rerender({ data: { score: 2 } });
      await tick();
      await tick();

      expect(result.current.failureCount).toBe(2);
    });

    it('clears the failure once a retry succeeds', async () => {
      const onSave = vi.fn().mockRejectedValueOnce(new Error('Network unreachable')).mockResolvedValueOnce(undefined);
      const { result, rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: INTERVAL }), {
        initialProps: { data: { score: 1 } },
      });

      rerender({ data: { score: 2 } });
      await tick();
      expect(result.current.status).toBe('failed');

      await tick();

      expect(result.current.status).toBe('saved');
      expect(result.current.error).toBeNull();
      expect(result.current.failureCount).toBe(0);
      expect(result.current.lastSavedAt).not.toBeNull();
    });
  });
});
