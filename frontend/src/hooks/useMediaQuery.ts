import { useEffect, useState } from 'react';

/**
 * Track a CSS media query from React.
 *
 * For the handful of cases where a breakpoint has to change *what is
 * rendered* rather than how it looks — a screen with two genuinely different
 * layouts, where rendering both and hiding one with `hidden md:block` would
 * duplicate every interactive control into the accessibility tree and hand
 * assistive technology two of each button.
 *
 * Prefer Tailwind's responsive variants for everything else: they need no
 * JavaScript, cannot disagree with the stylesheet, and re-flow during a resize
 * without a re-render.
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => {
    // Guarded for the server/prerender pass and for a jsdom that has not been
    // given a matchMedia; the caller gets `false` and a layout that still
    // works rather than a crash on first paint.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Re-read on subscribe: the query may already have changed between the
    // initial state and this effect.
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};

export default useMediaQuery;
