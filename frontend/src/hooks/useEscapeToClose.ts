import { useEffect, useRef, type RefObject } from 'react';

/**
 * Escape closes a popover — a disclosure panel such as an overflow menu or a
 * presets list that is not a modal dialog — and hands focus back to its
 * trigger. Several of these closed only on an outside click, so a keyboard
 * user who opened one had no way to put it away (WCAG 2.1.1).
 *
 * Focus returns only when it was inside the popover or on its trigger: Escape
 * pressed elsewhere while it happens to be open must not yank focus across the
 * page.
 */
export function useEscapeToClose(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const active = document.activeElement;
      const focusInside =
        active instanceof Node && (containerRef.current?.contains(active) || triggerRef.current?.contains(active));
      onCloseRef.current();
      if (focusInside) triggerRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, containerRef, triggerRef]);
}
