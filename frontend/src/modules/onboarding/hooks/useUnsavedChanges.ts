/**
 * Hook to warn users before leaving a page with unsaved changes
 */

import { useEffect, useRef, useCallback } from 'react';
import { useBeforeUnload, useBlocker, type Location } from 'react-router-dom';

interface UseUnsavedChangesOptions {
  hasUnsavedChanges: boolean;
  message?: string;
}

/**
 * Warns users before leaving the page or navigating away with unsaved changes
 *
 * @param hasUnsavedChanges - Boolean indicating if there are unsaved changes
 * @param message - Custom warning message (optional)
 *
 * @example
 * ```tsx
 * const [formData, setFormData] = useState(initialData);
 * const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialData);
 *
 * useUnsavedChanges({ hasUnsavedChanges: hasChanges });
 * ```
 */
export function useUnsavedChanges({
  hasUnsavedChanges,
  message = 'You have unsaved changes. Are you sure you want to leave?'
}: UseUnsavedChangesOptions) {

  // Warn before browser refresh/close
  useBeforeUnload(
    useCallback(
      (event) => {
        if (hasUnsavedChanges) {
          event.preventDefault();
          // Modern browsers ignore custom messages and show their own
          return message;
        }
        return undefined;
      },
      [hasUnsavedChanges, message]
    ),
    { capture: true }
  );

  // Block navigation within the app
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }, nextLocation: { pathname: string } }) => {
        // Only block if:
        // 1. There are unsaved changes
        // 2. Not navigating to the same page
        // 3. User confirms they want to leave
        return (
          hasUnsavedChanges &&
          currentLocation.pathname !== nextLocation.pathname
        );
      },
      [hasUnsavedChanges]
    )
  );

  // Handle blocked navigation
  useEffect(() => {
    if (blocker.state === 'blocked') {
      const shouldLeave = window.confirm(message);

      if (shouldLeave) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker, message]);

  return {
    isBlocked: blocker.state === 'blocked',
    blocker
  };
}

/**
 * Hook to track if form data has changed from initial values
 *
 * @param currentData - Current form data
 * @param initialData - Initial form data to compare against
 * @returns Boolean indicating if data has changed
 *
 * @example
 * ```tsx
 * const [formData, setFormData] = useState(initialData);
 * const hasChanges = useFormChanged(formData, initialData);
 *
 * useUnsavedChanges({ hasUnsavedChanges: hasChanges });
 * ```
 */
export function useFormChanged<T>(currentData: T, initialData: T): boolean {
  const initialDataRef = useRef(initialData);

  // Update ref if initial data changes (e.g., loaded from API)
  useEffect(() => {
    initialDataRef.current = initialData;
  }, [initialData]);

  // Deep comparison using JSON.stringify
  // Note: This won't work for functions, symbols, or circular references
  try {
    return JSON.stringify(currentData) !== JSON.stringify(initialDataRef.current);
  } catch {
    // Fallback to reference comparison if stringification fails
    return currentData !== initialDataRef.current;
  }
}
