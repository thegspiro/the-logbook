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

  useEffect(() => {
    setTransitioning(true);
    setDisplayedChildren(children);

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
