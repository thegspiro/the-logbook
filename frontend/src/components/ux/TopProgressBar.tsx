/**
 * Top Progress Bar Component (#88)
 *
 * NProgress-style thin progress bar at the top of the page
 * during route transitions and API calls.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router';

export const TopProgressBar: React.FC = () => {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const location = useLocation();

  const start = useCallback(() => {
    setProgress(0);
    setVisible(true);

    // Incrementally increase progress
    timerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 90;
        }
        // Slow down as we get closer
        const increment = prev < 50 ? 8 : prev < 80 ? 3 : 1;
        return Math.min(prev + increment, 90);
      });
    }, 100);
  }, []);

  const complete = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 300);
  }, []);

  // Trigger on route changes
  useEffect(() => {
    start();
    // Simulate completion after a brief delay (actual data loading finishes this)
    const timeout = setTimeout(complete, 400);
    return () => {
      clearTimeout(timeout);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [location.pathname, start, complete]);

  if (!visible && progress === 0) return null;

  return (
    <div
      /* box-content so safe-top's padding sits above the bar rather than
         eating its 2px height — otherwise the bar vanishes on notched
         devices in standalone mode, where it would render under the
         status bar and give no loading feedback at all. */
      className="safe-top pointer-events-none fixed top-0 right-0 left-0 z-60 box-content h-0.5 bg-transparent"
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-red-500 transition-all duration-200 ease-out"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)',
        }}
      />
    </div>
  );
};
