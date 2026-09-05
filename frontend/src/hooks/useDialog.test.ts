import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import { useDialog } from './useDialog';

afterEach(() => {
  document.body.style.overflow = '';
});

describe('useDialog', () => {
  it('locks body scroll while open and releases it on close', () => {
    const { unmount } = renderHook(() => useDialog({ onClose: vi.fn() }));
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('does nothing while closed', () => {
    const onClose = vi.fn();
    renderHook(() => useDialog({ isOpen: false, onClose }));

    expect(document.body.style.overflow).toBe('');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderHook(() => useDialog({ onClose }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape when closeOnEscape is false', () => {
    const onClose = vi.fn();
    renderHook(() => useDialog({ onClose, closeOnEscape: false }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves body scroll locked when an inner dialog closes over an outer one', () => {
    const outer = renderHook(() => useDialog({ onClose: vi.fn() }));
    const inner = renderHook(() => useDialog({ onClose: vi.fn() }));
    expect(document.body.style.overflow).toBe('hidden');

    // The page behind both is still covered, so it must stay locked.
    inner.unmount();
    expect(document.body.style.overflow).toBe('hidden');

    outer.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the page when locking and non-locking dialogs close out of order', () => {
    const locking = renderHook(() => useDialog({ onClose: vi.fn() }));
    const nonLocking = renderHook(() => useDialog({ onClose: vi.fn(), lockScroll: false }));

    locking.unmount();
    expect(document.body.style.overflow).toBe('');

    // Previously the non-locking entry kept the stack non-empty but would not
    // release the lock itself, leaving the page permanently unscrollable.
    nonLocking.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the body overflow value that existed before the dialog', () => {
    document.body.style.overflow = 'clip';
    const dialog = renderHook(() => useDialog({ onClose: vi.fn() }));

    expect(document.body.style.overflow).toBe('hidden');
    dialog.unmount();
    expect(document.body.style.overflow).toBe('clip');
  });

  it('routes Escape to the innermost dialog only', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    renderHook(() => useDialog({ onClose: outerClose }));
    const inner = renderHook(() => useDialog({ onClose: innerClose }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();

    // With the inner one gone, Escape falls through to the dialog beneath it.
    inner.unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledTimes(1);
  });

  it('does not re-register when the caller passes a new onClose each render', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(() =>
      useDialog({
        onClose: () => {
          onClose();
        },
      })
    );

    rerender();
    rerender();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
