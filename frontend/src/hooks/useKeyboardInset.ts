import { useEffect, useState } from 'react';

/**
 * Publishes the on-screen keyboard's height as the `--keyboard-inset` CSS
 * custom property on <html>, so bottom-pinned action bars can lift clear of it.
 *
 * iOS does not resize the layout viewport when the keyboard opens — it shrinks
 * the *visual* viewport and leaves `position: fixed` / `sticky bottom-0`
 * elements pinned behind the keyboard, where they cannot be tapped. Neither
 * `100dvh` nor `env(safe-area-inset-bottom)` accounts for this. The difference
 * between the layout and visual viewports is the keyboard height.
 *
 * Android (and desktop) resize the layout viewport instead, so the computed
 * difference stays ~0 there and nothing shifts — the same rule is safe on
 * every platform.
 *
 * Mounted once, at the app root. Returns the inset in CSS pixels for callers
 * that need to react in JS rather than CSS — the bottom navigation hides while
 * the keyboard is up rather than floating on top of it.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;

    const update = () => {
      // offsetTop covers the case where the visual viewport has been scrolled
      // within the layout viewport (iOS does this to reveal the focused field).
      const raw = window.innerHeight - vv.height - vv.offsetTop;
      // Small deltas show up from rubber-banding and toolbar transitions; only
      // react to something keyboard-sized so the layout doesn't twitch.
      const next = raw > 80 ? Math.round(raw) : 0;
      root.style.setProperty('--keyboard-inset', `${next}px`);
      setInset((prev) => (prev === next ? prev : next));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);

  return inset;
}
