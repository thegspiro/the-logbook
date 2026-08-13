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
 * One entry of a 422 validation `detail` array.
 *
 * Two spellings are accepted because the API emits one and FastAPI's own
 * machinery emits the other. `main.py` installs a `RequestValidationError`
 * handler that rewrites Pydantic's default `{loc, msg, type}` into
 * `{field, message}` before the body leaves the server, so a reader that
 * understands only the Pydantic spelling drops both halves of every validation
 * failure and renders a bare "Invalid value" with no field name and no reason.
 * `{loc, msg}` still has to be handled: anything that bypasses that handler — a
 * mounted sub-application, a gateway-generated 422 — arrives in the original
 * form.
 */
interface ValidationErrorEntry {
  loc?: Array<string | number>;
  msg?: string;
  field?: string;
  message?: string;
}

/**
 * Shape of an Axios-like error with a response property.
 * Used for narrowing unknown catch values without importing axios.
 */
interface HttpErrorResponse {
  response: {
    data?: {
      detail?: string | ValidationErrorEntry[] | Record<string, unknown>;
      message?: string;
      code?: string;
      details?: Record<string, unknown>;
    };
    status?: number;
    statusText?: string;
  };
}

/**
 * Renders one validation entry as `field: reason`, tolerating either spelling.
 *
 * The backend uses the literal field name `"request"` for an error it could not
 * attribute to any field; prefixing the message with it reads as a field called
 * "request", so that one is dropped rather than shown.
 */
function describeValidationError(entry: ValidationErrorEntry): string {
  const locField = entry.loc?.length ? String(entry.loc[entry.loc.length - 1]) : undefined;
  const field = entry.field || locField;
  const message = entry.message || entry.msg || 'Invalid value';
  const described = field && field !== 'request' ? `${field}: ${message}` : message;
  // The two 422 sources punctuate differently — the API's handler ends each
  // message with a period, Pydantic's own do not — so entries are terminated
  // here and joined on a single space. Joining on ". " instead produced
  // "Invalid date format.. " wherever the message already carried its period.
  return /[.!?]$/.test(described) ? described : `${described}.`;
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as AppError).message === 'string'
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
      // 422 validation errors return detail as an array
      message = data.detail.map(describeValidationError).join(' ') || 'Validation failed';
    } else if (data?.detail && typeof data.detail === 'object') {
      // Some endpoints raise HTTPException with a structured object detail
      // (e.g. a 409 { message, ... }). Surface its `message` rather than
      // letting the object stringify to "[object Object]" in a toast.
      const objDetail = data.detail as { message?: unknown };
      const detailMessage = typeof objDetail.message === 'string' ? objDetail.message : undefined;
      message = detailMessage || data?.message || response.statusText || 'Request failed';
    } else {
      message = (data?.detail as string | undefined) || data?.message || response.statusText || 'Request failed';
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
 * Gets a user-friendly error message from an unknown error.
 *
 * When the backend supplied a support code (every API error response carries
 * one, e.g. LB-AUTH-002 — see docs/ERROR_CODES.md), it is appended so members
 * can quote it to IT and IT can look it up on the Error Monitoring page.
 */
export function getErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  const appError = toAppError(error);
  const message = appError.message || fallback;
  return appError.code ? `${message} (Error code: ${appError.code})` : message;
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
  if (detail?.status === 409 && body && typeof body === 'object' && body.warning_type === 'phase_gate') {
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
