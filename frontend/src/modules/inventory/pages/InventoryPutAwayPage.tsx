/**
 * Put Away by NFC — `/inventory/put-away`.
 *
 * Records where items physically are by tapping their tags against a shelf's.
 * Both orders work, and they mean different things:
 *
 * - **Shelf first** opens that shelf: every item tapped afterwards goes onto
 *   it, until another shelf is tapped or the shelf is closed. This is for
 *   stocking a whole bin.
 * - **Item first** holds the item until a shelf is tapped, moves it there, and
 *   does *not* open the shelf. This is for one stray item, and the next item
 *   tapped waits for its own shelf rather than silently following.
 *
 * Taps are handled strictly one after another. Two quick taps would otherwise
 * both read "no shelf open" before the first had opened one, and the second
 * item would be held instead of put away.
 *
 * A typed box sits beside the reader for a USB NFC reader at a desk, and a
 * shelf can be picked from a list, so the page is usable without Web NFC.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Box, Check, Loader2, Nfc, Package, X } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { ScanSuccessFlash } from '../../../components/ux/ScanSuccessFlash';
import { Breadcrumbs } from '../../../components/ux';
import { parseInventoryTagCode } from '../../../constants/nfc';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useInventoryNfcEnabled } from '../hooks/useInventoryNfcEnabled';
import type { StorageAreaResponse } from '../types';
import type { InventoryNfcPutAwayResponse } from '../types/nfc';

interface Shelf {
  id: string;
  name: string;
}

interface HeldItem {
  id: string;
  name: string;
  tagId: string | null;
}

/** What a tap, a typed serial, or a picked shelf amounts to. */
type Input = { kind: 'tag'; code: string | null; serial: string | null } | { kind: 'shelf'; shelf: Shelf };

const RECENT_MOVES_SHOWN = 20;

export const InventoryPutAwayPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { enabled, loading: loadingSwitch } = useInventoryNfcEnabled();
  const { flashing, signalScanSuccess } = useScanFeedback();

  const [areas, setAreas] = useState<StorageAreaResponse[]>([]);
  const [openShelf, setOpenShelf] = useState<Shelf | null>(null);
  const [heldItem, setHeldItem] = useState<HeldItem | null>(null);
  const [moves, setMoves] = useState<InventoryNfcPutAwayResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedSerial, setTypedSerial] = useState('');

  // The queue reads these rather than state: a tap handled after another must
  // see what the previous one decided, not what was rendered before either.
  const openShelfRef = useRef<Shelf | null>(null);
  const heldItemRef = useRef<HeldItem | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const setShelf = (shelf: Shelf | null) => {
    openShelfRef.current = shelf;
    setOpenShelf(shelf);
  };
  const setHeld = (item: HeldItem | null) => {
    heldItemRef.current = item;
    setHeldItem(item);
  };

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
  }, [enabled]);

  // `?area=` is where a shelf's written tag lands: the tag page sends an
  // inventory manager here with that shelf already open.
  const preselectId = searchParams.get('area');
  useEffect(() => {
    if (!preselectId || openShelfRef.current) return;
    const area = areas.find((a) => a.id === preselectId);
    if (area) setShelf({ id: area.id, name: area.name });
  }, [preselectId, areas]);

  const putAway = async (item: HeldItem, shelf: Shelf) => {
    const result = await inventoryService.putAwayItem({
      item_id: item.id,
      storage_area_id: shelf.id,
      item_tag_id: item.tagId ?? undefined,
    });
    setMoves((prev) => [result, ...prev].slice(0, RECENT_MOVES_SHOWN));
    signalScanSuccess();
  };

  const handle = async (input: Input) => {
    setError(null);
    let shelf: Shelf | null = null;
    let item: HeldItem | null = null;

    if (input.kind === 'shelf') {
      shelf = input.shelf;
    } else {
      const resolved = await inventoryService.resolveAnyNfcTag({
        code: input.code || undefined,
        serial_number: input.serial || undefined,
        record: false,
      });
      if (resolved.kind === 'storage_area' && resolved.storage_area) {
        shelf = { id: resolved.storage_area.id, name: resolved.storage_area.name };
      } else if (resolved.item) {
        item = { id: resolved.item.id, name: resolved.item.name, tagId: resolved.tag_id };
      }
    }

    if (shelf) {
      const held = heldItemRef.current;
      if (held) {
        // Item first: a one-off move. The shelf is not opened.
        setHeld(null);
        await putAway(held, shelf);
      } else {
        setShelf(shelf);
        signalScanSuccess();
      }
      return;
    }
    if (item) {
      const open = openShelfRef.current;
      if (open) {
        await putAway(item, open);
      } else {
        setHeld(item);
        signalScanSuccess();
      }
    }
  };

  const handleRef = useRef(handle);
  handleRef.current = handle;

  const enqueue = useCallback((input: Input) => {
    queueRef.current = queueRef.current.then(async () => {
      setBusy(true);
      try {
        await handleRef.current(input);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'That tap could not be recorded.'));
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
          <Nfc className="h-5 w-5" /> Put Away by NFC
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Tap a shelf, then tap each item you put on it. Or tap one item, then the shelf it goes on.
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
          <section className="card space-y-3 p-4" aria-label="Current shelf and item">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-theme-text-primary flex items-center gap-2 text-sm">
                <Box className="h-4 w-4" aria-hidden="true" />
                {openShelf ? (
                  <span>
                    Items tapped now go on <strong>{openShelf.name}</strong>
                  </span>
                ) : (
                  <span className="text-theme-text-secondary">No shelf open. Tap a shelf tag, or pick one below.</span>
                )}
              </p>
              {openShelf && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setShelf(null)}>
                  Close shelf
                </button>
              )}
            </div>

            {heldItem && (
              <div className="alert-info flex flex-wrap items-center justify-between gap-2" role="status">
                <span className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4" aria-hidden="true" />
                  <span>
                    <strong>{heldItem.name}</strong>: now tap the shelf it goes on.
                  </span>
                </span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setHeld(null)}>
                  <X className="h-4 w-4" aria-hidden="true" /> Cancel
                </button>
              </div>
            )}

            <div>
              <label className="form-label" htmlFor="put-away-shelf">
                Or pick a shelf
              </label>
              <select
                id="put-away-shelf"
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
              <label className="sr-only" htmlFor="put-away-serial">
                Tag serial number
              </label>
              <input
                id="put-away-serial"
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
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Recording…
              </p>
            )}
            {(error || scanError) && (
              <div className="alert-danger flex items-start gap-2" role="alert">
                <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="text-theme-alert-danger-text text-sm">{error || scanError}</p>
              </div>
            )}
          </section>

          <section className="card p-4" aria-labelledby="put-away-moves-heading">
            <h2 id="put-away-moves-heading" className="text-theme-text-primary mb-2 text-sm font-semibold">
              Put away this session
            </h2>
            {moves.length === 0 ? (
              <p className="text-theme-text-muted text-sm">Nothing yet.</p>
            ) : (
              <ul className="divide-theme-surface-border divide-y">
                {moves.map((move, index) => (
                  <li key={`${move.item_id}-${index}`} className="flex items-start gap-2 py-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
                    <span className="text-theme-text-primary">
                      <strong>{move.item_name}</strong>{' '}
                      {move.moved
                        ? `→ ${move.storage_area_name}${move.from_storage_area_name ? ` (was ${move.from_storage_area_name})` : ''}`
                        : `already on ${move.storage_area_name}`}
                    </span>
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

export default InventoryPutAwayPage;
