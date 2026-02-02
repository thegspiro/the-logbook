/**
 * Onboarding Session Hook
 *
 * Manages server-side onboarding session
 * SECURITY: Initializes session on start, clears on completion
 */

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../services/api-client';

interface OrganizationData {
  name: string;
  slug?: string;
  description?: string;
  organization_type: 'fire_department' | 'ems_only' | 'fire_ems_combined';
  timezone: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  mailing_address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip_code: string;
    country?: string;
  };
  physical_address_same: boolean;
  physical_address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip_code: string;
    country?: string;
  };
  identifier_type: 'fdid' | 'state_id' | 'department_id';
  fdid?: string;
  state_id?: string;
  department_id?: string;
  county?: string;
  founded_year?: number;
  tax_id?: string;
  logo?: string;
}

interface UseOnboardingSessionReturn {
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
  initializeSession: () => Promise<boolean>;
  clearSession: () => void;
  hasSession: boolean;
  saveOrganization: (data: OrganizationData) => Promise<void>;
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

  /**
   * Save organization data (comprehensive setup)
   * Creates the organization in the database during Step 1 of onboarding
   */
  const saveOrganization = useCallback(async (data: OrganizationData): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.saveOrganization(data);

      if (response.error) {
        setError(response.error);
        setIsLoading(false);
        throw new Error(response.error);
      }

      setIsLoading(false);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save organization';
      setError(errorMessage);
      setIsLoading(false);
      throw new Error(errorMessage);
    }
  }, []);

  return {
    sessionId,
    isLoading,
    error,
    initializeSession,
    clearSession,
    hasSession: apiClient.hasSession(),
    saveOrganization,
  };
};
