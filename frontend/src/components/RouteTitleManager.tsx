import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router';

const APPLICATION_NAME = 'The Logbook';

/**
 * Keeps the browser tab aligned with the page rendered by the router.
 *
 * This lives above the route-level Suspense boundary, rather than in
 * AppLayout, because authentication pages, public pages, and lazy-loading
 * fallbacks all need to clear the title of the page that preceded them. Title
 * discovery is deliberately independent of requestAnimationFrame: browsers
 * throttle animation frames in background tabs, where a useful title matters
 * most. The observer remains active for the route's lifetime so a heading that
 * arrives after a slow request—or whose text is filled in later—still wins.
 */
export function RouteTitleManager(): null {
  const location = useLocation();

  useLayoutEffect(() => {
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const clearTitle = () => {
      document.title = APPLICATION_NAME;
    };
    const pushState: History['pushState'] = function (...args) {
      clearTitle();
      return originalPushState(...args);
    };
    const replaceState: History['replaceState'] = function (...args) {
      clearTitle();
      return originalReplaceState(...args);
    };

    // React may keep the previous route painted while a lazy destination
    // suspends. History changes before that render settles, so this boundary is
    // the only reliable place to prevent the source page's title lingering.
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    window.addEventListener('popstate', clearTitle);

    return () => {
      if (window.history.pushState === pushState) window.history.pushState = originalPushState;
      if (window.history.replaceState === replaceState) window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', clearTitle);
    };
  }, []);

  useLayoutEffect(() => {
    document.title = APPLICATION_NAME;

    const updateTitle = () => {
      // A comma-separated selector returns the first match in document order,
      // not the first selector's match. Query in priority order so an
      // onboarding/header brand h1 cannot outrank the actual page heading.
      const heading =
        document.querySelector<HTMLElement>('[role="main"] h1') ??
        document.querySelector<HTMLElement>('main h1') ??
        document.querySelector<HTMLElement>('h1');
      const headingText = heading?.textContent?.replace(/\s+/g, ' ').trim();
      document.title = headingText ? `${headingText} | ${APPLICATION_NAME}` : APPLICATION_NAME;
    };

    updateTitle();
    const observer = new MutationObserver(updateTitle);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, [location.hash, location.key, location.pathname, location.search]);

  return null;
}

export default RouteTitleManager;
