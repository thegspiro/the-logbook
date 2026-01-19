/**
 * Security Initialization for Onboarding Module
 *
 * This module performs critical security checks on application startup.
 * Run this BEFORE rendering any onboarding components.
 */

import { enforceHTTPS, checkCSP, preventClickjacking } from './utils/security';

interface SecurityCheckResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Perform comprehensive security checks
 */
export const performSecurityChecks = (): SecurityCheckResult => {
  const warnings: string[] = [];
  const errors: string[] = [];
  let passed = true;

  // 1. HTTPS Enforcement
  if (!enforceHTTPS()) {
    errors.push('CRITICAL: Application must be served over HTTPS in production');
    passed = false;
  }

  // 2. Check CSP
  checkCSP();

  // 3. Prevent clickjacking
  preventClickjacking();

  // 4. Check for sensitive data in sessionStorage
  const sensitiveKeys = [
    'password',
    'secret',
    'key',
    'token',
    'credential',
    'apppassword',
  ];

  Object.keys(sessionStorage).forEach((key) => {
    sensitiveKeys.forEach((sensitive) => {
      if (key.toLowerCase().includes(sensitive)) {
        warnings.push(
          `WARNING: Potentially sensitive data found in sessionStorage: ${key}`
        );
      }
    });
  });

  // 5. Check browser security features
  if (!window.crypto || !window.crypto.subtle) {
    errors.push('CRITICAL: Web Crypto API not available. Use a modern browser.');
    passed = false;
  }

  // 6. Check for secure context
  if (!window.isSecureContext && !import.meta.env.DEV) {
    errors.push('CRITICAL: Application not running in secure context');
    passed = false;
  }

  // 7. Validate environment variables
  if (!import.meta.env.VITE_API_URL && !import.meta.env.DEV) {
    warnings.push('WARNING: VITE_API_URL not configured');
  }

  // 8. Check for mixed content
  if (window.location.protocol === 'https:') {
    // Log warning if any HTTP resources are detected (browser will block them)
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        const resource = entry as PerformanceResourceTiming;
        if (resource.name.startsWith('http://')) {
          warnings.push(`WARNING: HTTP resource detected: ${resource.name}`);
        }
      });
    });

    try {
      observer.observe({ entryTypes: ['resource'] });
    } catch (e) {
      // Performance Observer not supported
    }
  }

  return { passed, warnings, errors };
};

/**
 * Initialize security features and display warnings
 */
export const initializeSecurity = (): void => {
  const result = performSecurityChecks();

  // Log warnings
  result.warnings.forEach((warning) => {
    console.warn(`🔒 SECURITY ${warning}`);
  });

  // Log errors
  result.errors.forEach((error) => {
    console.error(`🚨 SECURITY ${error}`);
  });

  // Display critical warning about sensitive data storage
  if (!import.meta.env.DEV) {
    const banner = `
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║        ⚠️  CRITICAL SECURITY WARNING - READ BEFORE USE ⚠️      ║
║                                                               ║
║  This onboarding module stores data in browser sessionStorage║
║  which is NOT secure for sensitive information.             ║
║                                                               ║
║  BEFORE PRODUCTION DEPLOYMENT:                               ║
║  1. Remove password storage from sessionStorage             ║
║  2. Remove API keys and secrets from sessionStorage         ║
║  3. Implement server-side session management                ║
║  4. Review SECURITY_WARNINGS.md for full details            ║
║                                                               ║
║  Current risk: Passwords and secrets visible in browser!     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `;
    console.warn(banner);
  }

  // Block execution if critical errors found
  if (!result.passed && !import.meta.env.DEV) {
    throw new Error(
      'SECURITY ERROR: Critical security checks failed. See console for details.'
    );
  }
};

/**
 * Security headers check (can only be done via network inspection)
 */
export const checkSecurityHeaders = async (): Promise<void> => {
  try {
    const response = await fetch(window.location.href, { method: 'HEAD' });

    const recommendedHeaders = {
      'Strict-Transport-Security': 'HSTS not enabled',
      'X-Content-Type-Options': 'Content-Type sniffing protection missing',
      'X-Frame-Options': 'Clickjacking protection missing',
      'X-XSS-Protection': 'XSS protection header missing',
      'Referrer-Policy': 'Referrer policy not set',
      'Permissions-Policy': 'Permissions policy not configured',
    };

    Object.entries(recommendedHeaders).forEach(([header, warning]) => {
      if (!response.headers.has(header)) {
        console.warn(`🔒 SECURITY WARNING: ${warning}`);
      }
    });

    // Check CSP
    if (!response.headers.has('Content-Security-Policy')) {
      console.warn(
        '🔒 SECURITY WARNING: Content Security Policy not configured'
      );
    }
  } catch (error) {
    console.error('Unable to check security headers:', error);
  }
};

/**
 * Auto-run security initialization
 */
if (typeof window !== 'undefined') {
  initializeSecurity();

  // Check security headers on load (async)
  if (!import.meta.env.DEV) {
    checkSecurityHeaders();
  }
}
