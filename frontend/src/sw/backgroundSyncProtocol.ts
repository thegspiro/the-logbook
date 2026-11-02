/**
 * The names the page and the service worker must agree on for background sync.
 *
 * Kept free of imports so both sides can share it: the page registers the tag
 * and takes the lock, and the worker answers the tag, takes the same lock and
 * posts the message the page listens for.
 */

/** The Background Sync tag registered whenever an item is queued. */
export const BACKGROUND_SYNC_TAG = 'logbook-offline-sync';

/**
 * Web Lock held by every drain of the generic and shift-report queues, in a
 * page or in the worker, so the two never send the same item at once.
 */
export const OFFLINE_DRAIN_LOCK = 'logbook-offline-drain';

/** `type` of the message the worker posts to open windows after a sync. */
export const BACKGROUND_SYNC_MESSAGE = 'logbook-background-sync';

export interface RefusedShiftReportNotice {
  shiftDate: string;
  message: string;
}

/** What a background sync did, posted to every open window of the app. */
export interface BackgroundSyncSummary {
  type: typeof BACKGROUND_SYNC_MESSAGE;
  /** Generic-queue items (training submissions, RSVPs, NFC sessions) sent. */
  genericSynced: number;
  /** Generic-queue items discarded after their last permanent refusal. */
  genericDiscarded: number;
  shiftReportsSynced: number;
  /** Reports refused often enough to be named; still saved on the device. */
  shiftReportsRefused: RefusedShiftReportNotice[];
}

/**
 * Run `fn` while holding the drain lock, where the browser has Web Locks.
 *
 * Without them (Safari before 15.4) there is no service-worker sync either,
 * since no such browser supports Background Sync, so a page drain cannot meet
 * a worker drain and running unlocked is safe.
 */
export async function withOfflineDrainLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request(OFFLINE_DRAIN_LOCK, fn);
}
