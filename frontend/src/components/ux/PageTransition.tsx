/**
 * Page Transition Component (#44)
 *
 * Wraps page content with a subtle fade-in animation
 * when navigating between routes.
 */

import React, { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

interface PageTransitionProps {
  children: ReactNode;
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const location = useLocation();
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    setTransitioning(true);
    setDisplayedChildren(children);
    // Reset the transition after a frame to trigger the animation
    const timer = requestAnimationFrame(() => {
      setTransitioning(false);
    });
    return () => cancelAnimationFrame(timer);
  }, [location.pathname, children]);

  return (
    <div
      className={`transition-opacity duration-150 ease-in-out ${
        transitioning ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {displayedChildren}
    </div>
  );
};
