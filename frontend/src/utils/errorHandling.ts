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
    headers?: Record<string, unknown>;
  };
}

/**
 * A 429's `Retry-After`, in seconds, when the server sent one as a number.
 *
 * It arrives as a header, not in the body, so `details` never held it — and
 * the sign-in screen, which reads `details.retryAfter` to say how long to
 * wait, fell back to its own few-second backoff while the server was refusing
 * every attempt for a minute (workflow review W02-2). The HTTP-date form is
 * not used by this backend and is ignored.
 */
function retryAfterSeconds(response: HttpErrorResponse['response']): number | undefined {
  if (response.status !== 429) return undefined;
  const raw = response.headers?.['retry-after'];
  const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
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
 * A response `detail` of any of its three shapes as display text, or
 * `undefined` when it carries nothing to show. Shared by `toAppError` and
 * `getErrorDetail` so the two cannot disagree about what a detail says.
 */
function describeDetail(detail: unknown): string | undefined {
  if (Array.isArray(detail)) {
    return (detail as ValidationErrorEntry[]).map(describeValidationError).join(' ') || undefined;
  }
  if (detail && typeof detail === 'object') {
    // Some endpoints raise HTTPException with a structured object detail
    // (e.g. a 409 { message, ... }). Surface its `message` rather than
    // letting the object stringify to "[object Object]" in a toast.
    const { message } = detail as { message?: unknown };
    return typeof message === 'string' && message ? message : undefined;
  }
  return typeof detail === 'string' && detail ? detail : undefined;
}

/**
 * The server's own explanation of a failed request, as display text, or
 * `undefined` when it gave none — for call sites that show it and otherwise
 * fall back to their own wording: `getErrorDetail(err) || 'Failed to save'`.
 *
 * Replaces reading `err.response.data.detail` directly under a cast to
 * `string`. That cast is false for every 422, whose detail is an array of
 * `{field, message}` objects; rendered as a React child, the array throws and
 * the error boundary replaces the whole page, discarding the form the member
 * was filling in.
 */
export function getErrorDetail(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const { response } = error as { response?: unknown };
  if (typeof response !== 'object' || response === null) return undefined;
  return describeDetail((response as HttpErrorResponse['response']).data?.detail);
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
    const detailText = describeDetail(data?.detail);
    // 422 validation errors return detail as an array, and an empty one still
    // means validation failed rather than falling through to the status text.
    const message = Array.isArray(data?.detail)
      ? detailText || 'Validation failed'
      : detailText || data?.message || response.statusText || 'Request failed';
    const retryAfter = retryAfterSeconds(response);
    return {
      message,
      code: data?.code,
      status: response.status,
      details: retryAfter === undefined ? data?.details : { ...data?.details, retryAfter },
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
 * A toast message for a failed save that says what was being saved and what to
 * do next.
 *
 * A server fault (5xx) carries only "An unexpected error occurred", which
 * names neither the action nor a next step, so a member tapped the button
 * again and again. For those the message states the action, says the entries
 * are still on screen, and keeps the support code so IT can find the cause.
 * Anything else (validation, permission, a message the server wrote on
 * purpose) is already specific and is passed through untouched.
 */
export function getSaveFailureMessage(error: unknown, action: string): string {
  const appError = toAppError(error);
  if (appError.status === undefined || appError.status < 500) {
    return getErrorMessage(error, `Could not ${action}`);
  }
  const code = appError.code ? ` (Error code: ${appError.code})` : '';
  return `Could not ${action}: the server hit a problem on its end. Your entries are still on this page, so try again in a moment. If it keeps happening, tell IT${code}.`;
}

/**
 * True when a request never received an answer from the server — the device is
 * offline, DNS/TLS failed, or the client timed out waiting.
 *
 * Offline-capable screens use this to decide whether a failed submit may be
 * queued for later sync. A server that answered 400/403/422 has *rejected* the
 * payload: re-sending the identical body later can only be rejected again, so
 * queueing it hides a permanent failure behind a "will sync when connected"
 * message and the member never learns their work was not recorded.
 *
 * Defaults to `false` for anything it cannot positively identify as transport
 * failure — a programming error thrown while building the payload must surface,
 * not be filed away as a connectivity blip.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (typeof error !== 'object' || error === null) return false;

  const err = error as { response?: unknown; code?: string; message?: string };
  // An HTTP status means the server answered; whatever it said, it is not a
  // transport failure.
  if (err.response) return false;

  if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return true;

  // Axios attaches `request` once the call left the browser; with no `response`
  // alongside it, nothing came back.
  return 'request' in (error as Record<string, unknown>) || err.message === 'Network Error';
}

/**
 * True only when the server explicitly rejected a request and retrying the
 * unchanged payload cannot reasonably succeed. Transport failures, 5xx
 * responses, and request-timeout/rate-limit statuses are deliberately retained
 * for a later attempt by offline queues.
 */
export function isNonRetryableHttpError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('response' in error)) return false;

  const status = (error as { response?: { status?: unknown } }).response?.status;
  return (
    typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429
  );
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

/** One series session ahead of the member's training phase (EV-23). */
export interface PhaseGateOccurrence {
  event_id: string;
  title: string;
  /** UTC ISO-8601; format it in the department's timezone. */
  start_datetime: string | null;
  message: string;
}

/**
 * Detect the series form of the phase gate: `POST /events/{id}/rsvp-series`
 * answers 409 `phase_gate` with an `occurrences` list naming every session
 * ahead of the member's phase. Returns null for anything else, including the
 * single-event form (which has no list).
 */
export function getSeriesPhaseGateWarning(
  error: unknown
): { message: string; occurrences: PhaseGateOccurrence[] } | null {
  const response = (
    error as {
      response?: {
        status?: number;
        data?: { detail?: { warning_type?: string; message?: string; occurrences?: unknown } };
      };
    }
  )?.response;
  const body = response?.data?.detail;
  if (
    response?.status !== 409 ||
    !body ||
    typeof body !== 'object' ||
    body.warning_type !== 'phase_gate' ||
    !Array.isArray(body.occurrences)
  ) {
    return null;
  }
  return {
    message: body.message ?? 'Some sessions in this series are ahead of your current phase.',
    occurrences: body.occurrences as PhaseGateOccurrence[],
  };
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
