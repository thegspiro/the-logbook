/**
 * Onboarding Module Types
 */

export interface OnboardingData {
  // Department Information
  departmentName: string;
  hasLogo: boolean;
  logoData?: string;

  // Navigation Layout
  navigationLayout: 'top' | 'left' | null;

  // Email Configuration
  emailPlatform: 'gmail' | 'microsoft' | 'selfhosted' | 'other' | null;
  emailConfig?: EmailConfig;
  emailConfigMethod?: 'oauth' | 'apppassword';

  // Admin User
  adminUser?: AdminUser;
}

export interface EmailConfig {
  // Gmail OAuth
  googleClientId?: string;
  googleClientSecret?: string;
  googleAppPassword?: string;
  googleEmail?: string;

  // Microsoft 365
  microsoftTenantId?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;

  // Self-hosted SMTP
  smtpHost?: string;
  smtpPort?: number;
  smtpEncryption?: 'tls' | 'ssl' | 'none';
  smtpUsername?: string;
  smtpPassword?: string;

  // Common fields
  fromEmail: string;
  fromName?: string;
}

export interface AdminUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  badgeNumber?: string;
  password: string;
  confirmPassword: string;
}

export interface OnboardingStatus {
  isCompleted: boolean;
  currentStep: number;
  stepsCompleted: Record<string, boolean>;
}

export type OnboardingStep =
  | 'welcome'
  | 'department-info'
  | 'navigation-choice'
  | 'email-platform'
  | 'email-config'
  | 'admin-user'
  | 'security-check'
  | 'complete';

export interface PasswordStrength {
  checks: {
    length: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    special: boolean;
  };
  passedChecks: number;
}
