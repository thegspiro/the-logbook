/**
 * The names the page and the service worker must agree on for background sync.
 *
 * Kept free of runtime imports so both sides can share it: the page registers
 * the tag and takes the lock, and the worker answers the tag, takes the same
 * lock and posts the message the page listens for.
 */

import type { SkillTest } from '../types/skillsTesting';

/** The Background Sync tag registered whenever an item is queued. */
export const BACKGROUND_SYNC_TAG = 'logbook-offline-sync';

/**
 * Web Lock held by every drain of the offline queues, in a page or in the
 * worker, so the two never send the same item at once. The equipment check
 * form also holds it while it uploads a just-submitted check's photos, which
 * it queues first in case an upload fails.
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
  // The four below are optional only because a worker installed before they
  // existed can still be running when a newer page loads; this worker always
  // sends them, and a page reads each with a fallback.
  /** Queue ids of equipment checks sent, photos and all. */
  equipmentChecksSynced?: string[];
  /** Queue ids of equipment checks discarded after their last refusal. */
  equipmentChecksDiscarded?: string[];
  /** Skills evaluations sent, with the server's copy for a screen showing it. */
  skillsSynced?: SkillsSyncedNotice[];
  /** Skills evaluations the server refused; still saved on the device. */
  skillsFailed?: SkillsFailedNotice[];
}

export interface SkillsSyncedNotice {
  testId: string;
  test: SkillTest | null;
  completed: boolean;
}

export interface SkillsFailedNotice {
  testId: string;
  label: string;
  message: string;
}

/** Whether a message posted by the worker is a background sync's summary. */
export function isBackgroundSyncSummary(data: unknown): data is BackgroundSyncSummary {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === BACKGROUND_SYNC_MESSAGE;
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
