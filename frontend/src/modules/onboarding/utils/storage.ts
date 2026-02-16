/**
 * Session Storage Utilities for Onboarding Module
 *
 * SECURITY NOTICE:
 * - Only NON-SENSITIVE data should be stored in sessionStorage
 * - Sensitive data (passwords, API keys, secrets) must NEVER be stored client-side
 * - All sensitive configuration is sent directly to the backend and not persisted locally
 */

import { OnboardingData, EmailConfig, AdminUser } from '../types';

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
    logoData: logoData || undefined,
    navigationLayout,
    emailPlatform,
    emailConfigMethod: emailConfigMethod || undefined,
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
 * Save navigation layout preference (non-sensitive)
 */
export const saveNavigationLayout = (layout: 'top' | 'left') => {
  localStorage.setItem(STORAGE_KEYS.NAVIGATION_LAYOUT, layout);
};

/**
 * Save email platform choice (platform name only, no credentials)
 */
export const saveEmailPlatform = (platform: string) => {
  sessionStorage.setItem(STORAGE_KEYS.EMAIL_PLATFORM, platform);
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
 * Save file storage platform choice (platform name only)
 */
export const saveFileStorage = (platform: string) => {
  sessionStorage.setItem(STORAGE_KEYS.FILE_STORAGE_PLATFORM, platform);
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
 * Save authentication platform choice (platform name only)
 */
export const saveAuthenticationPlatform = (platform: string) => {
  sessionStorage.setItem(STORAGE_KEYS.AUTHENTICATION_PLATFORM, platform);
};

/**
 * Mark authentication as configured (no secrets stored)
 *
 * SECURITY: OAuth secrets are sent directly to backend.
 * Only the configuration status is stored locally.
 */
export const saveAuthenticationConfig = (_config: Record<string, unknown>) => {
  // SECURITY: Do NOT store the actual config with OAuth secrets
  // Only mark as configured
  sessionStorage.setItem(STORAGE_KEYS.AUTH_CONFIGURED, 'true');

  console.warn(
    'SECURITY: Authentication secrets should be sent directly to the backend API. ' +
    'The configuration has been excluded from local storage.'
  );
};

/**
 * Mark IT team as configured (no PII stored)
 *
 * SECURITY: IT team contact info is sent directly to backend.
 * Only the configuration status is stored locally.
 */
export const saveITTeamInfo = (_info: Record<string, unknown>) => {
  // SECURITY: Do NOT store personal contact information
  // Only mark as configured
  sessionStorage.setItem(STORAGE_KEYS.IT_TEAM_CONFIGURED, 'true');

  console.warn(
    'SECURITY: IT team contact information should be sent directly to the backend API. ' +
    'The information has been excluded from local storage.'
  );
};

/**
 * Mark admin user as created (no password stored)
 *
 * SECURITY: Admin credentials are sent directly to backend.
 * Only the creation status is stored locally.
 */
export const saveAdminUser = (_user: AdminUser) => {
  // SECURITY: Do NOT store user credentials (especially password)
  // Only mark as created
  sessionStorage.setItem(STORAGE_KEYS.ADMIN_CREATED, 'true');

  console.warn(
    'SECURITY: Admin credentials should be sent directly to the backend API. ' +
    'The credentials have been excluded from local storage.'
  );
};

/**
 * Clear all onboarding data including any legacy sensitive data
 */
export const clearOnboardingData = () => {
  // Clear current keys
  Object.values(STORAGE_KEYS).forEach((key) => {
    sessionStorage.removeItem(key);
  });

  // Also clear any deprecated sensitive keys that might exist
  DEPRECATED_SENSITIVE_KEYS.forEach((key) => {
    sessionStorage.removeItem(key);
  });
};

/**
 * Remove any legacy sensitive data that may have been stored
 * Call this on app initialization for security
 */
export const clearLegacySensitiveData = () => {
  let cleared = false;
  DEPRECATED_SENSITIVE_KEYS.forEach((key) => {
    if (sessionStorage.getItem(key)) {
      sessionStorage.removeItem(key);
      cleared = true;
    }
  });

  if (cleared) {
    console.info('SECURITY: Cleared legacy sensitive data from session storage');
  }
};

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

/**
 * Check if onboarding has required data
 */
export const hasRequiredOnboardingData = (): boolean => {
  const departmentName = getDepartmentName();
  return !!departmentName;
};

/**
 * Check configuration status (without exposing actual config)
 */
export const getConfigurationStatus = () => {
  return {
    emailConfigured: sessionStorage.getItem(STORAGE_KEYS.EMAIL_CONFIGURED) === 'true',
    fileStorageConfigured: sessionStorage.getItem(STORAGE_KEYS.FILE_STORAGE_CONFIGURED) === 'true',
    authConfigured: sessionStorage.getItem(STORAGE_KEYS.AUTH_CONFIGURED) === 'true',
    itTeamConfigured: sessionStorage.getItem(STORAGE_KEYS.IT_TEAM_CONFIGURED) === 'true',
    adminCreated: sessionStorage.getItem(STORAGE_KEYS.ADMIN_CREATED) === 'true',
  };
};
