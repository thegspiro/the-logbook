/**
 * Security Utilities for Onboarding Module
 *
 * CRITICAL: This module handles sensitive data encryption and sanitization
 */


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
 * Validate phone number format
 */
export const isValidPhone = (phone: string): boolean => {
  // International phone number format
  const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ''));
};

/**
 * Enhanced email validation
 */
export const isValidEmailSecure = (email: string): boolean => {
  // More comprehensive email validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

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

// NOTE: A reversible XOR-based obfuscate()/deobfuscate() pair used to live here
// for stashing onboarding data in sessionStorage. It was unused (sensitive
// onboarding data is now POSTed straight to the server, never stored
// client-side) and gave a false sense of protection, so it was removed. Do not
// reintroduce client-side "encryption" of sensitive data — use the server.


