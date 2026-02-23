/**
 * Form Auto-Focus Hook (#55)
 *
 * Auto-focuses the first input field when a form or modal opens.
 */

import { useEffect, useRef, RefObject } from 'react';

/**
 * Returns a ref that, when attached to a container element,
 * automatically focuses the first focusable input inside it.
 */
export function useFormAutoFocus<T extends HTMLElement = HTMLDivElement>(): RefObject<T | null> {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Slight delay to allow any animations/transitions to complete
    const timer = setTimeout(() => {
      const focusable = containerRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
      );
      focusable?.focus();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return containerRef;
}
