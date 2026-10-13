/**
 * Tooltip Component (#63)
 *
 * Provides context for icon-only buttons and truncated text.
 * Shows on hover/focus with configurable placement.
 */

import React, { useState, useRef, useEffect, ReactNode, cloneElement, isValidElement, useId } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top', delay = 300 }) => {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoHideRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tooltipId = useId();

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

  // WCAG 1.4.13: content that appears on hover or focus must be dismissable
  // without moving either, so a keyboard user can clear it off what it covers.
  useEffect(() => {
    if (!visible) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (autoHideRef.current) clearTimeout(autoHideRef.current);
      setVisible(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible]);

  // The description belongs on the control itself: on a wrapper <div> it was
  // never read, because focus lands on the child and the wrapper has no role.
  const describedChild = isValidElement<{ 'aria-describedby'?: string | undefined }>(children)
    ? cloneElement(children, {
        'aria-describedby':
          [children.props['aria-describedby'], visible ? tooltipId : undefined].filter(Boolean).join(' ') || undefined,
      })
    : children;

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
      {describedChild}
      {visible && (
        // Hoverable (1.4.13): the pointer can move onto it without it closing,
        // because it is inside the hover wrapper. The `before:` pad bridges the
        // gap between control and tooltip so crossing it is not a mouse-leave.
        <div
          id={tooltipId}
          role="tooltip"
          className={`animate-scale-in absolute z-50 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-lg before:absolute before:-inset-2 before:content-[''] dark:bg-gray-700 ${positionClasses[position]}`}
        >
          {content}
          <span
            className={`absolute h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-700 ${
              position === 'top'
                ? 'top-full left-1/2 -mt-1 -translate-x-1/2'
                : position === 'bottom'
                  ? 'bottom-full left-1/2 -mb-1 -translate-x-1/2'
                  : position === 'left'
                    ? 'top-1/2 left-full -ml-1 -translate-y-1/2'
                    : 'top-1/2 right-full -mr-1 -translate-y-1/2'
            }`}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
};
