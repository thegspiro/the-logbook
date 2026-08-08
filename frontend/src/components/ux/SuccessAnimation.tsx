/**
 * Success Animation Component (#82)
 *
 * Brief animated checkmark displayed after completing actions
 * like creating events, submitting forms, or completing check-ins.
 */

import React, { useEffect, useState } from 'react';

interface SuccessAnimationProps {
  show: boolean;
  message?: string;
  onComplete?: () => void;
  duration?: number;
}

export const SuccessAnimation: React.FC<SuccessAnimationProps> = ({
  show,
  message = 'Success!',
  onComplete,
  duration = 2000,
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, duration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [show, duration, onComplete]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-70 flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="bg-theme-surface-modal/95 border-theme-surface-border animate-success-pop rounded-2xl border p-8 shadow-2xl backdrop-blur-xs">
        {/* Animated checkmark circle */}
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
          <svg
            className="animate-success-check h-10 w-10 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
              className="animate-success-draw"
            />
          </svg>
        </div>
        <p className="text-theme-text-primary text-center font-medium">{message}</p>
      </div>
    </div>
  );
};
