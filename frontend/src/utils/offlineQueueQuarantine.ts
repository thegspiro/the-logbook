/**
 * Offline items held for review (FE3-34-5).
 *
 * An entry queued before owners were recorded cannot be attributed: on a
 * shared station it may be the signed-in member's, or it may be the previous
 * member's, left behind by a sign-in purge that silently failed. Sending it
 * automatically would file the previous member's work under whoever is signed
 * in now, so it is held instead, and the signed-in member decides — send it
 * as theirs, or discard it.
 *
 * Only the kind of each item and when it was queued are listed. Whose work it
 * is, is exactly what is unknown, so nothing from its payload is shown.
 */

import { claimUntaggedCheck, dequeueCheck, listPendingChecks } from './offlineQueue';
import { claimUntaggedReport, dequeueShiftReport, listPendingReports } from './shiftReportOfflineQueue';
import { claimUntaggedGeneric, dequeueGeneric, listGenericPending, type GenericQueueKind } from './genericOfflineQueue';
import { isUntagged, requireQueueOwner } from './offlineQueueOwner';

export type HeldItemKind = 'equipment-check' | 'shift-report' | GenericQueueKind;

export interface HeldOfflineItem {
  queue: 'check' | 'report' | 'generic';
  id: string;
  kind: HeldItemKind;
  queuedAt: number;
}

export const HELD_ITEM_KIND_LABELS: Record<HeldItemKind, { one: string; many: string }> = {
  'equipment-check': { one: 'equipment check', many: 'equipment checks' },
  'shift-report': { one: 'shift report', many: 'shift reports' },
  'training-submission': { one: 'training submission', many: 'training submissions' },
  'event-rsvp': { one: 'event RSVP', many: 'event RSVPs' },
  'nfc-put-away': { one: 'NFC put-away', many: 'NFC put-aways' },
  'nfc-shelf-audit': { one: 'shelf audit', many: 'shelf audits' },
};

/** Each queue is read on its own so one unreadable store hides only itself. */
async function orEmpty<T>(read: Promise<T[]>): Promise<T[]> {
  try {
    return await read;
  } catch {
    return [];
  }
}

/** Every held item across the three queues, oldest first. */
export async function listHeldOfflineItems(): Promise<HeldOfflineItem[]> {
  const [checks, reports, generic] = await Promise.all([
    orEmpty(listPendingChecks()),
    orEmpty(listPendingReports()),
    orEmpty(listGenericPending()),
  ]);
  const held: HeldOfflineItem[] = [
    ...checks
      .filter(isUntagged)
      .map((e) => ({ queue: 'check' as const, id: e.id, kind: 'equipment-check' as const, queuedAt: e.queuedAt })),
    ...reports
      .filter(isUntagged)
      .map((e) => ({ queue: 'report' as const, id: e.id, kind: 'shift-report' as const, queuedAt: e.queuedAt })),
    ...generic
      .filter(isUntagged)
      .map((e) => ({ queue: 'generic' as const, id: e.id, kind: e.kind, queuedAt: e.queuedAt })),
  ];
  return held.sort((a, b) => a.queuedAt - b.queuedAt);
}

/**
 * Give held items to the signed-in member, so the queues send them as theirs.
 *
 * Returns how many were claimed; an item claimed or removed meanwhile (in
 * another tab, say) is skipped rather than reassigned.
 */
export async function sendHeldItemsAsMe(items: HeldOfflineItem[]): Promise<number> {
  const ownerId = requireQueueOwner();
  let claimed = 0;
  for (const item of items) {
    const ok =
      item.queue === 'check'
        ? await claimUntaggedCheck(item.id, ownerId)
        : item.queue === 'report'
          ? await claimUntaggedReport(item.id, ownerId)
          : await claimUntaggedGeneric(item.id, ownerId);
    if (ok) claimed += 1;
  }
  return claimed;
}

/** Delete held items from this device without sending them. */
export async function discardHeldItems(items: HeldOfflineItem[]): Promise<void> {
  for (const item of items) {
    if (item.queue === 'check') await dequeueCheck(item.id);
    else if (item.queue === 'report') await dequeueShiftReport(item.id);
    else await dequeueGeneric(item.id);
  }
}
