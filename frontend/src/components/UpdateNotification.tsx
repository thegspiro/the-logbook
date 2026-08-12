/**
 * Update Notification Banner
 *
 * Displays a non-intrusive banner at the top of the page when a new
 * frontend deployment has been detected. Users can reload immediately
 * or defer the reminder for one hour.
 */

import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useAppUpdate } from '../hooks/useAppUpdate';

export const UpdateNotification: React.FC = () => {
  const { updateAvailable, applyUpdate, dismiss } = useAppUpdate();

  if (!updateAvailable) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      /* Below md the banner is pinned to the bottom of the viewport. In normal
         flow it sits at the top of the document, where the fixed mobile header
         (z-50, and later in the DOM) paints straight over it — so on a phone
         the update prompt was never visible. Bottom-pinning also keeps it clear
         of the hamburger menu, which a top overlay would block. */
      className="relative z-50 flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm text-white max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
    >
      <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>A new version of The Logbook is available.</span>
      <button
        onClick={applyUpdate}
        className="rounded-sm font-semibold underline underline-offset-2 transition-colors hover:text-blue-100 focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600 focus:outline-hidden"
      >
        Reload now
      </button>
      <button
        onClick={dismiss}
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-2.5 transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-white focus:outline-hidden"
        aria-label="Remind me about this update later"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};
