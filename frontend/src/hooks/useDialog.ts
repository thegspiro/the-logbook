import { useEffect, useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';
import { useOverlaySurface } from './useOverlaySurface';

/**
 * Shared dialog behaviour: focus trapping, Escape-to-close and body scroll lock.
 *
 * Every modal in the app needs these three, and hand-rolled shells reliably
 * shipped with only the first one people notice is missing (Escape). A sweep in
 * 2026-08 found 99 hand-built dialog shells: 62 handled Escape, none trapped
 * focus, and none locked body scroll.
 */

/**
 * Open dialogs, innermost last. Escape and the scroll lock belong to the stack
 * rather than to any single dialog: a confirmation opened from inside another
 * dialog must not unlock body scroll when only it closes, and Escape must
 * dismiss the top dialog rather than every dialog at once.
 */
interface OpenDialog {
  id: symbol;
  lockScroll: boolean;
}

const openDialogs: OpenDialog[] = [];
let overflowBeforeFirstLock: string | null = null;

/**
 * Derive the body lock from the complete dialog stack rather than whichever
 * dialog happened to mount or unmount last. This matters when a non-locking
 * popover/dialog overlaps a true modal: closing them in either order must not
 * leave an invisible page-wide interaction barrier behind.
 */
const syncBodyScrollLock = () => {
  const shouldLock = openDialogs.some((dialog) => dialog.lockScroll);

  if (shouldLock && overflowBeforeFirstLock === null) {
    overflowBeforeFirstLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else if (!shouldLock && overflowBeforeFirstLock !== null) {
    document.body.style.overflow = overflowBeforeFirstLock;
    overflowBeforeFirstLock = null;
  }
};

export interface UseDialogOptions {
  /** Defaults to true, for dialogs the parent mounts only while open. */
  isOpen?: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
  lockScroll?: boolean;
}

export function useDialog<T extends HTMLElement>({
  isOpen = true,
  onClose,
  closeOnEscape = true,
  lockScroll = true,
}: UseDialogOptions) {
  const containerRef = useFocusTrap<T>(isOpen);

  // Lifts the mobile bottom navigation off the dialog while it is open; see
  // useOverlaySurface for why this is tracked separately from `openDialogs`.
  useOverlaySurface(isOpen);

  // Held in a ref so a caller passing an inline arrow does not tear down and
  // re-register the listener (and re-push onto the stack) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;

    const id = Symbol('dialog');
    openDialogs.push({ id, lockScroll });
    syncBodyScrollLock();

    const handleEscape = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.key !== 'Escape') return;
      if (openDialogs[openDialogs.length - 1]?.id !== id) return;
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      const index = openDialogs.findIndex((dialog) => dialog.id === id);
      if (index !== -1) openDialogs.splice(index, 1);
      syncBodyScrollLock();
    };
  }, [isOpen, closeOnEscape, lockScroll]);

  return containerRef;
}
