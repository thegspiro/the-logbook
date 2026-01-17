/**
 * Validation Utilities for Onboarding Module
 */

import { PasswordStrength } from '../types';

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
 * Validate email format
 */
export const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Validate username format
 */
export const isValidUsername = (username: string): boolean => {
  return /^[a-zA-Z0-9_-]+$/.test(username) && username.length >= 3;
};

/**
 * Validate image file
 */
export const isValidImageFile = (file: File): { valid: boolean; error?: string } => {
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
  const maxSize = 5 * 1024 * 1024; // 5MB

  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Please upload a valid image file (PNG, JPG, SVG, or WebP)',
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: 'Logo file size must be less than 5MB',
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
 * Validate SMTP host
 */
export const isValidHost = (host: string): boolean => {
  // Simple hostname validation (can be IP or domain)
  return /^[a-zA-Z0-9.-]+$/.test(host) && host.length > 0;
};
