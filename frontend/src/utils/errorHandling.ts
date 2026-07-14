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
  code?: string | undefined;
  status?: number | undefined;
  details?: Record<string, unknown> | undefined;
}

/**
 * Shape of an Axios-like error with a response property.
 * Used for narrowing unknown catch values without importing axios.
 */
interface HttpErrorResponse {
  response: {
    data?: { detail?: string | Array<{ loc?: string[]; msg?: string }>; message?: string; code?: string; details?: Record<string, unknown> };
    status?: number;
    statusText?: string;
  };
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
  // Axios/Fetch error with response (check first, since Axios errors also have .message and extend Error)
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as HttpErrorResponse).response === 'object'
  ) {
    const response = (error as HttpErrorResponse).response;
    const { data } = response;
    let message: string;
    if (Array.isArray(data?.detail)) {
      // FastAPI/Pydantic 422 validation errors return detail as an array
      const errors = data.detail as Array<{ loc?: string[]; msg?: string }>;
      message = errors
        .map(e => {
          const field = e.loc?.[e.loc.length - 1];
          const msg = e.msg || 'Invalid value';
          return field ? `${field}: ${msg}` : msg;
        })
        .join('. ') || 'Validation failed';
    } else {
      message = data?.detail || data?.message || response.statusText || 'Request failed';
    }
    return {
      message,
      code: data?.code,
      status: response.status,
      details: data?.details,
    };
  }

  // Standard Error object — omit stack to avoid leaking file paths or PHI in query params
  if (error instanceof Error) {
    return {
      message: error.message,
      details: { name: error.name },
    };
  }

  // Already an AppError (plain object with message)
  if (isAppError(error)) {
    return error;
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
 * Detect the soft training-pipeline phase gate (HTTP 409 with a structured
 * `phase_gate` detail) that RSVP / self check-in return when a session is ahead
 * of the member's current phase. Returns the warning message the caller should
 * confirm before retrying with `override`, or null if this isn't that gate.
 */
export function getPhaseGateWarning(error: unknown): string | null {
  const detail = (
    error as {
      response?: {
        status?: number;
        data?: { detail?: { warning_type?: string; message?: string } };
      };
    }
  )?.response;
  const body = detail?.data?.detail;
  if (
    detail?.status === 409 &&
    body &&
    typeof body === 'object' &&
    body.warning_type === 'phase_gate'
  ) {
    return body.message ?? 'This session is ahead of your current phase.';
  }
  return null;
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
