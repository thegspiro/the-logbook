/**
 * The NFC tags stuck to one item, one storage area (a shelf, bin or cabinet)
 * or one equipment-check compartment on an apparatus: link a new one, mark
 * one lost or found, unlink one.
 *
 * Two ways to link a tag from a phone, matching member ID cards
 * (`NfcCardCapture`):
 *
 * **Write a link** onto a blank tag. The preferred option: the tag then holds
 * a URL, so *any* phone that taps it — an iPhone included, with no app open —
 * lands on this item (for a shelf: on put-away, with the shelf chosen). The
 * code in the URL is minted here and linked only once the write has
 * succeeded. A compartment tag is different: it is read only from inside an
 * equipment check, which needs Web NFC, so an iPhone cannot use it either way.
 *
 * **Read the tag's serial**, for a tag that cannot be written (a locked or
 * pre-printed one). Only Android Chrome can then use it, from inside the app.
 *
 * A typed field sits beside both, because a quartermaster at a desk with a USB
 * reader types the serial straight into it, and a desktop has no Web NFC.
 *
 * Rendered by the item page and the storage area editor only for
 * `inventory.manage` holders, and by the checklist builder's compartment
 * editor only for `inventory.check_manage` holders — in each case only when
 * the organization has NFC tracking switched on; the server refuses every call
 * here otherwise.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Link2, Loader2, Nfc, PenLine, ScanLine, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useNfcWriter } from '../../../hooks/useNfcWriter';
import { useTimezone } from '../../../hooks/useTimezone';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { InventoryNfcTagStatus, NfcCredentialType } from '../../../constants/enums';
import { buildInventoryTagUrl, generateInventoryTagCode } from '../../../constants/nfc';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { InventoryNfcTag, InventoryNfcTagCreate, InventoryNfcTagTargetKind } from '../types/nfc';

interface NfcTagsCardProps {
  targetKind: InventoryNfcTagTargetKind;
  targetId: string;
  targetName: string;
}

const TARGET_NOUNS: Record<InventoryNfcTagTargetKind, string> = {
  item: 'item',
  storage_area: 'storage area',
  check_compartment: 'compartment',
};

const loadTags = (kind: InventoryNfcTagTargetKind, id: string) => {
  switch (kind) {
    case 'item':
      return inventoryService.getItemNfcTags(id);
    case 'storage_area':
      return inventoryService.getStorageAreaNfcTags(id);
    case 'check_compartment':
      return inventoryService.getCheckCompartmentNfcTags(id);
  }
};

const linkTag = (kind: InventoryNfcTagTargetKind, id: string, payload: InventoryNfcTagCreate) => {
  switch (kind) {
    case 'item':
      return inventoryService.linkItemNfcTag(id, payload);
    case 'storage_area':
      return inventoryService.linkStorageAreaNfcTag(id, payload);
    case 'check_compartment':
      return inventoryService.linkCheckCompartmentNfcTag(id, payload);
  }
};

/** Strips reader separators so what is shown matches what is stored. */
function normalizeSerial(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

const CREDENTIAL_LABELS: Record<NfcCredentialType, string> = {
  [NfcCredentialType.WRITTEN]: 'Link written to tag',
  [NfcCredentialType.SERIAL]: 'Chip serial',
};

export const NfcTagsCard: React.FC<NfcTagsCardProps> = ({ targetKind, targetId, targetName }) => {
  const noun = TARGET_NOUNS[targetKind];
  const idBase = useId();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [tags, setTags] = useState<InventoryNfcTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [typedSerial, setTypedSerial] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await loadTags(targetKind, targetId);
      setTags(response.items);
    } catch (err: unknown) {
      setError(getErrorMessage(err, `Could not load this ${noun}’s NFC tags.`));
    } finally {
      setLoading(false);
    }
  }, [targetKind, targetId, noun]);

  useEffect(() => {
    void load();
  }, [load]);

  const link = useCallback(
    async (tagUid: string, credentialType: NfcCredentialType) => {
      setLinking(true);
      setError(null);
      try {
        const payload: InventoryNfcTagCreate = {
          tag_uid: tagUid,
          credential_type: credentialType,
          label: label.trim() || undefined,
        };
        await linkTag(targetKind, targetId, payload);
        toast.success(`NFC tag linked to ${targetName}`);
        setLabel('');
        setTypedSerial('');
        await load();
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Could not link the tag.');
        setError(
          credentialType === NfcCredentialType.WRITTEN
            ? `The link was written to the tag, but it could not be saved: ${message} Writing again overwrites it.`
            : message
        );
      } finally {
        setLinking(false);
      }
    },
    [targetKind, targetId, targetName, label, load]
  );

  // Refs because the scanner keeps the callback it started with, and the
  // label typed after arming must still be the one saved.
  const linkRef = useRef(link);
  linkRef.current = link;
  const stopRef = useRef<() => void>(() => {});

  const handleTag = useCallback((tag: { serialNumber: string }) => {
    const serial = normalizeSerial(tag.serialNumber);
    if (!serial) return;
    // One tap, one link: leaving the radio armed would link the next tag
    // brushed past the phone as well.
    stopRef.current();
    void linkRef.current(serial, NfcCredentialType.SERIAL);
  }, []);

  const { supported, scanning, error: scanError, start, stop } = useNfcScanner({ onTag: handleTag });
  stopRef.current = stop;
  const { status: writeStatus, error: writeError, writeUrl, cancel: cancelWrite } = useNfcWriter();

  useEffect(
    () => () => {
      stop();
      cancelWrite();
    },
    [stop, cancelWrite]
  );

  const handleWrite = useCallback(async () => {
    stop();
    setError(null);
    const code = generateInventoryTagCode();
    // Linked only after the tag took the write; the other order leaves a link
    // to a tag that still says nothing.
    const written = await writeUrl(buildInventoryTagUrl(code));
    if (!written) return;
    await link(code, NfcCredentialType.WRITTEN);
  }, [stop, writeUrl, link]);

  const handleRead = useCallback(() => {
    cancelWrite();
    setError(null);
    // Web NFC needs the click's user activation, so scan() starts here.
    void start();
  }, [cancelWrite, start]);

  const handleTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const serial = normalizeSerial(typedSerial);
    if (serial.length < 4) {
      setError('Enter the tag’s serial number (at least 4 letters or digits).');
      return;
    }
    void link(serial, NfcCredentialType.SERIAL);
  };

  const setStatus = async (tag: InventoryNfcTag, status: InventoryNfcTagStatus) => {
    try {
      await inventoryService.updateNfcTag(tag.id, { status });
      toast.success(status === InventoryNfcTagStatus.LOST ? 'Tag marked lost' : 'Tag back in service');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the tag.'));
    }
  };

  const unlink = async (tag: InventoryNfcTag) => {
    const ok = await confirm({
      title: 'Unlink this NFC tag?',
      message: `Tapping tag …${tag.uid_preview} will no longer find ${targetName}. The tag itself is not erased, and can be linked again elsewhere.`,
      confirmLabel: 'Unlink tag',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await inventoryService.unlinkNfcTag(tag.id);
      toast.success('Tag unlinked');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not unlink the tag.'));
    }
  };

  const busyWriting = writeStatus === 'waiting';
  const shownError = error || scanError || writeError;

  return (
    <section className="card-secondary p-4 lg:col-span-2" aria-labelledby={`${idBase}-heading`}>
      <h3
        id={`${idBase}-heading`}
        className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold"
      >
        <Nfc className="h-4 w-4" aria-hidden="true" />
        NFC Tags
      </h3>

      {loading ? (
        <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-label="Loading NFC tags" />
      ) : tags.length === 0 ? (
        <p className="text-theme-text-muted mb-4 text-sm">No NFC tags are linked to this {noun}.</p>
      ) : (
        <ul className="divide-theme-surface-border mb-4 divide-y">
          {tags.map((tag) => {
            const lost = tag.status === InventoryNfcTagStatus.LOST;
            return (
              <li key={tag.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-theme-text-primary text-sm font-medium">
                    {tag.label || 'Unlabelled tag'}{' '}
                    <span className="text-theme-text-muted font-mono text-xs">…{tag.uid_preview}</span>
                    {lost && (
                      <span className="badge ml-2 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                        Lost
                      </span>
                    )}
                  </p>
                  <p className="text-theme-text-secondary text-xs">
                    {CREDENTIAL_LABELS[tag.credential_type]} · linked {formatDate(tag.linked_at, tz)}
                    {tag.linked_by_name ? ` by ${tag.linked_by_name}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() =>
                      void setStatus(tag, lost ? InventoryNfcTagStatus.ACTIVE : InventoryNfcTagStatus.LOST)
                    }
                  >
                    {lost ? 'Mark found' : 'Mark lost'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm inline-flex items-center gap-1"
                    onClick={() => void unlink(tag)}
                    aria-label={`Unlink tag …${tag.uid_preview}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Unlink
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-3">
        <div>
          <label className="form-label" htmlFor={`${idBase}-label`}>
            Where the new tag is on the {noun} <span className="text-theme-text-muted">(optional)</span>
          </label>
          <input
            id={`${idBase}-label`}
            type="text"
            className="form-input"
            value={label}
            maxLength={100}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Inside left cuff"
          />
        </div>

        {supported && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleWrite()}
              disabled={busyWriting || linking}
              className="btn-primary inline-flex flex-1 items-center justify-center gap-2"
            >
              <PenLine className={`h-4 w-4 ${busyWriting ? 'animate-pulse' : ''}`} aria-hidden="true" />
              {busyWriting ? 'Hold the tag against the phone…' : 'Write a link to a blank tag'}
            </button>
            <button
              type="button"
              onClick={handleRead}
              disabled={linking}
              className="btn-secondary inline-flex flex-1 items-center justify-center gap-2"
            >
              <ScanLine className={`h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true" />
              {scanning ? 'Hold the tag against the phone…' : "Read a tag's serial"}
            </button>
          </div>
        )}

        <form onSubmit={handleTypedSubmit} className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`${idBase}-serial`}>
            Tag serial number
          </label>
          <input
            id={`${idBase}-serial`}
            type="text"
            className="form-input flex-1 font-mono uppercase"
            value={typedSerial}
            onChange={(e) => setTypedSerial(e.target.value)}
            placeholder="04A2245B7C1180"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={linking || !typedSerial.trim()}
            className="btn-secondary inline-flex items-center justify-center gap-2"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" /> Link serial
          </button>
        </form>

        <p className="text-theme-text-secondary text-xs">
          {targetKind === 'check_compartment'
            ? 'Crews tap this tag during an equipment check, from Chrome on Android, to jump straight to this compartment. You can also type a serial, or use a USB reader with the cursor in the box.'
            : supported
              ? 'A written link works on any phone, iPhones included. A serial only works from this app on Android. You can also type a serial, or use a USB reader with the cursor in the box.'
              : 'Type the tag’s serial number, or hold it against a USB reader with the cursor in the box. Writing a link to a tag needs Chrome on Android over HTTPS.'}
        </p>

        {shownError && (
          <div className="alert-danger flex items-start gap-2" role="alert">
            <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-theme-alert-danger-text text-sm">{shownError}</p>
          </div>
        )}
      </div>
    </section>
  );
};
