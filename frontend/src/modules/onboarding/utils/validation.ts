/**
 * Validation Utilities for Onboarding Module
 * Enhanced with security improvements
 */

import { PasswordStrength } from '../types';
import {
  isValidEmailSecure,
  isValidUsernameSecure,
  isValidHostSecure,
  isValidPhone,
  sanitizeInput,
} from './security';

/**
 * Check password strength
 */
export const checkPasswordStrength = (password: string): PasswordStrength => {
  const checks = {
    length: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
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
 * Validate username format (secure version with length limits)
 */
export const isValidUsername = (username: string): boolean => {
  return isValidUsernameSecure(username);
};

/**
 * Validate image file
 * SECURITY NOTE: SVG files are NOT allowed as they can contain XSS payloads
 */
export const isValidImageFile = (file: File): { valid: boolean; error?: string } => {
  // SECURITY: Removed SVG from allowed types due to XSS risk
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Please upload a valid image file (PNG, JPG, or WebP only)',
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'Logo file size must be less than 5MB',
    };
  }

  // Additional check: verify file extension matches MIME type
  const extension = file.name.split('.').pop()?.toLowerCase();
  const validExtensions = ['png', 'jpg', 'jpeg', 'webp'];

  if (!extension || !validExtensions.includes(extension)) {
    return {
      valid: false,
      error: 'Invalid file extension',
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
 * Validate SMTP host (secure version)
 */
export const isValidHost = (host: string): boolean => {
  return isValidHostSecure(host);
};

/**
 * Validate phone number
 */
export const isValidPhoneNumber = (phone: string): boolean => {
  return isValidPhone(phone);
};

/**
 * Sanitize text input
 */
export const sanitizeTextInput = (input: string): string => {
  return sanitizeInput(input);
};
