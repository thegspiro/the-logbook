import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDraftAutosave } from './useDraftAutosave';

interface Values {
  title: string;
}

const create = vi.fn<(values: Values) => Promise<{ id: string }>>();
const update = vi.fn<(id: string, values: Values) => Promise<unknown>>();

const render = (
  initial: Values,
  extra: { enabled?: boolean; dirty?: boolean; initialId?: string; baseline?: Values } = {}
) =>
  renderHook(
    ({ values }: { values: Values }) =>
      useDraftAutosave<Values>({
        values,
        enabled: extra.enabled ?? true,
        isSavable: (v) => v.title.trim().length > 0,
        create,
        update,
        dirty: extra.dirty ?? true,
        delayMs: 1000,
        ...(extra.initialId ? { initialId: extra.initialId } : {}),
        ...(extra.baseline ? { baseline: extra.baseline } : {}),
      }),
    { initialProps: { values: initial } }
  );

const settle = async (ms = 1000) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  create.mockReset();
  update.mockReset();
  create.mockResolvedValue({ id: 'pr-1' });
  update.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDraftAutosave', () => {
  it('sends nothing while the server could not hold the values', async () => {
    const { result } = render({ title: '' });

    await settle(5000);

    expect(create).not.toHaveBeenCalled();
    expect(result.current.draftId).toBeNull();
    expect(result.current.hasUnsaved).toBe(true);
  });

  it('creates the draft once the values are savable, after the delay', async () => {
    const { result, rerender } = render({ title: '' });

    rerender({ values: { title: 'Ladder' } });
    await settle(900);
    expect(create).not.toHaveBeenCalled();
    await settle(200);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ title: 'Ladder' });
    expect(result.current.draftId).toBe('pr-1');
    expect(result.current.status).toBe('saved');
    expect(result.current.hasUnsaved).toBe(false);
  });

  it('updates the same record on later changes rather than creating another', async () => {
    const { rerender } = render({ title: 'Ladder' });
    await settle();

    rerender({ values: { title: 'Ladder, 24 ft' } });
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('pr-1', { title: 'Ladder, 24 ft' });
  });

  it('restarts the delay while the member keeps typing', async () => {
    const { rerender } = render({ title: 'L' });
    await settle(800);
    rerender({ values: { title: 'La' } });
    await settle(800);
    expect(create).not.toHaveBeenCalled();

    await settle(300);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ title: 'La' });
  });

  it('does not save again for values it already holds', async () => {
    const { rerender } = render({ title: 'Ladder' });
    await settle();

    rerender({ values: { title: 'Ladder' } });
    await settle(5000);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('treats a loaded record as saved, and updates it on change', async () => {
    const baseline = { title: 'Ladder' };
    const { result, rerender } = render(baseline, { initialId: 'pr-9', baseline, dirty: false });
    await settle(5000);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.current.hasUnsaved).toBe(false);

    rerender({ values: { title: 'Ladder 2' } });
    await settle();

    expect(update).toHaveBeenCalledWith('pr-9', { title: 'Ladder 2' });
  });

  it('does nothing when disabled', async () => {
    const { result } = render({ title: 'Ladder' }, { enabled: false });

    await settle(5000);

    expect(create).not.toHaveBeenCalled();
    expect(result.current.hasUnsaved).toBe(false);
    await expect(result.current.flush()).resolves.toBeNull();
  });

  it('flush saves right away and resolves to the record id', async () => {
    const { result } = render({ title: 'Ladder' });

    let id: string | null = null;
    await act(async () => {
      id = await result.current.flush();
    });

    expect(id).toBe('pr-1');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('makes a flush wait for a save already in flight instead of creating twice', async () => {
    let finish: (value: { id: string }) => void = () => undefined;
    create.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        finish = resolve;
      })
    );
    const { result } = render({ title: 'Ladder' });
    await settle();

    let id: string | null = null;
    await act(async () => {
      const pending = result.current.flush().then((value) => {
        id = value;
      });
      finish({ id: 'pr-1' });
      await pending;
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(id).toBe('pr-1');
  });

  it('reports a failed save, rejects the flush, and keeps the entries as unsaved', async () => {
    create.mockRejectedValue(new Error('boom'));
    const { result } = render({ title: 'Ladder' });
    await settle();

    expect(result.current.status).toBe('error');
    expect(result.current.hasUnsaved).toBe(true);
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow('boom');
    });
  });

  it('saves a pending change when the form is left', async () => {
    const { rerender, unmount } = render({ title: 'Ladder' });
    await settle();
    rerender({ values: { title: 'Ladder, 24 ft' } });

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(update).toHaveBeenCalledWith('pr-1', { title: 'Ladder, 24 ft' });
  });

  it('does not bring a discarded draft back when the form unmounts', async () => {
    const { result, rerender, unmount } = render({ title: 'Ladder' });
    await settle();
    rerender({ values: { title: 'Ladder, 24 ft' } });

    act(() => result.current.stop());
    unmount();
    await settle(5000);

    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('is not "unsaved" until the member has changed something', () => {
    const { result } = render({ title: '' }, { dirty: false });

    expect(result.current.hasUnsaved).toBe(false);
  });
});
