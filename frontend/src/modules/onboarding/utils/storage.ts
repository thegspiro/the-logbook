/**
 * Session Storage Utilities for Onboarding Module
 *
 * SECURITY NOTICE:
 * - Only NON-SENSITIVE data should be stored in sessionStorage
 * - Sensitive data (passwords, API keys, secrets) must NEVER be stored client-side
 * - All sensitive configuration is sent directly to the backend and not persisted locally
 */

import { OnboardingData, EmailConfig } from '../types';

/**
 * Storage keys for non-sensitive UI state only
 */
const STORAGE_KEYS = {
  // Safe to store - UI preferences and display data
  DEPARTMENT_NAME: 'departmentName',
  HAS_LOGO: 'hasLogo',
  LOGO_DATA: 'logoData',
  NAVIGATION_LAYOUT: 'navigationLayout',
  EMAIL_PLATFORM: 'emailPlatform', // Platform name only, no credentials
  EMAIL_CONFIG_METHOD: 'emailConfigMethod', // Method type only
  FILE_STORAGE_PLATFORM: 'fileStoragePlatform', // Platform name only
  AUTHENTICATION_PLATFORM: 'authenticationPlatform', // Platform name only

  // Track completion state (no sensitive data)
  EMAIL_CONFIGURED: 'emailConfigured',
  FILE_STORAGE_CONFIGURED: 'fileStorageConfigured',
  AUTH_CONFIGURED: 'authConfigured',
  IT_TEAM_CONFIGURED: 'itTeamConfigured',
  ADMIN_CREATED: 'adminCreated',
} as const;

/**
 * DEPRECATED KEYS - These should NOT be used
 * Kept for cleanup purposes only
 */
const DEPRECATED_SENSITIVE_KEYS = [
  'emailConfig',      // Contains SMTP passwords
  'fileStorageConfig', // Contains API keys
  'authenticationConfig', // Contains OAuth secrets
  'adminUser',        // Contains password
  'itTeamInfo',       // Contains contact PII
] as const;

/**
 * Get all onboarding data from session storage
 * NOTE: Only returns non-sensitive UI state
 */
export const getOnboardingData = (): Partial<OnboardingData> => {
  const departmentName = sessionStorage.getItem(STORAGE_KEYS.DEPARTMENT_NAME);
  const hasLogo = sessionStorage.getItem(STORAGE_KEYS.HAS_LOGO) === 'true';
  const logoData = sessionStorage.getItem(STORAGE_KEYS.LOGO_DATA);
  const navigationLayout = localStorage.getItem(STORAGE_KEYS.NAVIGATION_LAYOUT) as 'top' | 'left' | null;
  const emailPlatform = sessionStorage.getItem(STORAGE_KEYS.EMAIL_PLATFORM) as OnboardingData['emailPlatform'];
  const emailConfigMethod = sessionStorage.getItem(STORAGE_KEYS.EMAIL_CONFIG_METHOD) as 'oauth' | 'apppassword' | null;
  const fileStoragePlatform = sessionStorage.getItem(STORAGE_KEYS.FILE_STORAGE_PLATFORM) as OnboardingData['fileStoragePlatform'];
  const authenticationPlatform = sessionStorage.getItem(STORAGE_KEYS.AUTHENTICATION_PLATFORM) as OnboardingData['authenticationPlatform'];

  return {
    departmentName: departmentName || '',
    hasLogo,
    logoData: logoData ?? undefined,
    navigationLayout,
    emailPlatform,
    emailConfigMethod: emailConfigMethod ?? undefined,
    fileStoragePlatform,
    authenticationPlatform,
    // Sensitive data is NOT returned - fetch from backend if needed
    emailConfig: undefined,
    fileStorageConfig: undefined,
    authenticationConfig: undefined,
    itTeamInfo: undefined,
    adminUser: undefined,
  };
};

/**
 * Save department information (non-sensitive)
 */
export const saveDepartmentInfo = (name: string, logoData?: string) => {
  sessionStorage.setItem(STORAGE_KEYS.DEPARTMENT_NAME, name);
  sessionStorage.setItem(STORAGE_KEYS.HAS_LOGO, logoData ? 'true' : 'false');
  if (logoData) {
    sessionStorage.setItem(STORAGE_KEYS.LOGO_DATA, logoData);
  }
};


/**
 * Mark email as configured (no credentials stored)
 *
 * SECURITY: Email credentials are sent directly to backend.
 * Only the configuration status is stored locally.
 */
export const saveEmailConfig = (config: EmailConfig, method?: 'oauth' | 'apppassword') => {
  // SECURITY: Do NOT store the actual config with credentials
  // Only store the method type and mark as configured
  if (method) {
    sessionStorage.setItem(STORAGE_KEYS.EMAIL_CONFIG_METHOD, method);
  }
  sessionStorage.setItem(STORAGE_KEYS.EMAIL_CONFIGURED, 'true');

  // Log security warning if config contains sensitive data
  if (config && (config.smtpPassword || config.googleClientSecret || config.microsoftClientSecret)) {
    console.warn(
      'SECURITY: Email credentials should be sent directly to the backend API, ' +
      'not stored in browser storage. The credentials have been excluded from local storage.'
    );
  }
};


/**
 * Mark file storage as configured (no API keys stored)
 *
 * SECURITY: File storage API keys are sent directly to backend.
 * Only the configuration status is stored locally.
 */
export const saveFileStorageConfig = (_config: Record<string, unknown>) => {
  // SECURITY: Do NOT store the actual config with API keys
  // Only mark as configured
  sessionStorage.setItem(STORAGE_KEYS.FILE_STORAGE_CONFIGURED, 'true');

  console.warn(
    'SECURITY: File storage credentials should be sent directly to the backend API. ' +
    'The configuration has been excluded from local storage.'
  );
};


/**
 * Remove any legacy sensitive data that may have been stored
 * SEC: Runs automatically on module load — does not just warn,
 * actively removes deprecated keys containing secrets/PII.
 */
export const clearLegacySensitiveData = () => {
  DEPRECATED_SENSITIVE_KEYS.forEach((key) => {
    sessionStorage.removeItem(key);
  });
  // Also clean up legacy localStorage CSRF token from pre-cookie migration
  localStorage.removeItem('csrf_token');
};

// SEC: Proactively clear deprecated sensitive keys on module load
clearLegacySensitiveData();

/**
 * Get department name
 */
export const getDepartmentName = (): string | null => {
  return sessionStorage.getItem(STORAGE_KEYS.DEPARTMENT_NAME);
};

/**
 * Get logo data
 */
export const getLogoData = (): string | null => {
  return sessionStorage.getItem(STORAGE_KEYS.LOGO_DATA);
};


