/**
 * Shelf Audit by NFC — `/inventory/shelf-audit`.
 *
 * Tap a shelf, then tap every item physically on it. Finishing compares the
 * taps with what the system records there and saves the audit:
 *
 * - **Found** — recorded here and tapped.
 * - **Missing** — recorded here, not tapped. Only ever listed: an audit never
 *   marks an item lost, because "not tapped this afternoon" is not evidence
 *   that it is gone.
 * - **Unexpected** — tapped here, recorded somewhere else. These can be moved
 *   onto the shelf, but only when the quartermaster ticks them and confirms;
 *   the move uses the same rule as every other put-away, so an item assigned
 *   to a member is refused with the reason rather than pulled onto a shelf.
 *
 * Taps are handled one after another, as on the put-away page, so a shelf tap
 * and the item tap straight after it cannot race.
 *
 * **Without signal** a tap cannot be identified, so its raw read is kept on
 * the page and shown as a count. If signal returns before the audit is
 * finished, the reads are identified then and the audit carries on as usual.
 * If it is finished without signal, the audit — the shelf if known, the items
 * already identified, and the raw reads — goes into the offline queue and is
 * saved by the server when the phone next has signal
 * (`utils/nfcOfflineSync.ts`). Reads are not kept anywhere until then: an
 * unfinished audit is not something to send on its own, because every item
 * not yet tapped would be reported missing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Box, ClipboardCheck, CloudOff, Loader2, Nfc, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { useTimezone } from '../../../hooks/useTimezone';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { ScanSuccessFlash } from '../../../components/ux/ScanSuccessFlash';
import { Breadcrumbs } from '../../../components/ux';
import { InventoryNfcAuditResult } from '../../../constants/enums';
import { AUDIT_FREQUENCY_LABELS, parseInventoryTagCode } from '../../../constants/nfc';
import { formatDate, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage, isNetworkError } from '../../../utils/errorHandling';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';
import { putGenericItem } from '../../../utils/genericOfflineQueue';
import { usePendingSyncStore } from '../../../stores/pendingSyncStore';
import { useInventoryNfcEnabled } from '../hooks/useInventoryNfcEnabled';
import { auditReplayItem, newOfflineId, replayTap } from '../utils/nfcOfflineSync';
import type { StorageAreaResponse } from '../types';
import {
  MAX_AUDIT_TAPS,
  type InventoryNfcAuditDetail,
  type InventoryNfcAuditLine,
  type InventoryAuditScheduleRow,
  type InventoryNfcAuditSummary,
  type InventoryNfcReplayTap,
} from '../types/nfc';

interface Shelf {
  id: string;
  name: string;
}

interface TappedItem {
  id: string;
  name: string;
  tagId: string | null;
}

type Input = { kind: 'tag'; code: string | null; serial: string | null } | { kind: 'shelf'; shelf: Shelf };

const RECENT_AUDITS_SHOWN = 10;

export const InventoryShelfAuditPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const { enabled, loading: loadingSwitch } = useInventoryNfcEnabled();
  const { flashing, signalScanSuccess } = useScanFeedback();

  const [areas, setAreas] = useState<StorageAreaResponse[]>([]);
  const [shelf, setShelfState] = useState<Shelf | null>(null);
  const [tapped, setTappedState] = useState<TappedItem[]>([]);
  const [audit, setAudit] = useState<InventoryNfcAuditDetail | null>(null);
  const [recent, setRecent] = useState<InventoryNfcAuditSummary[]>([]);
  const [schedule, setSchedule] = useState<InventoryAuditScheduleRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedSerial, setTypedSerial] = useState('');
  const isOnline = useOnlineStatus();
  const [offlineReadCount, setOfflineReadCount] = useState(0);

  const shelfRef = useRef<Shelf | null>(null);
  // Raw reads made without signal, identified when it returns.
  const offlineReadsRef = useRef<InventoryNfcReplayTap[]>([]);
  const tappedRef = useRef<TappedItem[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const setShelf = (next: Shelf | null) => {
    shelfRef.current = next;
    setShelfState(next);
  };
  const setTapped = (next: TappedItem[]) => {
    tappedRef.current = next;
    setTappedState(next);
  };
  const setOfflineReads = (next: InventoryNfcReplayTap[]) => {
    offlineReadsRef.current = next;
    setOfflineReadCount(next.length);
  };

  const keepOfflineRead = (code: string | null, serial: string | null) => {
    const read = replayTap(code, serial);
    const reads = offlineReadsRef.current;
    // The same tag read twice while held against the phone.
    if (reads.some((r) => r.code === read.code && r.serial_number === read.serial_number)) return;
    if (tappedRef.current.length + reads.length >= MAX_AUDIT_TAPS) {
      setError(`An audit holds up to ${MAX_AUDIT_TAPS} items. Finish this one and audit the rest separately.`);
      return;
    }
    setOfflineReads([...reads, read]);
    signalScanSuccess();
  };

  // Recent audits and the schedule, reloaded together: finishing an audit
  // changes both.
  const loadLists = useCallback(async () => {
    try {
      const [audits, scheduled] = await Promise.all([
        inventoryService.getNfcAudits({ limit: RECENT_AUDITS_SHOWN }),
        inventoryService.getAuditSchedule(),
      ]);
      setRecent(audits.items);
      setSchedule(scheduled.items);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load recent audits.'));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const load = async () => {
      try {
        const all = await inventoryService.getStorageAreas({ flat: true });
        setAreas(all.filter((a) => a.is_active));
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Could not load storage areas.'));
      }
    };
    void load();
    void loadLists();
  }, [enabled, loadLists]);

  const preselectId = searchParams.get('area');
  useEffect(() => {
    if (!preselectId || shelfRef.current) return;
    const area = areas.find((a) => a.id === preselectId);
    if (area) setShelf({ id: area.id, name: area.name });
  }, [preselectId, areas]);

  const handle = async (input: Input) => {
    setError(null);
    if (input.kind === 'shelf') {
      chooseShelf(input.shelf);
      return;
    }
    if (!navigator.onLine) {
      keepOfflineRead(input.code, input.serial);
      return;
    }
    let resolved;
    try {
      resolved = await inventoryService.resolveAnyNfcTag({
        code: input.code || undefined,
        serial_number: input.serial || undefined,
        // The audit logs every tap itself when it is saved.
        record: false,
      });
    } catch (err: unknown) {
      if (!isNetworkError(err)) throw err;
      keepOfflineRead(input.code, input.serial);
      return;
    }
    if (resolved.kind === 'storage_area' && resolved.storage_area) {
      chooseShelf({ id: resolved.storage_area.id, name: resolved.storage_area.name });
      return;
    }
    const item = resolved.item;
    if (!item) return;
    if (!shelfRef.current) {
      setError('Tap the shelf first, or pick it below, then tap the items on it.');
      return;
    }
    if (tappedRef.current.some((t) => t.id === item.id)) {
      // The same tag read twice while held against the phone.
      return;
    }
    if (tappedRef.current.length >= MAX_AUDIT_TAPS) {
      setError(`An audit holds up to ${MAX_AUDIT_TAPS} items. Finish this one and audit the rest separately.`);
      return;
    }
    setTapped([{ id: item.id, name: item.name, tagId: resolved.tag_id }, ...tappedRef.current]);
    signalScanSuccess();
  };

  const chooseShelf = (next: Shelf) => {
    const current = shelfRef.current;
    if (current && current.id !== next.id && tappedRef.current.length + offlineReadsRef.current.length > 0) {
      setError(`You are auditing ${current.name}. Finish or cancel that audit before starting ${next.name}.`);
      return;
    }
    if (!current || current.id !== next.id) signalScanSuccess();
    setShelf(next);
    setAudit(null);
  };

  const handleRef = useRef(handle);
  handleRef.current = handle;

  /**
   * Identify the reads kept while offline, now that there may be signal.
   *
   * Order is not held against them the way it is for a live tap: offline, the
   * screen could not say "tap the shelf first", so the first shelf among the
   * reads is chosen and every item read is kept, as the server does when it
   * saves an audit finished offline.
   */
  const identifyOfflineReads = async () => {
    const reads = offlineReadsRef.current;
    if (reads.length === 0 || !navigator.onLine) return;
    const stillOffline: InventoryNfcReplayTap[] = [];
    const items: TappedItem[] = [];
    let unread = 0;
    for (const read of reads) {
      try {
        const resolved = await inventoryService.resolveAnyNfcTag({
          code: read.code,
          serial_number: read.serial_number,
          record: false,
        });
        if (resolved.kind === 'storage_area' && resolved.storage_area) {
          if (!shelfRef.current) setShelf({ id: resolved.storage_area.id, name: resolved.storage_area.name });
        } else if (resolved.item) {
          items.push({ id: resolved.item.id, name: resolved.item.name, tagId: resolved.tag_id });
        }
      } catch (err: unknown) {
        if (isNetworkError(err)) stillOffline.push(read);
        else unread += 1;
      }
    }
    const known = new Set(tappedRef.current.map((t) => t.id));
    const added: TappedItem[] = [];
    for (const item of items) {
      if (known.has(item.id)) continue;
      known.add(item.id);
      added.unshift(item);
    }
    setTapped([...added, ...tappedRef.current]);
    setOfflineReads(stillOffline);
    if (unread > 0) {
      setError(`${unread} tag(s) read without signal are not linked to anything usable, and were left out.`);
    } else if (!shelfRef.current && added.length > 0) {
      setError('Tap the shelf these items are on, or pick it below, then finish the audit.');
    }
  };

  const identifyRef = useRef(identifyOfflineReads);
  identifyRef.current = identifyOfflineReads;

  const runQueued = useCallback((job: () => Promise<void>) => {
    const run = queueRef.current.then(async () => {
      setBusy(true);
      try {
        await job();
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'That tap could not be read.'));
      } finally {
        setBusy(false);
      }
    });
    queueRef.current = run;
    return run;
  }, []);

  const enqueue = useCallback((input: Input) => void runQueued(() => handleRef.current(input)), [runQueued]);

  useEffect(() => {
    if (isOnline) void runQueued(() => identifyRef.current());
  }, [isOnline, runQueued]);

  const onTag = useCallback(
    (tag: { serialNumber: string; payload: string | null }) => {
      const code = parseInventoryTagCode(tag.payload);
      const serial = tag.serialNumber.replace(/[^0-9A-Za-z]/g, '');
      if (!code && serial.length < 4) {
        setError('That tag could not be read. Hold the phone still against it and try again.');
        return;
      }
      enqueue({ kind: 'tag', code, serial: serial.length >= 4 ? serial : null });
    },
    [enqueue]
  );

  const { supported, scanning, error: scanError, unavailableReason, start, stop } = useNfcScanner({ onTag });
  useEffect(() => () => stop(), [stop]);

  const handleTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const serial = typedSerial.replace(/[^0-9A-Za-z]/g, '');
    if (serial.length < 4) {
      setError('Enter the tag’s serial number (at least 4 letters or digits).');
      return;
    }
    setTypedSerial('');
    enqueue({ kind: 'tag', code: null, serial });
  };

  /**
   * Finish without signal: the audit goes into the offline queue as it stands
   * and is saved when the phone next has signal. The page is cleared, as it
   * is after an audit saved online.
   */
  const queueOfflineAudit = async () => {
    const current = shelfRef.current;
    await putGenericItem(
      auditReplayItem(
        {
          client_submission_id: newOfflineId('audit'),
          storage_area_id: current?.id,
          tapped: tappedRef.current.map((t) => ({ item_id: t.id, tag_id: t.tagId ?? undefined })),
          taps: offlineReadsRef.current,
        },
        current?.name ?? null
      )
    );
    void usePendingSyncStore.getState().refresh();
    stop();
    setTapped([]);
    setOfflineReads([]);
    setShelf(null);
    toast.success(
      'No signal, so this audit is saved on this phone. It is recorded when there is signal, and you will be told the result.',
      { duration: 8_000 }
    );
  };

  const finish = async () => {
    // Reads kept offline are identified first if signal is back, so an audit
    // finished with signal is the ordinary one.
    await runQueued(() => identifyRef.current());
    const current = shelfRef.current;
    if (offlineReadsRef.current.length > 0 || !navigator.onLine) {
      if (!current && offlineReadsRef.current.length === 0) return;
      setSubmitting(true);
      setError(null);
      try {
        await queueOfflineAudit();
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Could not keep the audit on this phone.'));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!current) return;
    if (tappedRef.current.length === 0) {
      const ok = await confirm({
        title: 'Record this shelf as empty?',
        message: `No items were tapped. Finishing records that nothing was found on ${current.name}, and lists everything recorded there as missing.`,
        confirmLabel: 'Record as empty',
        cancelLabel: 'Keep tapping',
      });
      if (!ok) return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await inventoryService.createNfcAudit({
        storage_area_id: current.id,
        tapped: tappedRef.current.map((t) => ({ item_id: t.id, tag_id: t.tagId ?? undefined })),
      });
      stop();
      setAudit(result);
      setSelected(new Set());
      setTapped([]);
      setShelf(null);
      void loadLists();
    } catch (err: unknown) {
      if (isNetworkError(err)) {
        await queueOfflineAudit();
      } else {
        setError(getErrorMessage(err, 'Could not save the audit.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    const count = tappedRef.current.length + offlineReadsRef.current.length;
    if (count > 0) {
      const ok = await confirm({
        title: 'Discard this audit?',
        message: `The ${count} item(s) tapped so far will not be recorded.`,
        confirmLabel: 'Discard audit',
        cancelLabel: 'Keep auditing',
      });
      if (!ok) return;
    }
    setTapped([]);
    setOfflineReads([]);
    setShelf(null);
  };

  const openAudit = async (auditId: string) => {
    setError(null);
    try {
      const detail = await inventoryService.getNfcAudit(auditId);
      setAudit(detail);
      setSelected(new Set());
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load that audit.'));
    }
  };

  const applySelected = async () => {
    if (!audit || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await inventoryService.applyNfcAudit(audit.id, [...selected]);
      setAudit(result);
      setSelected(new Set());
      const moved = result.moved_item_ids?.length ?? 0;
      if (moved > 0) toast.success(`${moved} item(s) moved onto ${result.storage_area_name}`);
      void loadLists();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not move those items.'));
    } finally {
      setSubmitting(false);
    }
  };

  const areaOptions = useMemo(() => [...areas].sort((a, b) => a.name.localeCompare(b.name)), [areas]);

  if (loadingSwitch) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <ScanSuccessFlash active={flashing} />
      <Breadcrumbs underHub="/inventory/admin" />
      <Link
        to="/inventory/storage-areas"
        className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target justify-start gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Storage Areas
      </Link>

      <header>
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <ClipboardCheck className="h-5 w-5" /> Shelf Audit
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Tap a shelf, then tap every item on it. Finishing shows what is missing and what should not be there.
        </p>
      </header>

      {!enabled ? (
        <div className="alert-warning" role="status">
          NFC tag tracking is turned off for your department. An administrator can turn it on under{' '}
          <Link to="/inventory/admin/nfc" className="underline">
            Inventory Administration → NFC Tags
          </Link>
          .
        </div>
      ) : (
        <>
          {(!isOnline || offlineReadCount > 0) && (
            <section className="alert-warning space-y-1" aria-label="Offline audit" role="status">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CloudOff className="h-4 w-4" aria-hidden="true" />
                {isOnline ? 'Identifying tags read without signal…' : 'No signal: keep tapping'}
              </p>
              <p className="text-sm">
                Tags read now are identified when signal returns. Finishing without signal keeps the audit on this phone
                and records it later. Finish before closing this screen: an unfinished audit is not kept.
              </p>
            </section>
          )}

          <section className="card space-y-3 p-4" aria-label="Audit in progress">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-theme-text-primary flex items-center gap-2 text-sm">
                <Box className="h-4 w-4" aria-hidden="true" />
                {shelf ? (
                  <span>
                    Auditing <strong>{shelf.name}</strong>: {tapped.length} item(s) tapped
                    {offlineReadCount > 0 && `, ${offlineReadCount} tag(s) read without signal`}
                  </span>
                ) : offlineReadCount > 0 ? (
                  <span>
                    {offlineReadCount} tag(s) read without signal. The first shelf among them is the one audited.
                  </span>
                ) : (
                  <span className="text-theme-text-secondary">
                    No shelf chosen. Tap a shelf tag, or pick one below.
                  </span>
                )}
              </p>
              {(shelf || offlineReadCount > 0) && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => void cancel()}>
                    <X className="h-4 w-4" aria-hidden="true" /> Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => void finish()}
                    disabled={submitting || busy}
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    Finish audit
                  </button>
                </div>
              )}
            </div>

            {!shelf && (
              <div>
                <label className="form-label" htmlFor="audit-shelf">
                  Or pick a shelf
                </label>
                <select
                  id="audit-shelf"
                  className="form-input"
                  value=""
                  onChange={(e) => {
                    const area = areas.find((a) => a.id === e.target.value);
                    if (area) enqueue({ kind: 'shelf', shelf: { id: area.id, name: area.name } });
                  }}
                >
                  <option value="">Choose a storage area…</option>
                  {areaOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.location_name ? `${a.name} (${a.location_name})` : a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {supported ? (
              <button
                type="button"
                onClick={scanning ? stop : () => void start()}
                aria-pressed={scanning}
                className={`inline-flex w-full items-center justify-center gap-2 ${scanning ? 'btn-secondary' : 'btn-primary'}`}
              >
                <Nfc className={`h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true" />
                {scanning ? 'Listening for tags — tap to stop' : 'Start tapping tags'}
              </button>
            ) : (
              <p className="text-theme-text-muted text-xs">{unavailableReason}</p>
            )}

            <form onSubmit={handleTypedSubmit} className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="audit-serial">
                Tag serial number
              </label>
              <input
                id="audit-serial"
                type="text"
                className="form-input flex-1 font-mono uppercase"
                value={typedSerial}
                onChange={(e) => setTypedSerial(e.target.value)}
                placeholder="Tag serial (or USB reader)"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn-secondary" disabled={!typedSerial.trim()}>
                Enter
              </button>
            </form>

            {busy && (
              <p className="text-theme-text-muted flex items-center gap-2 text-xs" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Reading…
              </p>
            )}
            {(error || scanError) && (
              <div className="alert-danger flex items-start gap-2" role="alert">
                <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="text-theme-alert-danger-text text-sm">{error || scanError}</p>
              </div>
            )}

            {tapped.length > 0 && (
              <ul className="divide-theme-surface-border divide-y" aria-label="Items tapped">
                {tapped.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-theme-text-primary">{t.name}</span>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Remove ${t.name} from this audit`}
                      onClick={() => setTapped(tappedRef.current.filter((x) => x.id !== t.id))}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {audit && (
            <AuditResult
              audit={audit}
              tz={tz}
              selected={selected}
              onToggle={(itemId) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(itemId)) next.delete(itemId);
                  else next.add(itemId);
                  return next;
                })
              }
              onApply={() => void applySelected()}
              applying={submitting}
            />
          )}

          {schedule.length > 0 && (
            <section className="card p-4" aria-labelledby="audit-schedule-heading">
              <h2 id="audit-schedule-heading" className="text-theme-text-primary mb-2 text-sm font-semibold">
                Audit schedule ({schedule.filter((r) => r.overdue).length} due)
              </h2>
              <ul className="divide-theme-surface-border divide-y">
                {schedule.map((row) => (
                  <li
                    key={row.storage_area_id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="text-theme-text-primary">
                      <strong>{row.storage_area_name}</strong>
                      {row.location_name ? ` (${row.location_name})` : ''}
                      <span className="text-theme-text-secondary block text-xs">
                        {row.audit_frequency ? AUDIT_FREQUENCY_LABELS[row.audit_frequency] : ''} ·{' '}
                        {row.last_audited_at ? `last audited ${formatDate(row.last_audited_at, tz)}` : 'never audited'}
                        {' · '}
                        {row.overdue ? (
                          <span className="font-semibold text-red-700 dark:text-red-400">due now</span>
                        ) : (
                          `next due ${formatDate(row.next_due_at ?? '', tz)}`
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={row.overdue ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                      disabled={shelf !== null}
                      onClick={() =>
                        enqueue({ kind: 'shelf', shelf: { id: row.storage_area_id, name: row.storage_area_name } })
                      }
                    >
                      Audit now
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-4" aria-labelledby="recent-audits-heading">
            <h2 id="recent-audits-heading" className="text-theme-text-primary mb-2 text-sm font-semibold">
              Recent audits
            </h2>
            {recent.length === 0 ? (
              <p className="text-theme-text-muted text-sm">No shelves audited yet.</p>
            ) : (
              <ul className="divide-theme-surface-border divide-y">
                {recent.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-theme-text-primary">
                      <strong>{a.storage_area_name}</strong>{' '}
                      <span className="text-theme-text-secondary">
                        · {formatDateTime(a.audited_at, tz)}
                        {a.audited_by_name ? ` · ${a.audited_by_name}` : ''}
                      </span>
                      <span className="text-theme-text-secondary block text-xs">
                        {a.found_count} found · {a.missing_count} missing · {a.unexpected_count} unexpected
                      </span>
                    </span>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => void openAudit(a.id)}>
                      View
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

interface AuditResultProps {
  audit: InventoryNfcAuditDetail;
  tz: string;
  selected: Set<string>;
  onToggle: (itemId: string) => void;
  onApply: () => void;
  applying: boolean;
}

const AuditResult: React.FC<AuditResultProps> = ({ audit, tz, selected, onToggle, onApply, applying }) => {
  const byResult = (result: InventoryNfcAuditResult): InventoryNfcAuditLine[] =>
    audit.items.filter((line) => line.result === result);
  const missing = byResult(InventoryNfcAuditResult.MISSING);
  const unexpected = byResult(InventoryNfcAuditResult.UNEXPECTED);
  const found = byResult(InventoryNfcAuditResult.FOUND);
  const shelfGone = audit.storage_area_id === null;

  return (
    <section className="card space-y-4 p-4" aria-labelledby="audit-result-heading">
      <div>
        <h2 id="audit-result-heading" className="text-theme-text-primary text-lg font-semibold">
          {audit.storage_area_name}
        </h2>
        <p className="text-theme-text-secondary text-xs">
          Audited {formatDateTime(audit.audited_at, tz)}
          {audit.audited_by_name ? ` by ${audit.audited_by_name}` : ''}
          {audit.applied_at
            ? ` · items last moved ${formatDateTime(audit.applied_at, tz)}${audit.applied_by_name ? ` by ${audit.applied_by_name}` : ''}`
            : ''}
        </p>
        <p className="text-theme-text-primary mt-2 text-sm">
          {audit.found_count} of {audit.expected_count} expected found · {audit.missing_count} missing ·{' '}
          {audit.unexpected_count} unexpected
        </p>
      </div>

      {audit.skipped && audit.skipped.length > 0 && (
        <div className="alert-warning" role="status">
          <p className="text-sm font-medium">Not moved:</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {audit.skipped.map((s) => (
              <li key={s.item_id}>
                {s.name}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-theme-text-primary text-sm font-semibold">Missing ({missing.length})</h3>
        <p className="text-theme-text-muted text-xs">
          Recorded on this shelf but not tapped. Nothing has been marked lost; look for them first.
        </p>
        {missing.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {missing.map((line) => (
              <li key={line.id} className="text-theme-text-primary">
                {line.item_id ? <Link to={`/inventory/items/${line.item_id}`}>{line.item_name}</Link> : line.item_name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-theme-text-primary text-sm font-semibold">Unexpected ({unexpected.length})</h3>
        <p className="text-theme-text-muted text-xs">
          Tapped here but recorded somewhere else. Tick the ones that belong here to move them onto this shelf.
        </p>
        {unexpected.length > 0 && (
          <ul className="mt-1 space-y-1">
            {unexpected.map((line) => {
              const movable = !shelfGone && line.item_id !== null && !line.moved;
              const itemId = line.item_id ?? '';
              return (
                <li key={line.id} className="flex items-start gap-2 text-sm">
                  {movable ? (
                    <input
                      id={`audit-line-${line.id}`}
                      type="checkbox"
                      className="form-checkbox mt-0.5"
                      checked={selected.has(itemId)}
                      onChange={() => onToggle(itemId)}
                    />
                  ) : (
                    <span className="w-4" aria-hidden="true" />
                  )}
                  <label htmlFor={movable ? `audit-line-${line.id}` : undefined} className="text-theme-text-primary">
                    {line.item_name}{' '}
                    <span className="text-theme-text-secondary">
                      {line.moved
                        ? '· moved here'
                        : `· recorded on ${line.recorded_storage_area_name ?? 'no storage area'}`}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {unexpected.some((line) => line.item_id !== null && !line.moved) && !shelfGone && (
          <button
            type="button"
            className="btn-primary mt-2"
            onClick={onApply}
            disabled={selected.size === 0 || applying}
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Move {selected.size} selected onto {audit.storage_area_name}
          </button>
        )}
      </div>

      <details>
        <summary className="text-theme-text-primary cursor-pointer text-sm font-semibold">
          Found ({found.length})
        </summary>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {found.map((line) => (
            <li key={line.id} className="text-theme-text-primary">
              {line.item_name}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
};

export default InventoryShelfAuditPage;
