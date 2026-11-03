/**
 * Sends shift reports queued offline.
 *
 * This lived in ShiftReportsTab, so a report queued without signal went
 * nowhere until the officer reopened that page while online — and the
 * "N pending sync" pill, which counted it, could not send it either. The sync
 * engine now drains it on the same triggers as the other queues: on load, on
 * reconnect, and from the pill.
 *
 * A report is never discarded here. It carries a crew's hours, calls and
 * trainee evaluations, and the device holds the only copy. A report the server
 * keeps refusing is instead counted and, from the third refusal, named with
 * the server's reason, so the officer learns why it is not going anywhere
 * rather than watching the pill sit at one forever.
 */

import { shiftCompletionService } from '../services/api';
import { getErrorMessage, isNetworkError, isNonRetryableHttpError } from './errorHandling';
import { isOwnedByCurrentMember } from './offlineQueueOwner';
import { dequeueShiftReport, listOwnPendingReports, markReportRetry } from './shiftReportOfflineQueue';
import { SHIFT_REPORT_REFUSALS_BEFORE_NOTICE } from './shiftReportOfflineStore';
import { withOfflineDrainLock } from '../sw/backgroundSyncProtocol';

export { SHIFT_REPORT_REFUSALS_BEFORE_NOTICE };

/** Dispatched after a drain sends at least one report, for screens listing them. */
export const SHIFT_REPORTS_SYNCED_EVENT = 'logbook:shift-reports-synced';

export interface RefusedShiftReport {
  id: string;
  shiftDate: string;
  message: string;
}

export interface ShiftReportDrainResult {
  synced: number;
  refused: RefusedShiftReport[];
}

let inFlight: Promise<ShiftReportDrainResult> | null = null;

/**
 * Send the signed-in member's queued reports once. A call made while a drain
 * is running gets that drain's result: the engine and a screen reacting to the
 * same reconnect must not post the same report twice.
 */
export function drainShiftReports(): Promise<ShiftReportDrainResult> {
  if (inFlight) return inFlight;
  // The lock is shared with the service worker's background sync, so a page
  // drain and a worker drain never post the same report at once.
  inFlight = withOfflineDrainLock(runDrain).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runDrain(): Promise<ShiftReportDrainResult> {
  const result: ShiftReportDrainResult = { synced: 0, refused: [] };
  // Only this member's own reports go out under their session (FE3-34-5).
  for (const entry of await listOwnPendingReports()) {
    // Asked again per entry: the member can change while earlier ones send.
    if (!isOwnedByCurrentMember(entry)) continue;
    try {
      await shiftCompletionService.batchCreateReports(entry.payload);
      await dequeueShiftReport(entry.id);
      result.synced += 1;
    } catch (err) {
      // An outage says nothing about the report; only a refusal is counted.
      if (isNetworkError(err) || !isNonRetryableHttpError(err)) continue;
      const message = getErrorMessage(err, 'The server did not accept this report.');
      const refusals = await markReportRetry(entry.id, message);
      if (refusals >= SHIFT_REPORT_REFUSALS_BEFORE_NOTICE) {
        result.refused.push({ id: entry.id, shiftDate: entry.payload.shift_date, message });
      }
    }
  }
  if (result.synced > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SHIFT_REPORTS_SYNCED_EVENT));
  }
  return result;
}
