/**
 * useOfflineSyncEngine — drains the generic offline queue when the
 * device comes back online and refreshes the pending-sync count.
 *
 * Mounted once at the app root (AppLayout). Listens for browser
 * `online` events, processes the generic queue (training/RSVP), and
 * keeps the pending-sync store in sync. Equipment checks and shift
 * reports each have their own page-scoped sync flows, but their
 * counts are aggregated into the same store so the nav pill speaks
 * for the entire app.
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

let inFlight: Promise<void> | null = null;

/**
 * Drain the generic queue once. A call made while a drain is already running
 * gets that drain's promise, so a screen that must not act before its queued
 * work has been sent can await it rather than racing it.
 */
function drainGenericQueue(): Promise<void> {
  if (inFlight) return inFlight;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();
  inFlight = runDrain().finally(() => {
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

export function useOfflineSyncEngine(): void {
  const refresh = usePendingSyncStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
    const handleOnline = () => {
      void drainGenericQueue();
      void drainSkillsTests();
    };
    const handleSkillsQueued = () => {
      void usePendingSyncStore.getState().refresh();
      void drainSkillsTests();
    };
    // Eagerly try to drain on mount in case the page loaded with pending items already enqueued.
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void drainGenericQueue();
      void drainSkillsTests();
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener(SKILLS_OFFLINE_QUEUED_EVENT, handleSkillsQueued);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(SKILLS_OFFLINE_QUEUED_EVENT, handleSkillsQueued);
    };
  }, [refresh]);
}

/** Manually trigger a drain (e.g. from a "retry now" button). Exported for tests + UI. */
export const triggerOfflineDrain = drainGenericQueue;
