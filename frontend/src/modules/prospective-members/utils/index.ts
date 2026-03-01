/**
 * Prospective Members Module Utilities
 *
 * Pure utility functions extracted from types/index.ts. These deal with
 * runtime logic (validation, formatting) rather than type definitions.
 */

import type { InactivityConfig } from '../types';
import { TIMEOUT_PRESET_DAYS } from '../types';

/**
 * Compute effective timeout days from an InactivityConfig.
 * Returns null if the timeout is disabled ('never').
 */
export function getEffectiveTimeoutDays(config: InactivityConfig): number | null {
  if (config.timeout_preset === 'never') return null;
  if (config.timeout_preset === 'custom') {
    const days = config.custom_timeout_days;
    if (days == null || days <= 0 || !Number.isFinite(days)) return null;
    return days;
  }
  return TIMEOUT_PRESET_DAYS[config.timeout_preset];
}

/** Validate that a URL uses a safe protocol (http/https only). */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Safe initials extraction that handles empty strings. */
export function getInitials(firstName: string, lastName: string): string {
  const f = firstName?.trim();
  const l = lastName?.trim();
  return `${f ? f[0] : '?'}${l ? l[0] : '?'}`.toUpperCase();
}

/** Basic email format validation. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
