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

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const location = useLocation();
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const [transitioning, setTransitioning] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const lastAnnouncedPath = useRef<string | null>(null);

  useEffect(() => {
    setTransitioning(true);
    setDisplayedChildren(children);
    // Reset the transition after a frame to trigger the animation
    const timer = requestAnimationFrame(() => {
      setTransitioning(false);
      if (lastAnnouncedPath.current !== location.pathname) {
        const heading = contentRef.current?.querySelector('h1');
        setAnnouncement(heading?.textContent?.trim() || 'Page loaded');
        lastAnnouncedPath.current = location.pathname;
      }
    });
    return () => cancelAnimationFrame(timer);
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
