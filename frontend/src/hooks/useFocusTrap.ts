import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Custom hook to trap focus within a container element
 * Useful for modals, mobile menus, and other overlay elements
 *
 * On activation focus moves to, in order: whatever inside the container already
 * holds it (an `autoFocus` field), an element marked `data-autofocus`, the first
 * focusable that is not marked `data-dialog-close`, and only then the close
 * button. Landing on the header X put every form one Tab behind its first field
 * and every confirmation on the one control that decides nothing.
 *
 * @param isActive - Whether the focus trap should be active
 * @returns ref - React ref to attach to the container element
 */
export function useFocusTrap<T extends HTMLElement>(isActive: boolean) {
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const wasActive = useRef(false);

  // The opener is read during render, not in the effect: a child's `autoFocus`
  // runs in the commit before this effect does, so by then document.activeElement
  // is the dialog's own field and closing restored focus to an element that had
  // just been unmounted, dropping a keyboard user back at <body>.
  if (isActive && !wasActive.current && typeof document !== 'undefined') {
    previousActiveElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasActive.current = isActive;

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    const opener = previousActiveElement.current;
    if (opener && container.contains(opener)) previousActiveElement.current = null;

    const getFocusableElements = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    if (!container.contains(document.activeElement)) {
      const focusableElements = getFocusableElements();
      const preferred =
        container.querySelector<HTMLElement>('[data-autofocus]') ??
        focusableElements.find((element) => !element.hasAttribute('data-dialog-close')) ??
        focusableElements[0];
      preferred?.focus();
    }

    // Handle tab key press
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        // Shift + Tab: going backwards
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab: going forwards
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Cleanup: restore focus and remove listener
    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      // An opener that has since been removed from the page cannot take focus
      // back; focusing it is a silent no-op that leaves focus on <body>.
      const target = previousActiveElement.current;
      if (target?.isConnected) target.focus();
      previousActiveElement.current = null;
    };
  }, [isActive]);

  return containerRef;
}
