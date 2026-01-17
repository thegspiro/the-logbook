/**
 * Session Storage Utilities for Onboarding Module
 */

import { OnboardingData, EmailConfig, AdminUser } from '../types';

const STORAGE_KEYS = {
  DEPARTMENT_NAME: 'departmentName',
  HAS_LOGO: 'hasLogo',
  LOGO_DATA: 'logoData',
  NAVIGATION_LAYOUT: 'navigationLayout',
  EMAIL_PLATFORM: 'emailPlatform',
  EMAIL_CONFIG: 'emailConfig',
  EMAIL_CONFIG_METHOD: 'emailConfigMethod',
  ADMIN_USER: 'adminUser',
} as const;

/**
 * Get all onboarding data from session storage
 */
export const getOnboardingData = (): Partial<OnboardingData> => {
  const departmentName = sessionStorage.getItem(STORAGE_KEYS.DEPARTMENT_NAME);
  const hasLogo = sessionStorage.getItem(STORAGE_KEYS.HAS_LOGO) === 'true';
  const logoData = sessionStorage.getItem(STORAGE_KEYS.LOGO_DATA);
  const navigationLayout = sessionStorage.getItem(STORAGE_KEYS.NAVIGATION_LAYOUT) as 'top' | 'left' | null;
  const emailPlatform = sessionStorage.getItem(STORAGE_KEYS.EMAIL_PLATFORM) as OnboardingData['emailPlatform'];
  const emailConfigStr = sessionStorage.getItem(STORAGE_KEYS.EMAIL_CONFIG);
  const emailConfigMethod = sessionStorage.getItem(STORAGE_KEYS.EMAIL_CONFIG_METHOD) as 'oauth' | 'apppassword' | null;
  const adminUserStr = sessionStorage.getItem(STORAGE_KEYS.ADMIN_USER);

  return {
    departmentName: departmentName || '',
    hasLogo,
    logoData: logoData || undefined,
    navigationLayout,
    emailPlatform,
    emailConfig: emailConfigStr ? JSON.parse(emailConfigStr) : undefined,
    emailConfigMethod: emailConfigMethod || undefined,
    adminUser: adminUserStr ? JSON.parse(adminUserStr) : undefined,
  };
};

/**
 * Save department information
 */
export const saveDepartmentInfo = (name: string, logoData?: string) => {
  sessionStorage.setItem(STORAGE_KEYS.DEPARTMENT_NAME, name);
  sessionStorage.setItem(STORAGE_KEYS.HAS_LOGO, logoData ? 'true' : 'false');
  if (logoData) {
    sessionStorage.setItem(STORAGE_KEYS.LOGO_DATA, logoData);
  }
};

/**
 * Save navigation layout preference
 */
export const saveNavigationLayout = (layout: 'top' | 'left') => {
  sessionStorage.setItem(STORAGE_KEYS.NAVIGATION_LAYOUT, layout);
};

/**
 * Save email platform choice
 */
export const saveEmailPlatform = (platform: string) => {
  sessionStorage.setItem(STORAGE_KEYS.EMAIL_PLATFORM, platform);
};

/**
 * Save email configuration
 */
export const saveEmailConfig = (config: EmailConfig, method?: 'oauth' | 'apppassword') => {
  sessionStorage.setItem(STORAGE_KEYS.EMAIL_CONFIG, JSON.stringify(config));
  if (method) {
    sessionStorage.setItem(STORAGE_KEYS.EMAIL_CONFIG_METHOD, method);
  }
};

/**
 * Save admin user information
 */
export const saveAdminUser = (user: AdminUser) => {
  sessionStorage.setItem(STORAGE_KEYS.ADMIN_USER, JSON.stringify(user));
};

/**
 * Clear all onboarding data
 */
export const clearOnboardingData = () => {
  Object.values(STORAGE_KEYS).forEach((key) => {
    sessionStorage.removeItem(key);
  });
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
