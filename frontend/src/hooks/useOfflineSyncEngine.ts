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
 */
import { useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../services/apiClient';
import {
  flushOne,
  listGenericPending,
  GENERIC_QUEUE_MAX_RETRIES,
} from '../utils/genericOfflineQueue';
import { usePendingSyncStore } from '../stores/pendingSyncStore';

let draining = false;

async function drainGenericQueue(): Promise<void> {
  if (draining || typeof navigator !== 'undefined' && !navigator.onLine) return;
  draining = true;
  const setStatus = usePendingSyncStore.getState().setStatus;
  const refresh = usePendingSyncStore.getState().refresh;
  try {
    const items = await listGenericPending();
    if (items.length === 0) return;
    setStatus('syncing');
    let succeeded = 0;
    let droppedRetries = 0;
    for (const item of items) {
      const ok = await flushOne(item, api);
      if (ok) {
        succeeded += 1;
      } else if (item.retries + 1 >= GENERIC_QUEUE_MAX_RETRIES) {
        droppedRetries += 1;
      }
    }
    if (succeeded > 0) {
      toast.success(
        succeeded === 1 ? 'Synced 1 pending item' : `Synced ${succeeded} pending items`,
      );
    }
    if (droppedRetries > 0) {
      toast.error(
        droppedRetries === 1
          ? '1 pending item failed permanently and was discarded'
          : `${droppedRetries} pending items failed permanently and were discarded`,
      );
    }
    setStatus(succeeded > 0 ? 'idle' : 'error');
  } catch (err) {
    setStatus('error', err instanceof Error ? err.message : 'Sync failed');
  } finally {
    draining = false;
    void refresh();
  }
}

export function useOfflineSyncEngine(): void {
  const refresh = usePendingSyncStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
    const handleOnline = () => {
      void drainGenericQueue();
    };
    // Eagerly try to drain on mount in case the page loaded with pending items already enqueued.
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void drainGenericQueue();
    }
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [refresh]);
}

/** Manually trigger a drain (e.g. from a "retry now" button). Exported for tests + UI. */
export const triggerOfflineDrain = drainGenericQueue;
