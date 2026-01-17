/**
 * Security Utilities for Onboarding Module
 *
 * CRITICAL: This module handles sensitive data encryption and sanitization
 */

/**
 * Sanitize HTML to prevent XSS attacks
 */
export const sanitizeHTML = (input: string): string => {
  const element = document.createElement('div');
  element.textContent = input;
  return element.innerHTML;
};

/**
 * Sanitize input to prevent injection attacks
 */
export const sanitizeInput = (input: string): string => {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/['"]/g, '') // Remove quotes
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
};

/**
 * Validate and sanitize URL
 */
export const isValidURL = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    // Only allow https URLs (http for development)
    return urlObj.protocol === 'https:' || (import.meta.env.DEV && urlObj.protocol === 'http:');
  } catch {
    return false;
  }
};

/**
 * Validate phone number format
 */
export const isValidPhone = (phone: string): boolean => {
  // International phone number format
  const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ''));
};

/**
 * Enhanced email validation
 */
export const isValidEmailSecure = (email: string): boolean => {
  // More comprehensive email validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!emailRegex.test(email)) return false;

  // Prevent email injection
  if (email.includes('\n') || email.includes('\r') || email.includes('%0a') || email.includes('%0d')) {
    return false;
  }

  // Check length
  if (email.length > 254) return false;

  return true;
};

/**
 * Validate hostname without allowing injection
 */
export const isValidHostSecure = (host: string): boolean => {
  // More strict hostname validation
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  return hostnameRegex.test(host) || ipRegex.test(host);
};

/**
 * Validate username with length limits
 */
export const isValidUsernameSecure = (username: string): boolean => {
  // Username: 3-32 characters, alphanumeric, underscore, hyphen only
  return /^[a-zA-Z0-9_-]{3,32}$/.test(username);
};

/**
 * Simple symmetric encryption for sessionStorage (client-side only - NOT production-grade)
 * WARNING: This is obfuscation, not true encryption. Sensitive data should NEVER
 * be stored client-side. This is only to prevent casual inspection.
 */
const ENCRYPTION_KEY = import.meta.env.VITE_SESSION_KEY || 'default-key-change-in-production';

export const obfuscate = (text: string): string => {
  // Simple XOR cipher for obfuscation (NOT secure encryption)
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length));
  }
  return btoa(result); // Base64 encode
};

export const deobfuscate = (encoded: string): string => {
  try {
    const text = atob(encoded); // Base64 decode
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length));
    }
    return result;
  } catch {
    return '';
  }
};

/**
 * Hash sensitive data before storage (one-way)
 */
export const hashData = async (data: string): Promise<string> => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Generate a secure random token
 */
export const generateSecureToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Validate that we're on HTTPS (except in development)
 */
export const enforceHTTPS = (): boolean => {
  if (import.meta.env.DEV) return true;

  if (window.location.protocol !== 'https:') {
    console.error('SECURITY ERROR: Application must be served over HTTPS');
    return false;
  }

  return true;
};

/**
 * Check if Content Security Policy is enabled
 */
export const checkCSP = (): void => {
  // Log warning if CSP is not detected
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (!meta && !import.meta.env.DEV) {
    console.warn('WARNING: Content Security Policy not detected. Add CSP headers for enhanced security.');
  }
};

/**
 * Prevent clickjacking
 */
export const preventClickjacking = (): void => {
  if (window.top !== window.self && !import.meta.env.DEV) {
    console.error('SECURITY: Possible clickjacking attempt detected');
    window.top!.location = window.self.location;
  }
};
