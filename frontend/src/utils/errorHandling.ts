/**
 * Error Handling Utilities
 *
 * Provides type-safe error handling utilities for the application.
 */

/**
 * Standard application error structure
 */
export interface AppError {
  message: string;
  code?: string;
  status?: number;
  details?: Record<string, unknown>;
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as AppError).message === 'string'
  );
}

/**
 * Converts an unknown error to an AppError
 */
export function toAppError(error: unknown): AppError {
  // Already an AppError
  if (isAppError(error)) {
    return error;
  }

  // Standard Error object
  if (error instanceof Error) {
    return {
      message: error.message,
      details: { name: error.name, stack: error.stack },
    };
  }

  // Axios/Fetch error with response
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as any).response === 'object'
  ) {
    const response = (error as any).response;
    return {
      message: response.data?.message || response.statusText || 'Request failed',
      code: response.data?.code,
      status: response.status,
      details: response.data?.details,
    };
  }

  // String error
  if (typeof error === 'string') {
    return { message: error };
  }

  // Unknown error type
  return {
    message: 'An unknown error occurred',
    details: { error: String(error) },
  };
}

/**
 * Gets a user-friendly error message from an unknown error
 */
export function getErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  const appError = toAppError(error);
  return appError.message || fallback;
}

/**
 * Type-safe error handler for async operations
 *
 * Usage:
 * ```typescript
 * try {
 *   await someAsyncOperation();
 * } catch (err: unknown) {
 *   const error = toAppError(err);
 *   console.error('Operation failed:', error.message);
 *   if (error.status === 401) {
 *     // Handle unauthorized
 *   }
 * }
 * ```
 */
