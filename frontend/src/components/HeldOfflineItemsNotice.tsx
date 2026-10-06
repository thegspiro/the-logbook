/**
 * Offline items held for review (FE3-34-5).
 *
 * Items queued on this device before each entry recorded who queued it are
 * never sent automatically — on a shared station they may be another
 * member's — so they would otherwise sit in IndexedDB forever with nothing on
 * screen to say so. This notice is the only way to release or remove them.
 * It is mounted once in the app shell, beside the sync engine that holds
 * them, and renders nothing while nothing is held.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { triggerOfflineDrain } from '../hooks/useOfflineSyncEngine';
import { useAuthStore } from '../stores/authStore';
import { usePendingSyncStore } from '../stores/pendingSyncStore';
import { getErrorMessage } from '../utils/errorHandling';
import {
  discardHeldItems,
  HELD_ITEM_KIND_LABELS,
  listHeldOfflineItems,
  sendHeldItemsAsMe,
  type HeldItemKind,
  type HeldOfflineItem,
} from '../utils/offlineQueueQuarantine';

function plural(count: number, noun: { one: string; many: string }): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

function summarize(items: HeldOfflineItem[]): string {
  const counts = new Map<HeldItemKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return Array.from(counts, ([kind, count]) => plural(count, HELD_ITEM_KIND_LABELS[kind])).join(', ');
}

export const HeldOfflineItemsNotice: React.FC = () => {
  const heldCount = usePendingSyncStore((s) => s.heldCount);
  const refresh = usePendingSyncStore((s) => s.refresh);
  const user = useAuthStore((s) => s.user);
  const { confirm } = useConfirm();
  const [items, setItems] = useState<HeldOfflineItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (heldCount === 0) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void listHeldOfflineItems().then((list) => {
      if (!cancelled) setItems(list);
    });
    return () => {
      cancelled = true;
    };
  }, [heldCount]);

  const summary = useMemo(() => summarize(items), [items]);

  if (items.length === 0) return null;

  const memberName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'you';
  const sentFromTheirPage = items.some((item) => item.queue !== 'generic');

  const handleSend = async () => {
    const ok = await confirm({
      title: 'Send these as yours?',
      message: (
        <>
          <p>
            {summary} will be sent under your name, {memberName}, exactly as if you had submitted them.
          </p>
          <p className="mt-2">
            Only do this if you saved them yourself. This device cannot tell who did — if another member did, their work
            will be recorded as yours.
          </p>
          {sentFromTheirPage && (
            <p className="mt-2">
              Equipment checks and shift reports are sent the next time you open their page with a connection.
            </p>
          )}
        </>
      ),
      confirmLabel: 'Send as me',
      cancelLabel: 'Keep on hold',
      variant: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const claimed = await sendHeldItemsAsMe(items);
      toast.success(
        claimed === 1 ? '1 held item will be sent as yours' : `${claimed} held items will be sent as yours`
      );
      void triggerOfflineDrain();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not release the held items'));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard held items?',
      message: (
        <p>
          {summary} will be deleted from this device and never sent. Whoever saved them will not be told, and this
          cannot be undone.
        </p>
      ),
      confirmLabel: 'Discard',
      cancelLabel: 'Keep on hold',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await discardHeldItems(items);
      toast.success('Held items discarded');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not discard the held items'));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <section aria-labelledby="held-offline-items-title" className="alert-warning flex items-start gap-3 text-sm">
        <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="held-offline-items-title" className="text-theme-alert-warning-title font-semibold">
            {items.length === 1 ? '1 offline item is on hold' : `${items.length} offline items are on hold`}
          </h2>
          <p className="text-theme-alert-warning-text mt-1">
            Saved on this device before it recorded who saved them: {summary}. They have not been sent, because they may
            belong to another member who used this device.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void handleSend()}>
              Send as me
            </button>
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void handleDiscard()}>
              Discard
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
