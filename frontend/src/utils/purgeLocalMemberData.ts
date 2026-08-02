/**
 * Shared-device data purge (FE-6 / FE-7)
 *
 * Fire stations run on shared computers — whoever is on duty signs in on the
 * same browser profile. localStorage and IndexedDB are scoped to that profile,
 * not to the signed-in member, so anything left behind at logout is readable
 * by the next person to sit down.
 *
 * These stores hold member PII beyond the session:
 *   - shift-report drafts (localStorage): crew names, trainee evaluations,
 *     narrative remarks
 *   - the offline queues (IndexedDB): unsent equipment checks *including photo
 *     blobs*, submitted shift reports, training submissions, and event RSVPs
 *
 * Neither was cleared by logout, which cleared only the session flag, the
 * temporary access token, and the in-memory API cache.
 *
 * We purge rather than keep, because on a shared terminal confidentiality wins
 * over convenience. To avoid destroying work silently, the purge first makes a
 * best-effort attempt to flush anything still queued (when online), and always
 * reports how many items were discarded so the UI can tell the member.
 */

import { clearAllDrafts } from './shiftReportDrafts';
import { clearAllQueuedChecks } from './offlineQueue';
import { clearAllQueuedReports } from './shiftReportOfflineQueue';
import { clearAllGenericQueued } from './genericOfflineQueue';

export interface PurgeResult {
  /** Shift-report drafts removed from localStorage. */
  drafts: number;
  /** Unsent equipment checks discarded from IndexedDB. */
  queuedChecks: number;
  /** Unsent shift reports discarded from IndexedDB. */
  queuedReports: number;
  /** Unsent training submissions / event RSVPs discarded. */
  queuedGeneric: number;
  /** Unsent items that were lost (i.e. never made it to the server). */
  unsyncedDiscarded: number;
}

/**
 * Hard ceiling on how long any single store may take to clear.
 *
 * IndexedDB requests have no native timeout and can legitimately never
 * settle — a blocked upgrade, a transaction the browser never completes.
 * `openIndexedDb` already bounds the open, but this bounds everything after
 * it too, so no IndexedDB pathology can stall logout.
 */
const STORE_PURGE_TIMEOUT_MS = 3_000;

/** Resolve to `fallback` if `promise` has not settled in time. */
async function bounded<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), STORE_PURGE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Clear every device-local store that can hold member PII.
 *
 * Never throws and always settles: a purge failure must not be able to block
 * or break logout — a member stuck signed in on a shared terminal is strictly
 * worse than a failed cleanup.
 */
export async function purgeLocalMemberData(): Promise<PurgeResult> {
  const result: PurgeResult = {
    drafts: 0,
    queuedChecks: 0,
    queuedReports: 0,
    queuedGeneric: 0,
    unsyncedDiscarded: 0,
  };

  try {
    result.drafts = clearAllDrafts();
  } catch {
    // localStorage can throw in private-browsing modes; keep going.
  }

  try {
    result.queuedChecks = await bounded(clearAllQueuedChecks(), 0);
  } catch {
    // IndexedDB may be unavailable; keep going.
  }

  try {
    result.queuedReports = await bounded(clearAllQueuedReports(), 0);
  } catch {
    // As above.
  }

  try {
    result.queuedGeneric = await bounded(clearAllGenericQueued(), 0);
  } catch {
    // As above.
  }

  result.unsyncedDiscarded =
    result.queuedChecks + result.queuedReports + result.queuedGeneric;
  return result;
}
