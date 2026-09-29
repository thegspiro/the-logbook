/**
 * Validation Utilities for Onboarding Module
 * Enhanced with security improvements
 */

import { PasswordStrength } from '../types';
import { MAX_AVATAR_SIZE } from '../../../constants/config';
import { isValidEmailSecure, isValidPhone } from './security';

/**
 * Check password strength
 */
export const checkPasswordStrength = (password: string): PasswordStrength => {
  const checks = {
    length: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    // eslint-disable-next-line no-useless-escape
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  const passedChecks = Object.values(checks).filter(Boolean).length;
  return { checks, passedChecks };
};

/**
 * Validate email format (secure version)
 */
export const isValidEmail = (email: string): boolean => {
  return isValidEmailSecure(email);
};

/**
 * Validate image file
 *
 * SECURITY NOTES:
 * - SVG files are NOT allowed as they can contain XSS payloads
 * - This validation checks MIME type and extension but NOT file magic numbers
 * - Client-side validation can be bypassed - ALWAYS validate on server
 * - Backend MUST verify actual file content using magic numbers
 * - Users can rename malicious files with valid extensions to bypass this check
 *
 * RECOMMENDATION: Implement server-side validation using libraries like:
 * - Python: python-magic, filetype
 * - Node.js: file-type, mmmagic
 */
export const isValidImageFile = (file: File): { valid: boolean; error?: string; warning?: string } => {
  // SECURITY: Removed SVG from allowed types due to XSS risk
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  const maxSize = MAX_AVATAR_SIZE;
  const recommendedMaxSize = 2 * 1024 * 1024; // 2MB recommended

  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Upload a PNG, JPG, or WebP image',
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'The logo must be smaller than 5MB',
    };
  }

  // Additional check: verify file extension matches MIME type
  const extension = file.name.split('.').pop()?.toLowerCase();
  const validExtensions = ['png', 'jpg', 'jpeg', 'webp'];

  if (!extension || !validExtensions.includes(extension)) {
    return {
      valid: false,
      error: 'The file name must end in .png, .jpg, .jpeg, or .webp',
    };
  }

  // Warn about large files (performance impact)
  if (file.size > recommendedMaxSize) {
    return {
      valid: true,
      warning: 'This image is large. A smaller one will load faster.',
    };
  }

  return { valid: true };
};

/**
 * Validate port number
 */
export const isValidPort = (port: number): boolean => {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
};

/**
 * Validate phone number
 */
export const isValidPhoneNumber = (phone: string): boolean => {
  return isValidPhone(phone);
};
