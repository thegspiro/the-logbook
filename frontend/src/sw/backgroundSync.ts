/**
 * Sends the generic and shift-report offline queues from the service worker,
 * when the browser fires a Background Sync event — which it can do after the
 * app has been closed, once signal returns. Chromium browsers only; elsewhere
 * the page drains (useOfflineSyncEngine) are still the only way out.
 *
 * Runs under rules the page never had to meet, and each is handled here:
 *
 * - **No axios, no auth store.** Requests go through `fetch` with the cookie
 *   jar, the CSRF header read from the `csrf_token` cookie, and one refresh on
 *   a 401. A 409 `LB-AUTH-012` from that refresh means a page refreshed the
 *   same session at the same moment and won; the jar already holds its tokens,
 *   so carry on (AUTH-21) — never treat it as signed out.
 * - **Whose items to send** comes from the server (`GET /auth/me`), not from
 *   a store the worker cannot read. Only that member's items go, exactly as
 *   the page sends only `isOwnedByCurrentMember` ones (FE3-34-5).
 * - **The page may be draining too.** Everything runs under the drain lock the
 *   page drains take. The server-side keys added for resends (training
 *   submissions' client_request_id, shift reports' already-reported skip)
 *   cover anything a lock cannot.
 *
 * Retry rules are the page's: only an explicit permanent refusal
 * (`isNonRetryableHttpError`) is a strike; generic items are discarded at the
 * same cap, and a shift report is never discarded. Anything left for a reason
 * that may pass — an outage, a lost connection — makes the sync reject with
 * `BackgroundSyncRetryLater`, which tells the browser to try again later.
 *
 * Every browser dependency comes in through `BackgroundSyncEnv`, so this runs
 * under test against a real IndexedDB; backgroundSyncWorker.ts supplies the
 * real ones.
 */

import { isNonRetryableHttpError } from '../utils/errorHandling';
import {
  GENERIC_QUEUE_MAX_RETRIES,
  dequeueGeneric,
  isGenericSendable,
  listGenericPending,
  markGenericRetry,
} from '../utils/genericOfflineStore';
import {
  SHIFT_REPORT_REFUSALS_BEFORE_NOTICE,
  dequeueShiftReport,
  listPendingReports,
  markReportRetry,
} from '../utils/shiftReportOfflineStore';
import { BACKGROUND_SYNC_MESSAGE, type BackgroundSyncSummary } from './backgroundSyncProtocol';

const API_BASE = '/api/v1';
const SHIFT_REPORTS_PATH = '/training/shift-reports/batch';
/** Mirrors ErrorCode.AUTH_REFRESH_SUPERSEDED in app/core/error_codes.py. */
const REFRESH_SUPERSEDED_CODE = 'LB-AUTH-012';

export interface BackgroundSyncEnv {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** The `csrf_token` cookie's value, read afresh: a refresh rotates it. */
  csrfToken: () => Promise<string | null>;
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Tell open windows what happened, so they refresh counts and say so. */
  notify: (summary: BackgroundSyncSummary) => Promise<void>;
}

/** Rejected with when something was left that a later attempt may send. */
export class BackgroundSyncRetryLater extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BackgroundSyncRetryLater';
  }
}

class ConnectionLost extends Error {}

type Outcome = 'sent' | 'refused' | 'retry';

export async function runBackgroundSync(env: BackgroundSyncEnv): Promise<void> {
  await env.withLock(async () => {
    const member = await currentMember(env);
    if (!member) return;

    const summary: BackgroundSyncSummary = {
      type: BACKGROUND_SYNC_MESSAGE,
      genericSynced: 0,
      genericDiscarded: 0,
      shiftReportsSynced: 0,
      shiftReportsRefused: [],
    };
    let retryLater = false;
    let attempted = false;

    try {
      for (const item of await listGenericPending()) {
        if (item.ownerId !== member || !isGenericSendable(item)) continue;
        attempted = true;
        const { outcome, status } = await send(env, item.url, item.body);
        if (outcome === 'sent') {
          await dequeueGeneric(item.id);
          summary.genericSynced += 1;
        } else if (outcome === 'refused') {
          if (item.retries + 1 >= GENERIC_QUEUE_MAX_RETRIES) {
            await dequeueGeneric(item.id);
            summary.genericDiscarded += 1;
          } else {
            await markGenericRetry(item.id, `Request failed with status code ${status}`);
          }
        } else {
          retryLater = true;
        }
      }

      for (const report of await listPendingReports()) {
        if (report.ownerId !== member) continue;
        attempted = true;
        const { outcome, response } = await send(env, SHIFT_REPORTS_PATH, report.payload);
        if (outcome === 'sent') {
          await dequeueShiftReport(report.id);
          summary.shiftReportsSynced += 1;
        } else if (outcome === 'refused') {
          const message = await refusalMessage(response);
          const refusals = await markReportRetry(report.id, message);
          if (refusals >= SHIFT_REPORT_REFUSALS_BEFORE_NOTICE) {
            summary.shiftReportsRefused.push({ shiftDate: report.payload.shift_date, message });
          }
        } else {
          retryLater = true;
        }
      }
    } catch (err) {
      if (!(err instanceof ConnectionLost)) throw err;
      if (attempted) await env.notify(summary);
      throw new BackgroundSyncRetryLater('The connection dropped during background sync');
    }

    if (attempted) await env.notify(summary);
    if (retryLater) throw new BackgroundSyncRetryLater('Some items could not be sent yet');
  });
}

/** The signed-in member's id, or null when the session cannot be renewed. */
async function currentMember(env: BackgroundSyncEnv): Promise<string | null> {
  let response: Response;
  try {
    response = await request(env, 'GET', '/auth/me');
  } catch {
    throw new BackgroundSyncRetryLater('No connection for background sync');
  }
  if (!response.ok) {
    // Signed out, or the refresh token has expired: nothing here can be sent
    // under this session, and retrying will not change that. The items wait
    // for the member's next sign-in, when the page drains them.
    if (response.status === 401 || response.status === 403) return null;
    throw new BackgroundSyncRetryLater(`Could not check the session (status ${response.status})`);
  }
  const data: unknown = await response.json().catch(() => null);
  return typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'string'
    ? (data as { id: string }).id
    : null;
}

async function send(
  env: BackgroundSyncEnv,
  path: string,
  body: unknown
): Promise<{ outcome: Outcome; status: number; response: Response }> {
  let response: Response;
  try {
    response = await request(env, 'POST', path, body);
  } catch {
    throw new ConnectionLost();
  }
  if (response.ok) return { outcome: 'sent', status: response.status, response };
  const refused = isNonRetryableHttpError({ response: { status: response.status } });
  return { outcome: refused ? 'refused' : 'retry', status: response.status, response };
}

/** One request with the session's cookies, renewing an expired token once. */
async function request(env: BackgroundSyncEnv, method: string, path: string, body?: unknown): Promise<Response> {
  const attempt = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const csrf = await env.csrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return env.fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };
  const response = await attempt();
  if (response.status !== 401) return response;
  return (await refreshSession(env)) ? attempt() : response;
}

async function refreshSession(env: BackgroundSyncEnv): Promise<boolean> {
  const headers: Record<string, string> = {};
  const csrf = await env.csrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await env.fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers });
  if (response.ok) return true;
  if (response.status !== 409) return false;
  const data: unknown = await response.json().catch(() => null);
  return typeof data === 'object' && data !== null && (data as { code?: unknown }).code === REFRESH_SUPERSEDED_CODE;
}

/** The server's reason, read the way toAppError reads FastAPI errors. */
async function refusalMessage(response: Response): Promise<string> {
  const fallback = 'The server did not accept this report.';
  const data: unknown = await response.json().catch(() => null);
  if (typeof data !== 'object' || data === null) return fallback;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail)) {
    const first: unknown = detail[0];
    if (typeof first === 'object' && first !== null && typeof (first as { msg?: unknown }).msg === 'string') {
      return (first as { msg: string }).msg;
    }
  }
  return fallback;
}
