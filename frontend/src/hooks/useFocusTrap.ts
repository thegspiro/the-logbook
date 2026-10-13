import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface ActiveTrap {
  container: HTMLElement;
  opener: HTMLElement | null;
  fallback: HTMLElement | null;
}

/**
 * Traps that are currently active. A dialog opened from inside another dialog
 * records that dialog's opener as its fallback: a confirmation raised by a
 * picker that closes as it opens has an opener inside the picker, which is gone
 * by the time the confirmation closes, and focus would otherwise fall to <body>.
 */
const activeTraps: ActiveTrap[] = [];

const fallbackFor = (opener: HTMLElement | null): HTMLElement | null => {
  if (!opener) return null;
  const parent = activeTraps.find((trap) => trap.container.contains(opener));
  return parent ? (parent.opener?.isConnected ? parent.opener : parent.fallback) : null;
};

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
  const fallbackElement = useRef<HTMLElement | null>(null);
  const wasActive = useRef(false);
  const running = useRef(false);

  // The opener is read during render, not in the effect: a child's `autoFocus`
  // runs in the commit before this effect does, so by then document.activeElement
  // is the dialog's own field and closing restored focus to an element that had
  // just been unmounted, dropping a keyboard user back at <body>.
  if (isActive && !wasActive.current && typeof document !== 'undefined') {
    previousActiveElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fallbackElement.current = fallbackFor(previousActiveElement.current);
  }
  wasActive.current = isActive;

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;
    running.current = true;

    const opener = previousActiveElement.current;
    if (opener && container.contains(opener)) previousActiveElement.current = null;

    const trap: ActiveTrap = {
      container,
      opener: previousActiveElement.current,
      fallback: fallbackElement.current,
    };
    activeTraps.push(trap);

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
      const index = activeTraps.indexOf(trap);
      if (index !== -1) activeTraps.splice(index, 1);
      running.current = false;

      // Deferred, and skipped if the trap is running again by then: StrictMode
      // runs this cleanup and the effect back to back on mount, and restoring
      // here pulled focus out of a dialog that had only just opened. An opener
      // since removed from the page cannot take focus back, so the fallback
      // recorded at open is tried before giving up.
      queueMicrotask(() => {
        if (running.current) return;
        // A dialog that opened as this one closed already holds focus.
        if (activeTraps.some((other) => other.container.contains(document.activeElement))) return;
        const target = [trap.opener, trap.fallback].find((element) => element?.isConnected);
        target?.focus();
      });
    };
  }, [isActive]);

  return containerRef;
}
