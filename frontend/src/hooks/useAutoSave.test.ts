import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoSave } from './useAutoSave';

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves once the interval elapses and the data has changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: 1000 }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await vi.advanceTimersByTimeAsync(1000);

    expect(onSave).toHaveBeenCalledWith({ score: 2 });
  });

  // Every tick firing a write would hammer the API for an examiner who is
  // reading rather than scoring.
  it('does not save when nothing changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutoSave({ data: { score: 1 }, onSave, interval: 1000 }));

    await vi.advanceTimersByTimeAsync(3000);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not save again until the data changes again', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: 1000 }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: 1000, enabled: false }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await vi.advanceTimersByTimeAsync(3000);

    expect(onSave).not.toHaveBeenCalled();
  });

  // A dropped connection must not stop later attempts: the examiner is still
  // scoring, and the next tick is the next chance to get the work persisted.
  it('keeps trying after a failed save', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { rerender } = renderHook(({ data }) => useAutoSave({ data, onSave, interval: 1000 }), {
      initialProps: { data: { score: 1 } },
    });

    rerender({ data: { score: 2 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSave).toHaveBeenCalledTimes(1);

    // Same data, still unsaved — the next tick retries rather than giving up.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
