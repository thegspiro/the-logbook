/**
 * useApiRequest Hook
 *
 * Provides double-click protection and request cancellation
 * Implements Option C: Disable button immediately + AbortController
 */

import { useState, useRef, useCallback } from 'react';
import { useOnboardingStore } from '../store';

export interface ApiRequestOptions {
  /**
   * Step name for error logging
   */
  step: string;

  /**
   * Action description for error logging
   */
  action: string;

  /**
   * User context for better error debugging
   */
  userContext?: string;

  /**
   * Callback after successful completion
   */
  onSuccess?: () => void;

  /**
   * Callback after error (can be used for custom error handling)
   */
  onError?: (error: unknown) => void;
}

export const useApiRequest = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const logError = useOnboardingStore((state) => state.logError);

  /**
   * Execute an API request with protection against double-clicks
   * and ability to cancel ongoing requests
   */
  const execute = useCallback(
    async <T,>(
      apiCall: (signal: AbortSignal) => Promise<T>,
      options: ApiRequestOptions
    ): Promise<{ data: T | null; error: string | null }> => {
      // Prevent double-click: if already loading, ignore
      if (isLoading) {
        console.warn('Request already in progress, ignoring duplicate click');
        return { data: null, error: 'Request already in progress' };
      }

      // Cancel any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Set loading immediately (before state update)
      setIsLoading(true);
      setError(null);
      setCanRetry(false);

      try {
        // Execute the API call with abort signal
        const result = await apiCall(abortController.signal);

        // Success
        setIsLoading(false);
        setCanRetry(false);

        if (options.onSuccess) {
          options.onSuccess();
        }

        return { data: result, error: null };
      } catch (err: unknown) {
        // Handle abort (not an error, just cancelled)
        if (err instanceof DOMException && err.name === 'AbortError') {
          setIsLoading(false);
          return { data: null, error: 'Request cancelled' };
        }

        // Handle actual errors
        const isError = err instanceof Error;
        const errorMessage = isError ? err.message : 'An unexpected error occurred';

        // Extract response details if available (e.g., from Axios errors)
        const response = typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: unknown; status?: number } }).response
          : undefined;

        setIsLoading(false);
        setError(errorMessage);
        setCanRetry(true);

        // Log error to store with detailed context
        logError({
          step: options.step,
          action: options.action,
          errorMessage,
          errorDetails: {
            name: isError ? err.name : undefined,
            stack: isError ? err.stack : undefined,
            response: response?.data,
            status: response?.status,
          },
          userContext: options.userContext,
        });

        if (options.onError) {
          options.onError(err);
        }

        return { data: null, error: errorMessage };
      } finally {
        // Clean up abort controller
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [isLoading, logError]
  );

  /**
   * Cancel the ongoing request
   */
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setCanRetry(false);
    }
  }, []);

  /**
   * Clear error state (for retry)
   */
  const clearError = useCallback(() => {
    setError(null);
    setCanRetry(false);
  }, []);

  return {
    execute,
    cancel,
    clearError,
    isLoading,
    error,
    canRetry,
  };
};
