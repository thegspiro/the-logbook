/**
 * Reset scroll position on client-side navigation.
 *
 * The app scrolls the window (no inner overflow container), and react-router's
 * declarative <BrowserRouter> does not reset scroll between routes — only the
 * data-router <ScrollRestoration> does, which this app doesn't use. So the
 * window keeps whatever offset the previous page left behind: opening a skills
 * test from the bottom of a long list dropped the examiner partway down the new
 * page, below the questions, forcing a scroll back up to start.
 *
 * Two deliberate exceptions:
 * - POP (browser back/forward) is left alone, so returning to a list keeps your
 *   place instead of throwing you to the top.
 * - A URL carrying a #hash is left alone, so anchor links reach their target.
 */

import { useEffect } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router';

export function useScrollToTopOnNavigate(): void {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === NavigationType.Pop) return;
    if (hash) return;

    // 'instant' rather than smooth: this is a page change, not an in-page jump,
    // and animating it would show the outgoing scroll position racing upward.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash, navigationType]);
}

export default useScrollToTopOnNavigate;
