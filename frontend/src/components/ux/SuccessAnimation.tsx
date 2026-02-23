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
    <div className="fixed inset-0 z-[70] flex items-center justify-center pointer-events-none">
      <div className="bg-theme-surface-modal/95 backdrop-blur-sm rounded-2xl p-8 shadow-2xl border border-theme-surface-border animate-success-pop">
        {/* Animated checkmark circle */}
        <div className="mx-auto w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-3">
          <svg
            className="w-10 h-10 text-green-500 animate-success-check"
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
        <p className="text-center text-theme-text-primary font-medium">{message}</p>
      </div>
    </div>
  );
};
