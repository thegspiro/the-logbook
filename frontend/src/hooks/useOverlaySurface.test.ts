import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOverlaySurface, useAnyOverlaySurface } from './useOverlaySurface';
import { useDialog } from './useDialog';

describe('useOverlaySurface', () => {
  it('reports an overlay only while one is mounted and open', () => {
    const observer = renderHook(() => useAnyOverlaySurface());
    expect(observer.result.current).toBe(false);

    const overlay = renderHook(() => useOverlaySurface());
    expect(observer.result.current).toBe(true);

    overlay.unmount();
    expect(observer.result.current).toBe(false);
  });

  it('ignores a surface that is mounted but closed', () => {
    const observer = renderHook(() => useAnyOverlaySurface());
    const overlay = renderHook(({ open }) => useOverlaySurface(open), { initialProps: { open: false } });

    expect(observer.result.current).toBe(false);

    act(() => overlay.rerender({ open: true }));
    expect(observer.result.current).toBe(true);

    act(() => overlay.rerender({ open: false }));
    expect(observer.result.current).toBe(false);
  });

  it('stays true until the last of several stacked overlays closes', () => {
    // A confirm opened from inside a dialog must not put the bottom bar back
    // over the dialog still underneath it.
    const observer = renderHook(() => useAnyOverlaySurface());
    const outer = renderHook(() => useOverlaySurface());
    const inner = renderHook(() => useOverlaySurface());

    inner.unmount();
    expect(observer.result.current).toBe(true);

    outer.unmount();
    expect(observer.result.current).toBe(false);
  });

  it('is driven by useDialog, so every dialog lifts the bar without opting in', () => {
    const observer = renderHook(() => useAnyOverlaySurface());
    const dialog = renderHook(() => useDialog({ onClose: vi.fn() }));

    expect(observer.result.current).toBe(true);

    dialog.unmount();
    expect(observer.result.current).toBe(false);
    // useDialog owns the scroll lock; releasing it is that hook's contract and
    // must not have been disturbed by joining the overlay stack.
    expect(document.body.style.overflow).toBe('unset');
  });

  it('does not strand useDialog’s scroll lock when a drawer is also open', () => {
    // The regression this separation exists to prevent: a drawer registering in
    // useDialog's own stack would leave `openDialogs` non-empty when the dialog
    // above it closed, so the lock would never be released.
    document.body.style.overflow = '';
    const drawer = renderHook(() => useOverlaySurface());
    const dialog = renderHook(() => useDialog({ onClose: vi.fn() }));
    expect(document.body.style.overflow).toBe('hidden');

    dialog.unmount();
    expect(document.body.style.overflow).toBe('unset');

    drawer.unmount();
  });
});
