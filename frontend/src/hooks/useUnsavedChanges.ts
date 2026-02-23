/**
 * Unsaved Changes Warning Hook (#75)
 *
 * Warns users when navigating away from a form with unsaved changes.
 * Handles both browser navigation (beforeunload) and React Router navigation.
 */

import { useEffect, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';

interface UseUnsavedChangesOptions {
  /** Whether there are unsaved changes */
  hasChanges: boolean;
  /** Custom warning message */
  message?: string;
}

export function useUnsavedChanges({
  hasChanges,
  message = 'You have unsaved changes. Are you sure you want to leave?',
}: UseUnsavedChangesOptions): void {
  // Handle browser navigation (closing tab, external URL)
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        // Modern browsers show a generic message instead of custom text
        e.returnValue = message;
      }
    },
    [hasChanges, message]
  );

  useEffect(() => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [handleBeforeUnload]);

  // Handle React Router navigation
  useBlocker(
    useCallback(
      () => {
        if (hasChanges) {
          return !window.confirm(message);
        }
        return false;
      },
      [hasChanges, message]
    )
  );
}
