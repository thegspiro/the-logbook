/**
 * Tooltip Component (#63)
 *
 * Provides context for icon-only buttons and truncated text.
 * Shows on hover/focus with configurable placement.
 */

import React, { useState, useRef, useEffect, ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  delay = 300,
}) => {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoHideRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tooltipId = useRef(`tooltip-${Math.random().toString(36).slice(2, 9)}`);

  const clearTimers = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (autoHideRef.current) clearTimeout(autoHideRef.current);
  };

  const show = () => {
    if (autoHideRef.current) clearTimeout(autoHideRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    clearTimers();
    setVisible(false);
  };

  // Touch devices have no hover: reveal on tap (bypassing the hover delay) and
  // auto-dismiss shortly after, so the tooltip's content is reachable without
  // blocking the child's own tap handler.
  const handleTouch = () => {
    clearTimers();
    setVisible(true);
    autoHideRef.current = setTimeout(() => setVisible(false), 2000);
  };

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={handleTouch}
    >
      <div aria-describedby={visible ? tooltipId.current : undefined}>
        {children}
      </div>
      {visible && (
        <div
          id={tooltipId.current}
          role="tooltip"
          className={`absolute z-50 px-2.5 py-1.5 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded-md shadow-lg whitespace-nowrap pointer-events-none animate-scale-in ${positionClasses[position]}`}
        >
          {content}
          <span
            className={`absolute w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45 ${
              position === 'top' ? 'top-full left-1/2 -translate-x-1/2 -mt-1' :
              position === 'bottom' ? 'bottom-full left-1/2 -translate-x-1/2 -mb-1' :
              position === 'left' ? 'left-full top-1/2 -translate-y-1/2 -ml-1' :
              'right-full top-1/2 -translate-y-1/2 -mr-1'
            }`}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
};
