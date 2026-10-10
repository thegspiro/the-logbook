import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * A horizontally scrolling row that shows there is more to see.
 *
 * `hscroll` hides the scrollbar, which is right for a row of chips and wrong
 * on its own: with nothing drawn at the edge, a phone user sees four chips and
 * has no reason to think there is a fifth. So whichever end has content past
 * it is faded out, and a round chevron button sits over that edge — the fade
 * says "this continues", the button says which way, and tapping it pages the
 * row along for anyone who does not think to swipe. When everything fits,
 * nothing is drawn at all.
 *
 * The chevrons are a pointer convenience, not a second way in for a keyboard:
 * they are out of the tab order and hidden from assistive technology, because
 * the row's own items are already reachable — a tablist's arrow keys, or Tab
 * through links — and moving focus onto an item scrolls it into view.
 *
 * The selected item (`[aria-selected="true"]` or `[aria-current]`) is scrolled
 * into view when `revealKey` changes, so a deep link to the last tab does not
 * open with that tab off screen and nothing saying which one is open.
 */

interface ScrollCueRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Classes for the scrolling element itself; `hscroll` is always applied. */
  className?: string;
  /** Change it to re-reveal the selected item, e.g. the active tab's id. */
  revealKey?: string | undefined;
  children: React.ReactNode;
}

/** Below this many pixels of hidden content an edge counts as reached. */
const EDGE_TOLERANCE = 2;
/** The chevron's width plus a little air: an item under it is not visible. */
const CHEVRON_INSET = 48;

export const ScrollCueRow: React.FC<ScrollCueRowProps> = ({ className = '', revealKey, children, ...rest }) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > EDGE_TOLERANCE);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_TOLERANCE);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // Content and container both change width — a rotated phone, a badge
    // arriving with the summary, the sidebar opening — so observe both.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, children]);

  // Only the row's own scrollLeft moves: scrollIntoView would also scroll the
  // page vertically and jump past the header on first load. An item under a
  // chevron counts as hidden — the button covers it — hence the inset.
  const reveal = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const selected = el.querySelector<HTMLElement>(
      '[aria-selected="true"], [aria-current]:not([aria-current="false"])'
    );
    if (!selected) return;
    const itemRect = selected.getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();
    if (itemRect.left >= rowRect.left + CHEVRON_INSET && itemRect.right <= rowRect.right - CHEVRON_INSET) return;
    el.scrollLeft += itemRect.left - rowRect.left - (rowRect.width - itemRect.width) / 2;
    measure();
  }, [measure]);

  useEffect(() => {
    reveal();
    // The web font widens every chip when it arrives, which moves the end of
    // the row out from under a scroll made against the fallback font — a deep
    // link to the last tab then opened with it half under the right chevron.
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) reveal();
    });
    return () => {
      cancelled = true;
    };
  }, [revealKey, reveal]);

  const page = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Most of a screen, so the item that was cut off at the edge is still
    // partly visible afterwards and the user keeps their place.
    el.scrollBy({ left: direction * el.clientWidth * 0.75, behavior: 'smooth' });
  };

  // A mask fades the items themselves, so it works on any background — the
  // page here is a gradient, and an overlay painted in one colour would show
  // as a stripe over it.
  const fade = (left: boolean, right: boolean) =>
    `linear-gradient(to right, ${left ? 'transparent 0, black 3rem' : 'black 0'}, ${
      right ? 'black calc(100% - 3rem), transparent 100%' : 'black 100%'
    })`;
  const maskImage = canScrollLeft || canScrollRight ? fade(canScrollLeft, canScrollRight) : undefined;

  const chevronClass =
    'border-theme-surface-border bg-theme-surface text-theme-text-primary absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border shadow-md';

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className={`hscroll ${className}`}
        style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
        data-scroll-fade={
          canScrollLeft && canScrollRight ? 'both' : canScrollLeft ? 'left' : canScrollRight ? 'right' : undefined
        }
        {...rest}
      >
        {children}
      </div>
      {canScrollLeft && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => page(-1)}
          className={`${chevronClass} left-0`}
          data-testid="scroll-cue-left"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => page(1)}
          className={`${chevronClass} right-0`}
          data-testid="scroll-cue-right"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default ScrollCueRow;
