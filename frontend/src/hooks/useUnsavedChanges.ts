/**
 * Unsaved Changes Warning Hook (#75)
 *
 * Warns users when navigating away from a form with unsaved changes.
 * Uses beforeunload for browser close/refresh protection.
 *
 * Note: useBlocker is intentionally avoided because the app uses
 * <BrowserRouter>, not createBrowserRouter/RouterProvider. useBlocker
 * requires a data router context and throws in legacy router setups.
 */

import { useEffect, useCallback } from 'react';

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
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = message;
      }
    },
    [hasChanges, message]
  );

  useEffect(() => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [handleBeforeUnload]);
}
