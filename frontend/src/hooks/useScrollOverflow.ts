import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface ScrollOverflow {
  /** Content is hidden above the visible area. */
  canScrollUp: boolean;
  /** Content is hidden below the visible area. */
  canScrollDown: boolean;
}

/**
 * A couple of pixels of slack: fractional scroll positions on high-DPI phones
 * leave `scrollTop + clientHeight` a hair short of `scrollHeight` at the very
 * bottom, which would keep the "more below" cue lit with nothing left to show.
 */
const EDGE_TOLERANCE_PX = 2;

/**
 * Reports whether a scroll container has content hidden above or below it.
 *
 * Exists because mobile browsers draw overlay scrollbars that stay invisible
 * until the user is already scrolling, so a list that is cut off exactly at an
 * item boundary gives no sign that there is anything more — the drawer reads
 * as complete. Callers use this to paint an edge fade and a "more" control.
 *
 * Re-measures on scroll, on the container resizing (rotation, drawer height),
 * and on its content changing (a submenu expanding grows the content without
 * resizing the container, which a ResizeObserver on the container alone would
 * miss).
 */
export function useScrollOverflow(ref: RefObject<HTMLElement | null>): ScrollOverflow {
  const [state, setState] = useState<ScrollOverflow>({ canScrollUp: false, canScrollDown: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const canScrollUp = el.scrollTop > EDGE_TOLERANCE_PX;
    const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - EDGE_TOLERANCE_PX;
    setState((prev) =>
      prev.canScrollUp === canScrollUp && prev.canScrollDown === canScrollDown ? prev : { canScrollUp, canScrollDown }
    );
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();

    el.addEventListener('scroll', measure, { passive: true });

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    const observeChildren = () => {
      if (!resizeObserver) return;
      resizeObserver.disconnect();
      resizeObserver.observe(el);
      Array.from(el.children).forEach((child) => resizeObserver.observe(child));
    };
    observeChildren();

    const mutationObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            observeChildren();
            measure();
          })
        : null;
    mutationObserver?.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener('scroll', measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [ref, measure]);

  return state;
}
