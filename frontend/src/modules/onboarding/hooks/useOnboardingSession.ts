/**
 * Onboarding Session Hook
 *
 * Manages server-side onboarding session
 * SECURITY: Initializes session on start, clears on completion
 */

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../services/api-client';

interface UseOnboardingSessionReturn {
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
  initializeSession: () => Promise<boolean>;
  clearSession: () => void;
  hasSession: boolean;
}

export const useOnboardingSession = (): UseOnboardingSessionReturn => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing session on mount
  useEffect(() => {
    const existingSession = apiClient.getSessionId();
    if (existingSession) {
      setSessionId(existingSession);
    }
  }, []);

  /**
   * Initialize a new onboarding session
   */
  const initializeSession = useCallback(async (): Promise<boolean> => {
    // Don't create duplicate sessions
    if (apiClient.hasSession()) {
      return true;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.startSession();

      if (response.error) {
        setError(response.error);
        setIsLoading(false);
        return false;
      }

      if (response.data) {
        setSessionId(response.data.session_id);
        setIsLoading(false);
        return true;
      }

      setError('Failed to start session');
      setIsLoading(false);
      return false;
    } catch (err: any) {
      setError(err.message || 'Failed to initialize session');
      setIsLoading(false);
      return false;
    }
  }, []);

  /**
   * Clear the onboarding session
   */
  const clearSession = useCallback(() => {
    apiClient.clearSession();
    setSessionId(null);
    setError(null);
  }, []);

  return {
    sessionId,
    isLoading,
    error,
    initializeSession,
    clearSession,
    hasSession: apiClient.hasSession(),
  };
};
