import { useState, useEffect } from 'react';

/**
 * useMediaQuery — subscribe to a CSS media query from JS.
 *
 * @param query  A valid media-query string, e.g. `"(min-width: 768px)"`.
 * @returns `true` when the query matches, `false` otherwise.
 *
 * @example
 *   const isMobile  = useMediaQuery('(max-width: 639px)');
 *   const isDesktop = useMediaQuery('(min-width: 1024px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };

    mql.addEventListener('change', handler);
    return () => {
      mql.removeEventListener('change', handler);
    };
  }, [query]);

  return matches;
}

/** Tailwind-aligned breakpoint helpers. */
export const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
  '2xl': '(min-width: 1536px)',
} as const;
