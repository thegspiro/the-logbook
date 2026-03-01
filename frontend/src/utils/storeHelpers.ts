/**
 * Store Helpers
 *
 * Shared utilities for Zustand stores to standardize error handling.
 */

import { getErrorMessage } from './errorHandling';

/**
 * Extracts a user-friendly error message from an unknown catch value.
 * Wraps `getErrorMessage()` for consistent usage across all stores.
 */
export function handleStoreError(err: unknown, fallback: string): string {
  return getErrorMessage(err, fallback);
}
