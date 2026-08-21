/**
 * Page Transition Component (#44)
 *
 * Wraps page content with a subtle fade-in animation
 * when navigating between routes.
 */

import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

interface PageTransitionProps {
  children: ReactNode;
}

// How long to keep watching for a page heading before announcing the generic
// fallback. Long enough for a data fetch behind a skeleton, short enough that
// a screen-reader user on a genuinely heading-less page still hears something.
const HEADING_WATCH_TIMEOUT_MS = 5000;

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const location = useLocation();
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const [transitioning, setTransitioning] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  // The path whose announcement is settled — either a real heading was read
  // out or the fallback fired after the watch window closed. Nothing announces
  // twice for the same navigation.
  const announcedPath = useRef<string | null>(null);
  // The path currently being watched for a late heading, with a fixed deadline
  // so re-renders (which tear down and rebuild the observer below) cannot keep
  // pushing the fallback further away.
  const watchingPath = useRef<string | null>(null);
  const watchDeadline = useRef(0);
  // The path this effect last ran for, so a re-render (the effect also depends
  // on children) is told apart from an actual navigation.
  const lastPath = useRef<string | null>(null);

  // Public routes render outside this component. Clear any heading-derived
  // title when the protected application layout unmounts so record details do
  // not remain visible in the browser tab after logout or session expiry.
  useEffect(
    () => () => {
      document.title = APPLICATION_NAME;
    },
    []
  );

  useEffect(() => {
    setTransitioning(true);
    setDisplayedChildren(children);

    // Every navigation gets its own announcement, including a return to a page
    // whose watch was abandoned when the user left it mid-load — otherwise the
    // settled-path guard below would suppress it and leave the region empty.
    if (lastPath.current !== location.pathname) {
      lastPath.current = location.pathname;
      announcedPath.current = null;
    }

    let observer: MutationObserver | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // Reset the transition after a frame to trigger the animation
    const frame = requestAnimationFrame(() => {
      setTransitioning(false);
      if (announcedPath.current === location.pathname) return;

      const settle = (text: string) => {
        announcedPath.current = location.pathname;
        watchingPath.current = null;
        observer?.disconnect();
        observer = null;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        setAnnouncement(text);
      };

      const readHeading = () => contentRef.current?.querySelector('h1')?.textContent?.trim() ?? '';

      const heading = readHeading();
      if (heading) {
        settle(heading);
        return;
      }

      // No heading yet — the page is likely showing a spinner or skeleton and
      // the h1 arrives with its data, which happens inside the children without
      // this component re-rendering. Watch the subtree until it appears, and
      // only announce the uninformative fallback once the deadline passes.
      if (watchingPath.current !== location.pathname) {
        watchingPath.current = location.pathname;
        watchDeadline.current = Date.now() + HEADING_WATCH_TIMEOUT_MS;
        // Clear the previous page's heading for the duration of the watch.
        // Assistive tech that queries this region rather than waiting for the
        // live announcement reads whatever it holds, and holding the old
        // heading told it a page the user has already left is the current one
        // — for up to the full watch window. Empty is honest; the settle below
        // fills it in with the late heading or the fallback, so this is still
        // one announcement per navigation and not the permanent silence the
        // watcher was added to fix.
        setAnnouncement('');
      }
      if (contentRef.current) {
        observer = new MutationObserver(() => {
          const found = readHeading();
          if (found) settle(found);
        });
        observer.observe(contentRef.current, { childList: true, subtree: true, characterData: true });
      }
      fallbackTimer = setTimeout(() => settle('Page loaded'), Math.max(0, watchDeadline.current - Date.now()));
    });

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [location.pathname, children]);

  return (
    <>
      <div
        ref={contentRef}
        data-page-layout="application"
        className={`transition-opacity duration-150 ease-in-out ${transitioning ? 'opacity-0' : 'opacity-100'}`}
      >
        {displayedChildren}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
};
