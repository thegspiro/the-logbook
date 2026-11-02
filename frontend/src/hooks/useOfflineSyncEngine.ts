/**
 * useOfflineSyncEngine — drains the generic offline queue when the
 * device comes back online and refreshes the pending-sync count.
 *
 * Mounted once at the app root (AppLayout). Listens for browser
 * `online` events, processes the generic queue (training/RSVP) and queued
 * shift reports, and keeps the pending-sync store in sync. Equipment checks
 * keep their page-scoped sync flow — it carries the photo-upload checkpoints
 * that stop evidence being filed twice — so the pill can only say where they
 * are waiting; their count is still aggregated into the same store so the nav
 * pill speaks for the entire app.
 *
 * Skills-test scoring has its own queue (`skillsTestOffline.ts`, which orders
 * create → save → complete per test and never drops a refused evaluation) and
 * is drained here too, on the same triggers plus whenever a screen queues
 * something while the browser believes it is online.
 */
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../services/apiClient';
import { flushOne, getGenericItem, isGenericSendable, listOwnGenericPending } from '../utils/genericOfflineQueue';
import { describeNfcSync } from '../modules/inventory/utils/nfcOfflineSync';
import { usePendingSyncStore } from '../stores/pendingSyncStore';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { SKILLS_OFFLINE_QUEUED_EVENT, drainSkillsQueue } from '../utils/skillsTestOffline';
import { SHIFT_REPORTS_SYNCED_EVENT, drainShiftReports } from '../utils/shiftReportSync';
import {
  BACKGROUND_SYNC_MESSAGE,
  withOfflineDrainLock,
  type BackgroundSyncSummary,
} from '../sw/backgroundSyncProtocol';
import { pendingCount as equipmentPendingCount } from '../utils/offlineQueue';

let inFlight: Promise<void> | null = null;

/**
 * Drain the generic queue once. A call made while a drain is already running
 * gets that drain's promise, so a screen that must not act before its queued
 * work has been sent can await it rather than racing it.
 */
function drainGenericQueue(): Promise<void> {
  if (inFlight) return inFlight;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();
  // Shared with the service worker's background sync; see shiftReportSync.ts.
  inFlight = withOfflineDrainLock(runDrain).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runDrain(): Promise<void> {
  const setStatus = usePendingSyncStore.getState().setStatus;
  const refresh = usePendingSyncStore.getState().refresh;
  try {
    // Only the signed-in member's own items. Another member's (left by a
    // sign-in purge that failed) and held ones (queued before owners were
    // recorded) stay where they are without holding up the rest (FE3-34-5).
    const items = (await listOwnGenericPending()).filter((item) => isGenericSendable(item));
    if (items.length === 0) return;
    setStatus('syncing');
    let succeeded = 0;
    let droppedRetries = 0;
    for (const item of items) {
      const ok = await flushOne(item, api, (data) => describeNfcSync(item.kind, data));
      if (ok) {
        succeeded += 1;
      } else if ((await getGenericItem(item.id)) === null) {
        // flushOne discards an item only once it has used its retries.
        droppedRetries += 1;
      }
    }
    if (succeeded > 0) {
      toast.success(succeeded === 1 ? 'Synced 1 pending item' : `Synced ${succeeded} pending items`);
    }
    if (droppedRetries > 0) {
      toast.error(
        droppedRetries === 1
          ? '1 pending item failed permanently and was discarded'
          : `${droppedRetries} pending items failed permanently and were discarded`
      );
    }
    setStatus(succeeded > 0 ? 'idle' : 'error');
  } catch (err) {
    setStatus('error', err instanceof Error ? err.message : 'Sync failed');
  } finally {
    void refresh();
  }
}

/**
 * Send queued skills-test work and tell the screen and the member what
 * happened. A refused evaluation is named — template and candidate — because
 * "1 item failed" is not enough to act on for a scored evaluation.
 */
export async function drainSkillsTests(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const result = await drainSkillsQueue(api);
    for (const synced of result.synced) {
      await useSkillsTestingStore.getState().handleSynced(synced.testId, synced.test, synced.completed);
    }
    if (result.synced.length > 0) {
      const n = result.synced.length;
      toast.success(n === 1 ? 'Synced 1 skills evaluation' : `Synced ${n} skills evaluations`);
    }
    for (const failed of result.failed) {
      await useSkillsTestingStore.getState().handleSynced(failed.testId, null, false);
      toast.error(`Not accepted: ${failed.label}. ${failed.message} It is still saved on this device.`, {
        duration: 10_000,
      });
    }
  } catch {
    // Retried on the next trigger.
  } finally {
    void usePendingSyncStore.getState().refresh();
  }
}

/**
 * Send queued shift reports and tell the member what happened. A refused
 * report is named by its shift date with the server's reason, and stays saved:
 * the device holds the only copy.
 */
async function drainShiftReportQueue(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const result = await drainShiftReports();
    if (result.synced > 0) {
      toast.success(
        result.synced === 1 ? 'Synced 1 offline shift report' : `Synced ${result.synced} offline shift reports`
      );
    }
    for (const refused of result.refused) {
      toast.error(
        `Shift report for ${refused.shiftDate} was not accepted: ${refused.message} It is still saved on this device.`,
        { duration: 10_000 }
      );
    }
  } catch {
    // Retried on the next trigger.
  } finally {
    void usePendingSyncStore.getState().refresh();
  }
}

function isBackgroundSyncSummary(data: unknown): data is BackgroundSyncSummary {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === BACKGROUND_SYNC_MESSAGE;
}

/**
 * The service worker sent queued work in the background (sw/backgroundSync.ts)
 * while this window was open: say so in the same words the page drains use,
 * refresh the pill, and let Shift Reports reload its list.
 */
function reportBackgroundSync(summary: BackgroundSyncSummary): void {
  const sent = summary.genericSynced + summary.shiftReportsSynced;
  if (sent > 0) {
    toast.success(
      sent === 1
        ? 'Sent 1 item saved on this device while you were offline'
        : `Sent ${sent} items saved on this device while you were offline`
    );
  }
  if (summary.genericDiscarded > 0) {
    toast.error(
      summary.genericDiscarded === 1
        ? '1 pending item failed permanently and was discarded'
        : `${summary.genericDiscarded} pending items failed permanently and were discarded`
    );
  }
  for (const refused of summary.shiftReportsRefused) {
    toast.error(
      `Shift report for ${refused.shiftDate} was not accepted: ${refused.message} It is still saved on this device.`,
      { duration: 10_000 }
    );
  }
  if (summary.shiftReportsSynced > 0) window.dispatchEvent(new Event(SHIFT_REPORTS_SYNCED_EVENT));
  void usePendingSyncStore.getState().refresh();
}

export function useOfflineSyncEngine(): void {
  const refresh = usePendingSyncStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
    const handleOnline = () => {
      void drainGenericQueue();
      void drainShiftReportQueue();
      void drainSkillsTests();
    };
    const handleSkillsQueued = () => {
      void usePendingSyncStore.getState().refresh();
      void drainSkillsTests();
    };
    // Eagerly try to drain on mount in case the page loaded with pending items already enqueued.
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void drainGenericQueue();
      void drainShiftReportQueue();
      void drainSkillsTests();
    }
    const handleWorkerMessage = (event: MessageEvent) => {
      if (isBackgroundSyncSummary(event.data)) reportBackgroundSync(event.data);
    };
    const workerMessages = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    window.addEventListener('online', handleOnline);
    window.addEventListener(SKILLS_OFFLINE_QUEUED_EVENT, handleSkillsQueued);
    workerMessages?.addEventListener('message', handleWorkerMessage);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(SKILLS_OFFLINE_QUEUED_EVENT, handleSkillsQueued);
      workerMessages?.removeEventListener('message', handleWorkerMessage);
    };
  }, [refresh]);
}

/**
 * Drain the generic queue only, awaitable. For a screen whose own queued work
 * must have gone before it acts (the NFC put-away screen prunes after it).
 */
export const triggerOfflineDrain = drainGenericQueue;

/**
 * Retry everything the "pending sync" pill counts. The pill used to call the
 * generic drain alone, so a queued shift report or skills evaluation it was
 * counting could not be sent from it. Equipment checks are sent only by their
 * own screen, so when any are left the member is told where to go.
 */
export async function triggerAllOfflineDrains(): Promise<void> {
  await Promise.all([drainGenericQueue(), drainShiftReportQueue(), drainSkillsTests()]);
  const equipment = await equipmentPendingCount().catch(() => 0);
  if (equipment > 0) {
    toast(
      equipment === 1
        ? '1 equipment check is saved on this device. Open the equipment check to send it.'
        : `${equipment} equipment checks are saved on this device. Open the equipment check to send them.`
    );
  }
}
