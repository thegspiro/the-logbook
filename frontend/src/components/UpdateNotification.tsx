/**
 * Update Notification Banner
 *
 * Displays a non-intrusive banner at the top of the page when a new
 * frontend deployment has been detected. Users can reload immediately
 * or dismiss the banner.
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
      className="bg-blue-600 text-white px-4 py-2 flex items-center justify-center gap-3 text-sm relative z-50"
    >
      <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>A new version of The Logbook is available.</span>
      <button
        onClick={applyUpdate}
        className="font-semibold underline underline-offset-2 hover:text-blue-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600 rounded-sm"
      >
        Reload now
      </button>
      <button
        onClick={dismiss}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-sm hover:bg-blue-700 transition-colors focus:outline-hidden focus:ring-2 focus:ring-white"
        aria-label="Dismiss update notification"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
