/**
 * Update Notification Banner
 *
 * Displays a non-intrusive banner at the top of the page when a new
 * frontend deployment has been detected. Users can reload immediately
 * or defer the reminder for one hour.
 *
 * When automatic recovery has run out of remedies (`updateBlocked`) the banner
 * stops offering a reload and points at Force refresh instead. Repeating an
 * action that has already failed twice on this device wastes the member's time
 * and, worse, reads as though the app is trying — the whole reason the old
 * behaviour ended with people clearing their browser cache by hand.
 */

import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Link } from 'react-router';
import { useAppUpdate } from '../hooks/useAppUpdate';

export const UpdateNotification: React.FC = () => {
  const { updateAvailable, updateBlocked, applyUpdate, dismiss } = useAppUpdate();

  if (!updateAvailable) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      /* Below md the banner is pinned to the bottom of the viewport. In normal
         flow it sits at the top of the document, where the fixed mobile header
         (z-50, and later in the DOM) paints straight over it — so on a phone
         the update prompt was never visible. Bottom-pinning also keeps it clear
         of the hamburger menu, which a top overlay would block.

         It stacks ABOVE the bottom navigation rather than at bottom-0, which
         put it under the bar: both are z-50 and the bar renders later, so the
         bar won and swallowed "Reload now". Include the safe-area inset as well
         because the navigation extends into it on notched devices. */
      className="relative z-50 flex items-center justify-center gap-3 bg-blue-600 px-4 py-2 text-sm text-white max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(var(--bottom-nav-height,0px)+env(safe-area-inset-bottom))]"
    >
      <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
      {updateBlocked ? (
        <>
          <span>A new version is available, but this device could not install it automatically.</span>
          <Link
            to="/account?tab=app"
            className="rounded-sm font-semibold underline underline-offset-2 transition-colors hover:text-blue-100 focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600 focus:outline-hidden"
          >
            Force refresh
          </Link>
        </>
      ) : (
        <>
          <span>A new version of The Logbook is available.</span>
          <button
            onClick={applyUpdate}
            className="rounded-sm font-semibold underline underline-offset-2 transition-colors hover:text-blue-100 focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600 focus:outline-hidden"
          >
            Reload now
          </button>
        </>
      )}
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
