/**
 * Error Reporting Transport
 *
 * The single path by which a client-side failure reaches the Error Monitoring
 * page. Without it, most failures were visible only to the member who hit
 * them — an API 500 became a toast, an unhandled rejection became a console
 * line — so an administrator investigating "the site is broken for Dave" had
 * nothing to look at.
 *
 * Three deliberate properties:
 *
 * 1. **It posts with a bare axios call, not the shared client.** The shared
 *    client's response interceptor reports failures *through here*; routing
 *    the report back through that client would make a failing log endpoint
 *    report its own failure forever. A bare call also avoids the 401 →
 *    refresh → redirect-to-login path firing for a background report.
 * 2. **It is throttled.** A broken poll loop or a dead backend produces the
 *    same error hundreds of times a minute; identical errors are collapsed
 *    and the total is capped so one member's outage cannot flood the table
 *    every other member's errors live in.
 * 3. **It never throws and never awaits.** Reporting is best-effort; a
 *    failure to report must not alter what the caller was doing.
 */

import axios from 'axios';
import type { AxiosError } from 'axios';
import { getErrorMapping } from './errorCatalog';

/**
 * Posted directly rather than through `errorLogsService` — see the note above
 * about interceptor recursion.
 */
const ERROR_LOG_ENDPOINT = '/api/v1/errors/log';

/** Identical errors within this window are reported once. */
const DEDUPE_WINDOW_MS = 60_000;
/** Ceiling on reports per rolling window, across all error types. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 20;
/** Bound on the dedupe map so a long-lived tab cannot grow it without limit. */
const MAX_DEDUPE_ENTRIES = 200;

/** Mirrors the backend column widths so a report is never rejected for size. */
const MAX_ERROR_TYPE_LENGTH = 50;
const MAX_ERROR_MESSAGE_LENGTH = 2000;

export interface ErrorReport {
  errorType: string;
  errorMessage: string;
  /** Overrides the catalog's user-facing message when the caller has a better one. */
  userMessage?: string | undefined;
  troubleshootingSteps?: string[] | undefined;
  context?: Record<string, unknown> | undefined;
  eventId?: string | undefined;
}

/** Marker set on reported errors so the rejection handler doesn't double-report. */
const REPORTED_FLAG = '__reportedToErrorMonitoring';

const lastReportedAt = new Map<string, number>();
let windowStartedAt = 0;
let reportsInWindow = 0;

/** Test seam: clears the throttling state between cases. */
export function resetErrorReportingState(): void {
  lastReportedAt.clear();
  windowStartedAt = 0;
  reportsInWindow = 0;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * The log endpoint requires an authenticated session (an error log row is
 * org-scoped and has nowhere to go without one). Posting while logged out
 * would only produce a 401, so reports are dropped instead.
 */
function hasSession(): boolean {
  try {
    return Boolean(localStorage.getItem('has_session'));
  } catch {
    // Safari private mode and similar can throw on localStorage access.
    return false;
  }
}

function shouldSend(key: string): boolean {
  const now = Date.now();

  if (now - windowStartedAt > RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now;
    reportsInWindow = 0;
  }
  if (reportsInWindow >= MAX_REPORTS_PER_WINDOW) {
    return false;
  }

  const previous = lastReportedAt.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
    return false;
  }

  if (lastReportedAt.size >= MAX_DEDUPE_ENTRIES) {
    for (const [entryKey, at] of lastReportedAt) {
      if (now - at > DEDUPE_WINDOW_MS) lastReportedAt.delete(entryKey);
    }
    // Still full after eviction (every entry is recent): drop the oldest so
    // the map stays bounded rather than silently stopping all reporting.
    if (lastReportedAt.size >= MAX_DEDUPE_ENTRIES) {
      const oldest = lastReportedAt.keys().next();
      if (!oldest.done) lastReportedAt.delete(oldest.value);
    }
  }

  lastReportedAt.set(key, now);
  reportsInWindow += 1;
  return true;
}

/**
 * Send one error to the monitoring backend. Fire-and-forget by design.
 */
export function reportError(report: ErrorReport): void {
  const errorType = report.errorType.slice(0, MAX_ERROR_TYPE_LENGTH);
  const errorMessage = (report.errorMessage || 'Unknown error').slice(
    0,
    MAX_ERROR_MESSAGE_LENGTH,
  );
  // The path is part of the dedupe key so the same status failing on two
  // different endpoints is two distinct reports.
  const rawPath = report.context?.['path'];
  const contextPath = typeof rawPath === 'string' ? rawPath : '';

  if (!hasSession()) return;
  if (!shouldSend(`${errorType}|${errorMessage}|${contextPath}`)) return;

  const mapping = getErrorMapping(errorType, errorMessage);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = getCookie('csrf_token');
  if (csrf) headers['X-CSRF-Token'] = csrf;

  void axios
    .post(
      ERROR_LOG_ENDPOINT,
      {
        error_type: errorType,
        error_message: errorMessage,
        user_message: report.userMessage || mapping.userMessage,
        troubleshooting_steps: report.troubleshootingSteps || mapping.troubleshootingSteps,
        context: {
          source: 'frontend',
          page: window.location.pathname,
          ...report.context,
        },
        event_id: report.eventId,
      },
      { withCredentials: true, headers },
    )
    .catch(() => {
      // Reporting is best-effort: a failure here must not surface to the user
      // or replace the error being reported.
    });
}

/** True once this error has been reported, so handlers don't duplicate it. */
function isAlreadyReported(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<string, unknown>)[REPORTED_FLAG] === true
  );
}

function markReported(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    Object.defineProperty(error, REPORTED_FLAG, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * Classify an axios failure, or return null when it isn't worth an
 * administrator's attention.
 *
 * Reported: 5xx (server defects), transport failures and timeouts (the member
 * cannot reach the server at all), and 403 (a permission or role
 * misconfiguration an administrator is the only one who can fix).
 *
 * Not reported: 401, which is ordinary session expiry handled by the refresh
 * interceptor; 404, which is routine for a resource the user navigated away
 * from; and 4xx validation failures, which are the user being told to correct
 * a field. Logging those would bury the failures that matter.
 */
function classifyApiError(
  error: AxiosError,
): { errorType: string; message: string } | null {
  const status = error.response?.status;

  if (status !== undefined) {
    if (status >= 500) {
      const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
      const detailText = typeof detail === 'string' ? detail : error.message;
      return {
        errorType: status === 503 ? 'API_SERVICE_UNAVAILABLE' : 'API_SERVER_ERROR',
        message: `HTTP ${status}: ${detailText}`,
      };
    }
    if (status === 403) {
      return { errorType: 'API_FORBIDDEN', message: `HTTP 403: ${error.message}` };
    }
    return null;
  }

  // No response — the request never completed.
  if (error.code === 'ERR_CANCELED') {
    // Aborted by the application (navigation, superseded request), not a fault.
    return null;
  }
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
    return { errorType: 'API_TIMEOUT', message: error.message };
  }
  return { errorType: 'NETWORK_ERROR', message: error.message || 'Network request failed' };
}

/** Absolute-ish request path with the query string dropped (it can carry PII). */
function requestPath(error: AxiosError): string {
  const url = error.config?.url ?? '';
  const baseURL = error.config?.baseURL ?? '';
  const full = url.startsWith('http') || url.startsWith('/') ? url : `${baseURL}${url}`;
  return full.split('?')[0] ?? '';
}

/**
 * Report a failed API request. Called from the response interceptors of every
 * axios instance, so every module's traffic is covered by construction.
 */
export function reportApiError(error: AxiosError): void {
  if (isAlreadyReported(error)) return;

  const path = requestPath(error);
  // Never report a failure of the reporting endpoint itself.
  if (path.includes('/errors')) return;

  const classified = classifyApiError(error);
  if (!classified) return;

  markReported(error);
  reportError({
    errorType: classified.errorType,
    errorMessage: classified.message,
    context: {
      method: (error.config?.method ?? '').toUpperCase(),
      path,
      status: error.response?.status,
    },
  });
}

/**
 * Register window-level handlers for failures no component catches.
 *
 * `ErrorBoundary` only sees errors thrown during React rendering. An error in
 * an event handler, a `setTimeout`, or a promise nobody awaited bypasses it
 * entirely and previously reached nothing but the browser console — invisible
 * to the member and to the administrator alike.
 *
 * Safe to call more than once; the listeners are registered a single time.
 */
let globalHandlersInstalled = false;

export function setupGlobalErrorHandlers(): void {
  if (globalHandlersInstalled || typeof window === 'undefined') return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const message = event.message || 'Uncaught error';
    // "Script error." is the opaque placeholder browsers substitute for
    // cross-origin script failures (browser extensions, injected scripts).
    // It carries no diagnostic content, and ResizeObserver's loop notice is a
    // benign layout warning every app emits — neither is actionable.
    if (
      message === 'Script error.' ||
      message.startsWith('ResizeObserver loop')
    ) {
      return;
    }
    if (isAlreadyReported(event.error)) return;
    markReported(event.error);

    reportError({
      errorType: 'UNCAUGHT_EXCEPTION',
      errorMessage: message,
      context: {
        source: 'frontend',
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    if (isAlreadyReported(reason)) return;

    // An axios rejection that reached here was already classified (and either
    // reported or deliberately skipped) by the response interceptor.
    if (typeof reason === 'object' && reason !== null && 'config' in reason) {
      reportApiError(reason as AxiosError);
      return;
    }

    markReported(reason);
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection';

    reportError({
      errorType: 'UNHANDLED_REJECTION',
      errorMessage: message,
      context: { source: 'frontend' },
    });
  });
}
