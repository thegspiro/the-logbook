/**
 * Bulk Tag Enrollment — `/inventory/admin/nfc/enroll`.
 *
 * Tags a run of items one after another, instead of opening each item's page:
 * pick the items that have no working tag (search narrows them), then work
 * down the list. Each item is linked the same two ways `NfcTagsCard` offers:
 *
 * - **Write a link** onto a blank tag — one button press per item, because a
 *   write should only ever land on the tag the quartermaster meant it for.
 * - **Read the serial** — the reader stays on, and each tag tapped is linked
 *   to the current item and moves on to the next. The serial just linked is
 *   ignored if it is read again, since a phone held against a tag reads it
 *   repeatedly.
 *
 * A typed serial works in either mode, for a USB reader at a desk.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Check, Loader2, Nfc, PenLine, ScanLine, Search, SkipForward, Tags } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useNfcWriter } from '../../../hooks/useNfcWriter';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { ScanSuccessFlash } from '../../../components/ux/ScanSuccessFlash';
import { Breadcrumbs } from '../../../components/ux';
import { NfcCredentialType } from '../../../constants/enums';
import { buildInventoryTagUrl, generateInventoryTagCode } from '../../../constants/nfc';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useInventoryNfcEnabled } from '../hooks/useInventoryNfcEnabled';
import type { InventoryNfcUntaggedItem } from '../types/nfc';

type Mode = 'write' | 'serial';

const LIST_LIMIT = 200;

function normalizeSerial(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export const InventoryNfcEnrollPage: React.FC = () => {
  const { enabled, loading: loadingSwitch } = useInventoryNfcEnabled();
  const { flashing, signalScanSuccess } = useScanFeedback();

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<InventoryNfcUntaggedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [index, setIndex] = useState(0);
  const [taggedCount, setTaggedCount] = useState(0);
  const [mode, setMode] = useState<Mode>('write');
  const [typedSerial, setTypedSerial] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = items[index] ?? null;
  const currentRef = useRef<InventoryNfcUntaggedItem | null>(null);
  currentRef.current = current;
  const linkingRef = useRef(false);
  const lastSerialRef = useRef<string | null>(null);

  const load = useCallback(async (query: string) => {
    setLoadingItems(true);
    setError(null);
    try {
      const response = await inventoryService.getUntaggedItems({
        search: query.trim() || undefined,
        limit: LIST_LIMIT,
      });
      setItems(response.items);
      setIndex(0);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load untagged items.'));
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load('');
  }, [enabled, load]);

  const advance = useCallback(() => {
    setIndex((i) => i + 1);
    setTypedSerial('');
  }, []);

  const link = useCallback(
    async (tagUid: string, credentialType: NfcCredentialType): Promise<boolean> => {
      const item = currentRef.current;
      if (!item || linkingRef.current) return false;
      linkingRef.current = true;
      setLinking(true);
      setError(null);
      try {
        await inventoryService.linkItemNfcTag(item.id, { tag_uid: tagUid, credential_type: credentialType });
        signalScanSuccess();
        setTaggedCount((n) => n + 1);
        advance();
        return true;
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Could not link the tag.');
        setError(
          credentialType === NfcCredentialType.WRITTEN
            ? `The link was written to the tag, but it could not be saved: ${message} Writing again overwrites it.`
            : message
        );
        return false;
      } finally {
        linkingRef.current = false;
        setLinking(false);
      }
    },
    [advance, signalScanSuccess]
  );

  const onTag = useCallback(
    (tag: { serialNumber: string }) => {
      const serial = normalizeSerial(tag.serialNumber);
      if (serial.length < 4 || serial === lastSerialRef.current) return;
      lastSerialRef.current = serial;
      void link(serial, NfcCredentialType.SERIAL);
    },
    [link]
  );

  const { supported: canRead, scanning, error: scanError, unavailableReason, start, stop } = useNfcScanner({ onTag });
  const { supported: canWrite, status: writeStatus, error: writeError, writeUrl, cancel: cancelWrite } = useNfcWriter();

  useEffect(
    () => () => {
      stop();
      cancelWrite();
    },
    [stop, cancelWrite]
  );

  useEffect(() => {
    if (!canWrite && canRead) setMode('serial');
  }, [canWrite, canRead]);

  const handleWrite = async () => {
    stop();
    setError(null);
    const code = generateInventoryTagCode();
    // Linked only after the tag took the write.
    const written = await writeUrl(buildInventoryTagUrl(code));
    if (!written) return;
    await link(code, NfcCredentialType.WRITTEN);
  };

  const handleTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const serial = normalizeSerial(typedSerial);
    if (serial.length < 4) {
      setError('Enter the tag’s serial number (at least 4 letters or digits).');
      return;
    }
    void link(serial, NfcCredentialType.SERIAL);
  };

  const switchMode = (next: Mode) => {
    stop();
    cancelWrite();
    setMode(next);
  };

  if (loadingSwitch) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const remaining = Math.max(0, items.length - index);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <ScanSuccessFlash active={flashing} />
      <Breadcrumbs />

      <header>
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Tags className="h-5 w-5" /> Tag Items in Bulk
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Work down the list of items without a working tag, tagging each one in turn.
        </p>
      </header>

      {!enabled ? (
        <div className="alert-warning" role="status">
          NFC tag tracking is turned off for your department. Turn it on under{' '}
          <Link to="/inventory/admin/nfc" className="underline">
            NFC Tags
          </Link>{' '}
          first.
        </div>
      ) : (
        <>
          <form
            className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void load(search);
            }}
          >
            <div className="flex-1">
              <label className="form-label" htmlFor="enroll-search">
                Which items
              </label>
              <input
                id="enroll-search"
                type="search"
                className="form-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, serial or asset tag (blank for all)"
              />
            </div>
            <button type="submit" className="btn-secondary" disabled={loadingItems}>
              <Search className="h-4 w-4" aria-hidden="true" /> Find items
            </button>
          </form>

          <section className="card space-y-3 p-4" aria-label="Tag the current item">
            <p className="text-theme-text-secondary text-sm" role="status">
              {loadingItems
                ? 'Loading…'
                : `${taggedCount} tagged this session · ${remaining} of ${items.length} left${items.length >= LIST_LIMIT ? ` (first ${LIST_LIMIT} shown)` : ''}`}
            </p>

            {current ? (
              <>
                <div>
                  <p className="text-theme-text-primary text-lg font-semibold">{current.name}</p>
                  <p className="text-theme-text-secondary text-xs">
                    {[
                      current.serial_number && `S/N ${current.serial_number}`,
                      current.asset_tag && `Asset ${current.asset_tag}`,
                      current.category_name,
                      current.storage_area_name,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>

                <fieldset className="flex flex-wrap gap-2">
                  <legend className="sr-only">How to link tags</legend>
                  <button
                    type="button"
                    aria-pressed={mode === 'write'}
                    className={mode === 'write' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                    onClick={() => switchMode('write')}
                    disabled={!canWrite}
                  >
                    <PenLine className="h-4 w-4" aria-hidden="true" /> Write links
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'serial'}
                    className={mode === 'serial' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                    onClick={() => switchMode('serial')}
                  >
                    <ScanLine className="h-4 w-4" aria-hidden="true" /> Read serials
                  </button>
                </fieldset>

                {mode === 'write' && canWrite && (
                  <button
                    type="button"
                    className="btn-primary inline-flex w-full items-center justify-center gap-2"
                    onClick={() => void handleWrite()}
                    disabled={linking || writeStatus === 'waiting'}
                  >
                    <Nfc className={`h-4 w-4 ${writeStatus === 'waiting' ? 'animate-pulse' : ''}`} aria-hidden="true" />
                    {writeStatus === 'waiting' ? 'Hold a blank tag to the phone…' : `Write a tag for ${current.name}`}
                  </button>
                )}

                {mode === 'serial' &&
                  (canRead ? (
                    <button
                      type="button"
                      onClick={scanning ? stop : () => void start()}
                      aria-pressed={scanning}
                      className={`inline-flex w-full items-center justify-center gap-2 ${scanning ? 'btn-secondary' : 'btn-primary'}`}
                    >
                      <Nfc className={`h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true" />
                      {scanning ? 'Listening — tap each item’s tag in turn' : 'Start reading tags'}
                    </button>
                  ) : (
                    <p className="text-theme-text-muted text-xs">{unavailableReason}</p>
                  ))}

                <form onSubmit={handleTypedSubmit} className="flex flex-col gap-2 sm:flex-row">
                  <label className="sr-only" htmlFor="enroll-serial">
                    Tag serial number
                  </label>
                  <input
                    id="enroll-serial"
                    type="text"
                    className="form-input flex-1 font-mono uppercase"
                    value={typedSerial}
                    onChange={(e) => setTypedSerial(e.target.value)}
                    placeholder="Tag serial (or USB reader)"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="submit" className="btn-secondary" disabled={!typedSerial.trim() || linking}>
                    Link serial
                  </button>
                </form>

                <button type="button" className="btn-secondary btn-sm" onClick={advance} disabled={linking}>
                  <SkipForward className="h-4 w-4" aria-hidden="true" /> Skip this item
                </button>
              </>
            ) : (
              !loadingItems && (
                <p className="text-theme-text-primary flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden="true" />
                  {items.length === 0 ? 'Every matching item already has a working tag.' : 'End of the list.'}
                </p>
              )
            )}

            {linking && (
              <p className="text-theme-text-muted flex items-center gap-2 text-xs" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Linking…
              </p>
            )}
            {(error || scanError || writeError) && (
              <div className="alert-danger flex items-start gap-2" role="alert">
                <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="text-theme-alert-danger-text text-sm">{error || scanError || writeError}</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default InventoryNfcEnrollPage;
