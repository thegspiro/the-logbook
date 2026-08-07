import { useEffect } from 'react';

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
 * Mounted once, at the app root.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;

    const update = () => {
      // offsetTop covers the case where the visual viewport has been scrolled
      // within the layout viewport (iOS does this to reveal the focused field).
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      // Small deltas show up from rubber-banding and toolbar transitions; only
      // react to something keyboard-sized so the layout doesn't twitch.
      root.style.setProperty('--keyboard-inset', inset > 80 ? `${Math.round(inset)}px` : '0px');
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
}
