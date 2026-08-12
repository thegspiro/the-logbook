/**
 * Error Reporting Transport
 *
 * The single path by which a client-side failure reaches the Error Monitoring
 * page. Without it, most failures were visible only to the member who hit
 * them — an API 500 became a toast, an unhandled rejection became a console
 * line — so an administrator investigating "the site is broken for Dave" had
 * nothing to look at.
 *
 * The design goals, in order:
 *
 * 1. **Don't lose reports.** The failures most worth recording are exactly the
 *    ones that break their own delivery: a network outage kills the report
 *    about the network outage, and a member who hits an error and immediately
 *    closes the tab takes the evidence with them. Reports are therefore
 *    queued, retried with backoff, and flushed with `keepalive` when the page
 *    goes away. Queues never cross an authentication boundary.
 * 2. **Don't lie about volume.** Throttling is necessary — a broken poll loop
 *    produces the same error hundreds of times a minute — but a suppressed
 *    error that leaves no trace reads as an error that didn't happen.
 *    Duplicates are counted and reported as occurrences, and anything dropped
 *    by the rate cap is reported as a count of what was dropped.
 * 3. **Don't leak.** Error text is attacker- and user-influenced, and these
 *    rows are exportable by administrators, so identifiers are scrubbed
 *    before a report leaves the browser.
 * 4. **Never disturb the caller.** Reporting is best-effort and asynchronous;
 *    a failure to report must not alter what the member was doing.
 *
 * It posts with a bare `fetch`, not the shared axios client, because that
 * client's interceptor reports failures *through here* — routing reports back
 * through it would make a failing log endpoint report its own failure forever,
 * and would drag a background report into the 401 → refresh → redirect path.
 */

import type { AxiosError } from 'axios';
import { getErrorMapping } from './errorCatalog';

/** Posted directly rather than through `errorLogsService` — see above. */
const ERROR_LOG_ENDPOINT = '/api/v1/errors/log';

/** Identical errors within this window are collapsed into an occurrence count. */
const DEDUPE_WINDOW_MS = 60_000;
/** Ceiling on reports per rolling window, across all error types. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 20;
/** Bound on the dedupe map so a long-lived tab cannot grow it without limit. */
const MAX_DEDUPE_ENTRIES = 200;

/**
 * Bound on undelivered reports held in memory. Reached only while offline or
 * signed out; past it the oldest are dropped and counted, because the newest
 * failures describe the state the member is actually in.
 */
const MAX_QUEUE_LENGTH = 50;
/** Delivery attempts per report before it is abandoned. */
const MAX_DELIVERY_ATTEMPTS = 4;
/** Backoff between attempts. The last entry repeats if attempts exceed it. */
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];
/**
 * Cap on reports flushed during page-hide. `keepalive` requests share a small
 * per-origin body budget, and exceeding it makes the browser drop the request
 * outright — a smaller flush that arrives beats a larger one that doesn't.
 */
const MAX_KEEPALIVE_REPORTS = 10;

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

/** The wire shape accepted by POST /errors/log. */
interface ErrorLogPayload {
  error_type: string;
  error_message: string;
  user_message: string;
  troubleshooting_steps: string[];
  context: Record<string, unknown>;
  event_id?: string | undefined;
}

interface QueuedReport {
  payload: ErrorLogPayload;
  attempts: number;
}

/** Marker set on reported errors so the rejection handler doesn't double-report. */
const REPORTED_FLAG = '__reportedToErrorMonitoring';

const lastReportedAt = new Map<string, number>();
/** Duplicates seen since the last report of that key, awaiting an occurrence count. */
const suppressedCounts = new Map<string, number>();
/** Last payload seen per dedupe key, so a collapsed burst can still be reported. */
const suppressedSamples = new Map<string, ErrorLogPayload>();
const queue: QueuedReport[] = [];

let windowStartedAt = 0;
let reportsInWindow = 0;
let droppedByRateLimit = 0;
let droppedByQueueOverflow = 0;
let draining = false;
let emittingSummary = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let queueGeneration = 0;

/** Test seam: clears all throttling and delivery state. */
export function resetErrorReportingState(): void {
  clearQueuedReports();
  draining = false;
}

/**
 * Discard all report data at an authentication boundary.
 *
 * The backend attributes a report from the cookie used at delivery time, so
 * retaining payloads across logout, session expiry, or login could disclose a
 * previous user's errors to the next user's organization on a shared browser.
 */
export function clearQueuedReports(): void {
  lastReportedAt.clear();
  suppressedCounts.clear();
  suppressedSamples.clear();
  queue.length = 0;
  queueGeneration += 1;
  windowStartedAt = 0;
  reportsInWindow = 0;
  droppedByRateLimit = 0;
  droppedByQueueOverflow = 0;
  emittingSummary = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** Test seam: number of reports awaiting delivery. */
export function pendingReportCount(): number {
  return queue.length;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * The log endpoint requires an authenticated session (an error log row is
 * org-scoped and has nowhere to go without one). Reports raised while signed
 * out must not be retained for a future, potentially different session.
 */
function hasSession(): boolean {
  try {
    return Boolean(localStorage.getItem('has_session'));
  } catch {
    // Safari private mode and similar can throw on localStorage access.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

/**
 * Patterns replaced before a report leaves the browser.
 *
 * Error text is not a controlled string: it quotes user input, API payloads,
 * and whatever a third-party library decided to interpolate. These rows are
 * readable by every `audit.view` holder and downloadable as a JSON export, so
 * an identifier that lands here has left the access controls that governed it
 * everywhere else. Scrubbing at the source is the only point where that is
 * enforceable — a server-side filter would already have the value in a log
 * line by then.
 *
 * The list is deliberately short and high-confidence. Over-aggressive
 * scrubbing destroys the diagnostic value that justifies the feature.
 */
const SCRUB_PATTERNS: Array<[RegExp, string]> = [
  // SSN before phone: a 3-2-4 grouping must not be read as a phone number.
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]'],
  // Bearer tokens and JWTs: a library that echoes a request header into its
  // error message would otherwise put a live credential in the table.
  [/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [redacted]'],
  [/\beyJ[\w.-]{10,}/g, '[jwt]'],
];

/**
 * Remove identifiers from free text bound for the error log.
 */
export function scrubSensitive(text: string): string {
  return SCRUB_PATTERNS.reduce((scrubbed, [pattern, replacement]) => scrubbed.replace(pattern, replacement), text);
}

/** Remove bearer-style public workflow tokens embedded in URL paths. */
export function sanitizePath(path: string): string {
  return path
    .replace(/(\/finance\/approvals\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/(\/event-requests\/status\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/(\/application-status\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/(\/calendar\/)[^/?#]+(?=\.ics(?:[/\s?#]|$))/gi, '$1[REDACTED]');
}

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

function pruneDedupeMap(now: number): void {
  if (lastReportedAt.size < MAX_DEDUPE_ENTRIES) return;

  for (const [entryKey, at] of lastReportedAt) {
    if (now - at > DEDUPE_WINDOW_MS) {
      lastReportedAt.delete(entryKey);
      suppressedCounts.delete(entryKey);
    }
  }
  // Still full after eviction (every entry is recent): drop the oldest so the
  // map stays bounded rather than silently stopping all reporting.
  if (lastReportedAt.size >= MAX_DEDUPE_ENTRIES) {
    const oldest = lastReportedAt.keys().next();
    if (!oldest.done) {
      lastReportedAt.delete(oldest.value);
      suppressedCounts.delete(oldest.value);
    }
  }
}

/**
 * Decide whether this report is sent now, and with what occurrence count.
 *
 * Returns null when the report is being collapsed into a later one (duplicate)
 * or dropped by the rate cap. Both are accounted for rather than forgotten:
 * the duplicate returns as an occurrence count on the next send of that key,
 * and the drop returns as a REPORTING_THROTTLED summary when the window rolls.
 */
function admit(key: string): { occurrences: number } | null {
  const now = Date.now();

  if (now - windowStartedAt > RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now;
    reportsInWindow = 0;
    flushSuppressionSummary();
  }

  const previous = lastReportedAt.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
    suppressedCounts.set(key, (suppressedCounts.get(key) ?? 0) + 1);
    return null;
  }

  if (reportsInWindow >= MAX_REPORTS_PER_WINDOW) {
    droppedByRateLimit += 1;
    return null;
  }

  pruneDedupeMap(now);
  lastReportedAt.set(key, now);
  reportsInWindow += 1;

  const occurrences = 1 + (suppressedCounts.get(key) ?? 0);
  suppressedCounts.delete(key);
  return { occurrences };
}

/**
 * Report what the client itself silenced, so the page shows truncation
 * instead of an artificially quiet minute.
 *
 * Both caps in this module discard reports — the per-window rate cap and the
 * queue bound — and a discarded error that leaves no trace is indistinguishable
 * from an error that never happened. That is the failure mode an administrator
 * cannot recover from, so the counts are reported even though the reports
 * themselves are gone.
 */
function flushSuppressionSummary(): void {
  const byRateCap = droppedByRateLimit;
  const byOverflow = droppedByQueueOverflow;
  const dropped = byRateCap + byOverflow;
  if (dropped === 0 || emittingSummary) return;

  droppedByRateLimit = 0;
  droppedByQueueOverflow = 0;
  emittingSummary = true;
  try {
    const mapping = getErrorMapping('REPORTING_THROTTLED', '');
    enqueue({
      error_type: 'REPORTING_THROTTLED',
      error_message:
        `${dropped} further error report(s) were discarded by this client ` +
        `(${byRateCap} over the rate cap, ${byOverflow} over the queue bound)`,
      user_message: mapping.userMessage,
      troubleshooting_steps: mapping.troubleshootingSteps,
      context: {
        source: 'frontend',
        page: window.location.pathname,
        dropped,
        dropped_by_rate_cap: byRateCap,
        dropped_by_queue_overflow: byOverflow,
      },
    });
  } finally {
    emittingSummary = false;
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function enqueue(payload: ErrorLogPayload): void {
  if (!hasSession()) return;
  if (queue.length >= MAX_QUEUE_LENGTH) {
    queue.shift();
    droppedByQueueOverflow += 1;
  }
  queue.push({ payload, attempts: 0 });
  void drain();
}

function buildRequestInit(payload: ErrorLogPayload, keepalive: boolean): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = getCookie('csrf_token');
  if (csrf) headers['X-CSRF-Token'] = csrf;

  return {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
    keepalive,
  };
}

type DeliveryOutcome = 'sent' | 'retry' | 'hold' | 'drop';

/**
 * What to do about a response the server gave us.
 *
 * A 5xx means the server failed to store the report — worth retrying. A 401
 * means the session lapsed between queueing and sending. The queued data must
 * be discarded because a later login may belong to another user or tenant.
 * Every other 4xx is the server refusing this specific report — 429 says stop,
 * 422 says the payload is malformed — and retrying those only burns the queue.
 */
function classifyResponse(status: number): DeliveryOutcome {
  if (status >= 500) return 'retry';
  if (status === 401) return 'hold';
  return 'drop';
}

async function deliver(item: QueuedReport): Promise<DeliveryOutcome> {
  try {
    const response = await fetch(ERROR_LOG_ENDPOINT, buildRequestInit(item.payload, false));
    if (response.ok) return 'sent';
    return classifyResponse(response.status);
  } catch {
    // The request never completed (offline, DNS, CORS). This is the common
    // case for the reports that matter most, since a network failure breaks
    // both the request the member made and the report about it.
    return 'retry';
  }
}

function scheduleRetry(attempts: number): void {
  if (retryTimer) return;
  const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drain();
  }, delay);
}

/**
 * Deliver queued reports one at a time, in order.
 *
 * Serial rather than parallel on purpose: the queue drains after a failure,
 * often the moment connectivity returns, and firing twenty concurrent posts
 * at a server that may still be recovering is how a monitoring system turns
 * an outage into a worse one.
 */
async function drain(): Promise<void> {
  if (draining) return;
  if (!hasSession()) return;

  draining = true;
  const generation = queueGeneration;
  try {
    while (queue.length > 0) {
      const item = queue[0];
      if (!item) break;

      item.attempts += 1;
      const outcome = await deliver(item);

      // An auth boundary cleared this generation while delivery was in flight.
      // Never let its completion remove or otherwise mutate a new user's queue.
      if (generation !== queueGeneration) return;

      if (outcome === 'hold') {
        clearQueuedReports();
        return;
      }
      if (outcome === 'sent' || outcome === 'drop') {
        queue.shift();
        // Delivery is working again, so anything the caps discarded while it
        // wasn't can now be accounted for.
        if (outcome === 'sent') flushSuppressionSummary();
        continue;
      }
      if (item.attempts >= MAX_DELIVERY_ATTEMPTS) {
        queue.shift();
        continue;
      }
      scheduleRetry(item.attempts);
      return;
    }
  } finally {
    draining = false;
    // If an auth-boundary clear happened during the request, reports from the
    // new generation may have arrived while the old drain still held the lock.
    if (generation !== queueGeneration && queue.length > 0 && hasSession()) void drain();
  }
}

/**
 * Send what is queued before the page goes away.
 *
 * An ordinary fetch is cancelled when the document unloads, so without this a
 * member who hits an error and immediately closes the tab — the single most
 * common way an error is observed and then lost — reports nothing. `keepalive`
 * lets the request outlive the page.
 */
function flushOnHide(): void {
  // Emit the tail of any collapsed duplicates first: a burst that stopped
  // being reported because it was deduplicated should not vanish with the tab.
  for (const [key, count] of suppressedCounts) {
    const sample = suppressedSamples.get(key);
    if (sample && count > 0) {
      queue.push({
        payload: {
          ...sample,
          context: { ...sample.context, occurrences: count + 1 },
        },
        attempts: 0,
      });
    }
  }
  suppressedCounts.clear();

  if (!hasSession()) return;

  // Only the reports actually attempted leave the queue. `pagehide` and a
  // hidden `visibilitychange` both fire on cases the page survives — a phone
  // user switching apps, a tab restored from the back/forward cache — so
  // clearing the whole queue here would discard everything past the flush cap
  // in exactly the situation where it could still have been delivered.
  for (const item of queue.splice(0, MAX_KEEPALIVE_REPORTS)) {
    try {
      void fetch(ERROR_LOG_ENDPOINT, buildRequestInit(item.payload, true));
    } catch {
      // Nothing further to try — the page is going away.
    }
  }
}

// ---------------------------------------------------------------------------
// Public reporting API
// ---------------------------------------------------------------------------

/**
 * Send one error to the monitoring backend. Fire-and-forget by design.
 */
export function reportError(report: ErrorReport): void {
  const errorType = report.errorType.slice(0, MAX_ERROR_TYPE_LENGTH);
  const errorMessage = scrubSensitive(report.errorMessage || 'Unknown error').slice(0, MAX_ERROR_MESSAGE_LENGTH);
  // The path is part of the dedupe key so the same status failing on two
  // different endpoints is two distinct reports.
  const rawPath = report.context?.['path'];
  const contextPath = typeof rawPath === 'string' ? sanitizePath(rawPath) : '';
  const key = `${errorType}|${errorMessage}|${contextPath}`;

  const mapping = getErrorMapping(errorType, errorMessage);
  const context: Record<string, unknown> = {
    source: 'frontend',
    page: sanitizePath(window.location.pathname),
    ...report.context,
  };
  if (typeof context['path'] === 'string') context['path'] = sanitizePath(context['path']);
  if (typeof context['page'] === 'string') context['page'] = sanitizePath(context['page']);

  const payload: ErrorLogPayload = {
    error_type: errorType,
    error_message: errorMessage,
    user_message: scrubSensitive(report.userMessage || mapping.userMessage),
    troubleshooting_steps: report.troubleshootingSteps || mapping.troubleshootingSteps,
    context,
    event_id: report.eventId,
  };

  const admission = admit(key);
  if (!admission) {
    // Collapsed into a later report; keep the payload so the count can still
    // be delivered if the page closes before that report is sent.
    suppressedSamples.set(key, payload);
    return;
  }
  suppressedSamples.delete(key);

  if (admission.occurrences > 1) {
    payload.context['occurrences'] = admission.occurrences;
  }
  enqueue(payload);
}

/** True once this error has been reported, so handlers don't duplicate it. */
function isAlreadyReported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<string, unknown>)[REPORTED_FLAG] === true;
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
function classifyApiError(error: AxiosError): { errorType: string; message: string } | null {
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
  return sanitizePath(full.split('?')[0] ?? '');
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
 * Register window-level handlers for failures no component catches, and the
 * page-hide flush that keeps a closing tab from taking its reports with it.
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
    if (message === 'Script error.' || message.startsWith('ResizeObserver loop')) {
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
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled promise rejection';

    reportError({
      errorType: 'UNHANDLED_REJECTION',
      errorMessage: message,
      context: { source: 'frontend' },
    });
  });

  // `pagehide` rather than `unload`: it is the event that still fires when a
  // mobile browser freezes the tab into the back/forward cache, which is how
  // a phone user leaves a page. `visibilitychange` covers the app-switch case
  // on iOS, where the tab may never be formally hidden again.
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });
}
