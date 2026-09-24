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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Box, ClipboardCheck, Loader2, Nfc, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { useTimezone } from '../../../hooks/useTimezone';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { ScanSuccessFlash } from '../../../components/ux/ScanSuccessFlash';
import { Breadcrumbs } from '../../../components/ux';
import { InventoryNfcAuditResult } from '../../../constants/enums';
import { parseInventoryTagCode } from '../../../constants/nfc';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useInventoryNfcEnabled } from '../hooks/useInventoryNfcEnabled';
import type { StorageAreaResponse } from '../types';
import {
  MAX_AUDIT_TAPS,
  type InventoryNfcAuditDetail,
  type InventoryNfcAuditLine,
  type InventoryNfcAuditSummary,
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedSerial, setTypedSerial] = useState('');

  const shelfRef = useRef<Shelf | null>(null);
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

  const loadRecent = useCallback(async () => {
    try {
      const response = await inventoryService.getNfcAudits({ limit: RECENT_AUDITS_SHOWN });
      setRecent(response.items);
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
    void loadRecent();
  }, [enabled, loadRecent]);

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
    const resolved = await inventoryService.resolveAnyNfcTag({
      code: input.code || undefined,
      serial_number: input.serial || undefined,
      // The audit logs every tap itself when it is saved.
      record: false,
    });
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
    if (current && current.id !== next.id && tappedRef.current.length > 0) {
      setError(`You are auditing ${current.name}. Finish or cancel that audit before starting ${next.name}.`);
      return;
    }
    if (!current || current.id !== next.id) signalScanSuccess();
    setShelf(next);
    setAudit(null);
  };

  const handleRef = useRef(handle);
  handleRef.current = handle;

  const enqueue = useCallback((input: Input) => {
    queueRef.current = queueRef.current.then(async () => {
      setBusy(true);
      try {
        await handleRef.current(input);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'That tap could not be read.'));
      } finally {
        setBusy(false);
      }
    });
  }, []);

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

  const finish = async () => {
    const current = shelfRef.current;
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
      void loadRecent();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the audit.'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (tappedRef.current.length > 0) {
      const ok = await confirm({
        title: 'Discard this audit?',
        message: `The ${tappedRef.current.length} item(s) tapped so far will not be recorded.`,
        confirmLabel: 'Discard audit',
        cancelLabel: 'Keep auditing',
      });
      if (!ok) return;
    }
    setTapped([]);
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
      void loadRecent();
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
          <section className="card space-y-3 p-4" aria-label="Audit in progress">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-theme-text-primary flex items-center gap-2 text-sm">
                <Box className="h-4 w-4" aria-hidden="true" />
                {shelf ? (
                  <span>
                    Auditing <strong>{shelf.name}</strong>: {tapped.length} item(s) tapped
                  </span>
                ) : (
                  <span className="text-theme-text-secondary">
                    No shelf chosen. Tap a shelf tag, or pick one below.
                  </span>
                )}
              </p>
              {shelf && (
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
