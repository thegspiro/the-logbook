import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import { useDialog, useOpenDialogDepth } from './useDialog';

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

/**
 * The depth is what lets a dialog carrying its own `aria-modal` surface go
 * `inert` while another dialog sits on top of it. Both portal to the body, so
 * they are siblings rather than nested, and two live aria-modal surfaces leave
 * assistive technology to guess which one is current.
 *
 * Keyed on the stack rather than on any one flag because the dialog on top is
 * often opened by a component that keeps its open state private —
 * PrintDocumentButton's receipt-printer dialog is opened from inside the Shift
 * Details header and reports nothing upwards.
 */
describe('useOpenDialogDepth', () => {
  it('counts nothing while no dialog is open', () => {
    const { result } = renderHook(() => useOpenDialogDepth());
    expect(result.current).toBe(0);
  });

  it('rises as dialogs stack and falls as they close', () => {
    const { result } = renderHook(() => useOpenDialogDepth());

    const outer = renderHook(() => useDialog({ onClose: vi.fn() }));
    expect(result.current).toBe(1);

    const inner = renderHook(() => useDialog({ onClose: vi.fn() }));
    expect(result.current).toBe(2);

    inner.unmount();
    expect(result.current).toBe(1);

    outer.unmount();
    expect(result.current).toBe(0);
  });

  it('does not count a dialog that is closed', () => {
    const { result } = renderHook(() => useOpenDialogDepth());
    renderHook(() => useDialog({ isOpen: false, onClose: vi.fn() }));

    expect(result.current).toBe(0);
  });
});
