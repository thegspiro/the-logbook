/**
 * NFC taps made without signal: what the put-away and shelf-audit screens
 * queue, and what the member is told when the queue finally sends them.
 *
 * Both go through the generic offline queue (`utils/genericOfflineQueue.ts`),
 * so they are counted in the pending-sync pill, drained by the app-wide sync
 * engine, and wiped by the logout purge on a shared device like everything
 * else queued there.
 *
 * What is stored is the raw read off each tag — the code written on it or its
 * serial — and never what the tag names. Nothing about the department's tags
 * is kept on the phone; the server decides what each tap means when it
 * arrives (`POST /inventory/nfc/put-away/replay`, `/nfc/audits/replay`).
 */

import toast from 'react-hot-toast';
import type { GenericQueueKind, GenericQueuedItem } from '../../../utils/genericOfflineQueue';
import type {
  InventoryNfcAuditReplayRequest,
  InventoryNfcAuditReplayResponse,
  InventoryNfcPutAwayReplayRequest,
  InventoryNfcPutAwayReplayResponse,
  InventoryNfcReplayTap,
} from '../types/nfc';

export const PUT_AWAY_REPLAY_URL = '/inventory/nfc/put-away/replay';
export const AUDIT_REPLAY_URL = '/inventory/nfc/audits/replay';

// How many refused or unread items a sync toast names before summarizing.
const NAMED_IN_TOAST = 3;

/** A new id for a queue entry, also the audit's resend-safe submission id. */
export function newOfflineId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

/** What a tap read, as the replay endpoints take it. */
export function replayTap(code: string | null, serial: string | null): InventoryNfcReplayTap {
  return { code: code || undefined, serial_number: serial || undefined };
}

/** A put-away session, held while the screen keeps adding taps to it. */
export function putAwaySessionItem(
  id: string,
  body: InventoryNfcPutAwayReplayRequest,
  queuedAt: number
): GenericQueuedItem {
  return {
    id,
    kind: 'nfc-put-away',
    url: PUT_AWAY_REPLAY_URL,
    body,
    label: `Put away: ${body.taps.length} tap${body.taps.length === 1 ? '' : 's'}`,
    queuedAt,
    retries: 0,
    held: true,
    updatedAt: Date.now(),
  };
}

/** A finished audit, ready to send. Its id is the audit's submission id. */
export function auditReplayItem(body: InventoryNfcAuditReplayRequest, shelfName: string | null): GenericQueuedItem {
  const now = Date.now();
  return {
    id: body.client_submission_id,
    kind: 'nfc-shelf-audit',
    url: AUDIT_REPLAY_URL,
    body,
    label: shelfName ? `Shelf audit: ${shelfName}` : 'Shelf audit',
    queuedAt: now,
    retries: 0,
  };
}

function isPutAwayResponse(data: unknown): data is InventoryNfcPutAwayReplayResponse {
  return typeof data === 'object' && data !== null && Array.isArray((data as { results?: unknown }).results);
}

function isAuditResponse(data: unknown): data is InventoryNfcAuditReplayResponse {
  return typeof data === 'object' && data !== null && 'not_saved_reason' in data;
}

function nameSome(names: string[]): string {
  const shown = names.slice(0, NAMED_IN_TOAST).join(', ');
  const more = names.length - NAMED_IN_TOAST;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/**
 * Tell the member what their offline taps did, once the server has applied
 * them. The only report there is: by then the screen that queued them may be
 * long closed, so a refusal the toast does not name is one nobody hears of.
 */
export function describeNfcSync(kind: GenericQueueKind, data: unknown): void {
  if (kind === 'nfc-put-away' && isPutAwayResponse(data)) {
    const refused = data.results.filter((r) => r.outcome === 'refused').map((r) => r.item_name ?? 'a storage area');
    const parts = [`${data.moved_count} put away`];
    if (data.unread_count > 0)
      parts.push(`${data.unread_count} tag${data.unread_count === 1 ? '' : 's'} not recognized`);
    const summary = `Offline put-away applied: ${parts.join(', ')}.`;
    if (refused.length > 0) {
      toast.error(`${summary} Not moved: ${nameSome(refused)}. Check them on the item pages.`, { duration: 10_000 });
    } else {
      toast.success(summary);
    }
    if (data.held_item_name) {
      toast(`${data.held_item_name} was tapped last with no shelf after it, so it was not moved.`, {
        duration: 10_000,
      });
    }
    return;
  }
  if (kind === 'nfc-shelf-audit' && isAuditResponse(data)) {
    if (!data.audit) {
      toast.error(`An offline shelf audit could not be saved: ${data.not_saved_reason ?? 'no shelf was tapped.'}`, {
        duration: 10_000,
      });
      return;
    }
    const a = data.audit;
    const notes: string[] = [];
    if (data.unread_count > 0)
      notes.push(`${data.unread_count} tag${data.unread_count === 1 ? '' : 's'} not recognized`);
    if (data.other_shelf_count > 0)
      notes.push(`${data.other_shelf_count} other-shelf tag${data.other_shelf_count === 1 ? '' : 's'} ignored`);
    toast.success(
      `Offline audit of ${a.storage_area_name} saved: ${a.found_count} found, ${a.missing_count} missing, ${a.unexpected_count} unexpected${notes.length > 0 ? ` (${notes.join('; ')})` : ''}.`,
      { duration: 8_000 }
    );
  }
}
