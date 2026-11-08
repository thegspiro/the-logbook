/**
 * Shared-device data purge (FE-6 / FE-7)
 *
 * Fire stations run on shared computers — whoever is on duty signs in on the
 * same browser profile. localStorage and IndexedDB are scoped to that profile,
 * not to the signed-in member, so anything left behind at logout is readable
 * by the next person to sit down.
 *
 * These stores hold member PII beyond the session:
 *   - shift-report and equipment-check drafts (localStorage): crew names,
 *     trainee evaluations, apparatus results, and narrative remarks
 *   - the offline queues (IndexedDB): unsent equipment checks *including photo
 *     blobs*, submitted shift reports, training submissions, and event RSVPs
 *   - offline skills testing (IndexedDB): unsent scorecards, and the copies of
 *     live tests, published sheets and recent candidates kept for scoring
 *     without signal. The one exception to purging: unsent scorecards (and
 *     the live-test copies they score into) are kept for their examiner, and
 *     only they can see or send them (owner decision 2026-11-01). An explicit
 *     Sign Out, after the warning in AppLayout, deletes the examiner's own;
 *     every automatic path — idle timeout, expired session, someone else
 *     signing in — keeps them, for HELD_EVALUATION_RETENTION_MS.
 *   - long-form drafts (sessionStorage, useSessionDraft): a training
 *     submission, an expense report, a new member's details, a shift report
 *   - saved department-store carts (localStorage): what a member meant to
 *     order, including any name they asked to have embroidered
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
import { clearAllSessionDrafts } from './sessionDrafts';
import { clearAllQueuedChecks } from './offlineQueue';
import { clearAllQueuedReports } from './shiftReportOfflineQueue';
import { clearAllGenericQueued } from './genericOfflineQueue';
import { clearAllEquipmentCheckDrafts } from './equipmentCheckDrafts';
import { purgeSkillsStores, releaseHeldSkillsEntries } from './skillsTestOfflineStore';
import { clearAllSavedCarts } from '../modules/storefront/utils/savedCart';

export interface PurgeResult {
  /** Shift-report and equipment-check drafts removed from device storage. */
  drafts: number;
  /** Unsent equipment checks discarded from IndexedDB. */
  queuedChecks: number;
  /** Unsent shift reports discarded from IndexedDB. */
  queuedReports: number;
  /** Unsent training submissions / event RSVPs discarded. */
  queuedGeneric: number;
  /** Unsent skills-test scorecards discarded. */
  queuedSkillsTests: number;
  /** Unsent skills-test scorecards kept on the device for their examiner. */
  heldSkillsTests: number;
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

export interface PurgeOptions {
  /**
   * The member who chose to sign out and confirmed that their own unsent
   * skills evaluations would be deleted. Omitted on every automatic path,
   * which keeps every examiner's for them.
   */
  discardSkillsFor?: string | null | undefined;
}

/**
 * Clear every device-local store that can hold member PII.
 *
 * Never throws and always settles: a purge failure must not be able to block
 * or break logout — a member stuck signed in on a shared terminal is strictly
 * worse than a failed cleanup.
 */
export async function purgeLocalMemberData(options: PurgeOptions = {}): Promise<PurgeResult> {
  const result: PurgeResult = {
    drafts: 0,
    queuedChecks: 0,
    queuedReports: 0,
    queuedGeneric: 0,
    queuedSkillsTests: 0,
    heldSkillsTests: 0,
    unsyncedDiscarded: 0,
  };

  try {
    result.drafts = clearAllDrafts();
  } catch {
    // localStorage can throw in private-browsing modes; keep going.
  }
  // Form drafts (useSessionDraft) live only as long as the tab, but a shared
  // station computer's tab can outlast the member who typed them.
  result.drafts += clearAllSessionDrafts();

  try {
    result.drafts += await bounded(clearAllEquipmentCheckDrafts(), 0);
  } catch {
    // IndexedDB may be unavailable; keep going with the remaining stores.
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

  try {
    const skills = await bounded(purgeSkillsStores(options.discardSkillsFor ?? null), { discarded: 0, held: 0 });
    result.queuedSkillsTests = skills.discarded;
    result.heldSkillsTests = skills.held;
  } catch {
    // As above.
  }

  // Not counted in the result: an unplaced cart is not work the member would
  // be warned about losing, and the store says nothing of it at sign-in.
  clearAllSavedCarts();

  // A mounted form can have an API request in flight when termination starts.
  // Sweep again after the asynchronous IndexedDB work so a late state update
  // cannot leave a localStorage draft behind for the next device user.
  try {
    result.drafts += clearAllDrafts();
  } catch {
    // localStorage may have become unavailable; the initial sweep still ran.
  }

  result.unsyncedDiscarded =
    result.queuedChecks + result.queuedReports + result.queuedGeneric + result.queuedSkillsTests;
  return result;
}

/**
 * A member has signed in: give them back the skills evaluations held for
 * them, and drop any held past retention. Never throws, like the purge — a
 * sign-in must not fail on a device store.
 */
export async function releaseHeldWorkFor(member: string): Promise<void> {
  try {
    await bounded(releaseHeldSkillsEntries(member), undefined);
  } catch {
    // IndexedDB may be unavailable; nothing is held there then either.
  }
}
