/**
 * Confirm a print run label by label, by scanning each one as it comes off.
 *
 * A single "did the labels print?" button can only answer for the whole batch,
 * so a roll that jammed halfway leaves the member choosing between marking
 * items that have no label and marking none. Scanning answers per item — and
 * proves the label actually scans, which is the point of having one.
 *
 * Two inputs feed the same handler: the phone or laptop camera, and a
 * handheld USB/Bluetooth scanner, which types the code into the focused text
 * box and presses Enter.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryItem } from '../types';
import { useHtml5Scanner } from '../../../hooks/useHtml5Scanner';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import {
  BARCODE_SCAN_CONFIG,
  INVENTORY_BARCODE_FORMATS,
  describeCameraError,
  getCameraUnavailableReason,
} from '../../../constants/camera';
import { ScanSuccessFlash } from '../../../components/ux/ScanSuccessFlash';
import { FlashlightToggle } from '../../../components/ux/FlashlightToggle';
import { formatNumber } from '../../../utils/dateFormatting';

const VIEWPORT_ID = 'label-confirm-scanner-viewport';

// The camera decodes the same label many times a second while it is in view.
// Repeats inside this window are the same scan, not a second one.
const REPEAT_WINDOW_MS = 1500;

type ScanOutcome =
  | { kind: 'matched'; name: string }
  | { kind: 'repeat'; name: string }
  | { kind: 'foreign'; code: string }
  | { kind: 'error'; message: string };

interface LabelScanConfirmProps {
  items: InventoryItem[];
  /** The value each item's label encodes, as the print page renders it. */
  labelValueOf: (item: InventoryItem) => string | null;
  /** Record the scanned items; resolves once saved, rejects to keep the panel open. */
  onConfirm: (itemIds: string[]) => Promise<void>;
  onCancel: () => void;
}

export const LabelScanConfirm: React.FC<LabelScanConfirmProps> = ({ items, labelValueOf, onConfirm, onCancel }) => {
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [manual, setManual] = useState('');
  const [saving, setSaving] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  // Mirrors `scanned` so the camera callback, which outlives renders, reads
  // the current set rather than the one it closed over.
  const scannedRef = useRef(scanned);
  scannedRef.current = scanned;
  const { flashing, signalScanSuccess } = useScanFeedback();

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  // Keyed on the exact encoded value. The label carries the value verbatim, so
  // an exact match is the only one that proves this label belongs to this item.
  const byValue = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of items) {
      const value = labelValueOf(item);
      if (value && !map.has(value)) map.set(value, item);
    }
    return map;
  }, [items, labelValueOf]);

  const accept = useCallback(
    (item: InventoryItem) => {
      if (scannedRef.current.has(item.id)) {
        setOutcome({ kind: 'repeat', name: item.name });
        return;
      }
      setScanned((prev) => new Set(prev).add(item.id));
      setOutcome({ kind: 'matched', name: item.name });
      signalScanSuccess();
    },
    [signalScanSuccess]
  );

  const handleCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      const last = lastCodeRef.current;
      if (last && last.code === code && now - last.at < REPEAT_WINDOW_MS) return;
      lastCodeRef.current = { code, at: now };

      const local = byValue.get(code);
      if (local) {
        accept(local);
        return;
      }
      // Not a value this page rendered. The PDF path can assign a barcode as
      // it prints, which the items loaded here predate, so ask the server
      // which item the code belongs to before calling it foreign.
      try {
        const { results } = await inventoryService.lookupByCode(code);
        const match = results.map((r) => byId.get(r.item.id)).find((item) => item !== undefined);
        if (match) accept(match);
        else setOutcome({ kind: 'foreign', code });
      } catch {
        setOutcome({ kind: 'error', message: `Could not look up ${code}` });
      }
    },
    [accept, byId, byValue]
  );

  const { scanning, startScanner, stopScanner, flashlightSupported, flashlightOn, toggleFlashlight } = useHtml5Scanner({
    viewportId: VIEWPORT_ID,
    scanConfig: BARCODE_SCAN_CONFIG,
    onScan: (text) => void handleCode(text),
    formatsToSupport: INVENTORY_BARCODE_FORMATS,
  });

  const cameraUnavailable = getCameraUnavailableReason();

  const toggleCamera = async () => {
    if (scanning) {
      await stopScanner();
      return;
    }
    setCameraError(null);
    try {
      await startScanner();
    } catch (err: unknown) {
      setCameraError(describeCameraError(err));
    }
  };

  const confirm = async () => {
    setSaving(true);
    try {
      await stopScanner();
      await onConfirm(Array.from(scanned));
    } catch {
      // The caller reports the failure; staying open keeps every scan.
    } finally {
      setSaving(false);
    }
  };

  const remaining = items.filter((item) => !scanned.has(item.id));

  return (
    <div className="card-secondary mb-4 space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-theme-text-primary text-sm font-medium" aria-live="polite">
          {formatNumber(scanned.size)} of {formatNumber(items.length)} labels scanned
        </p>
        <button
          type="button"
          onClick={() => void toggleCamera()}
          disabled={cameraUnavailable !== null}
          title={cameraUnavailable ?? undefined}
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
        >
          {scanning ? <CameraOff className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
          {scanning ? 'Stop camera' : 'Use camera'}
        </button>
      </div>

      <div className={`relative overflow-hidden rounded-lg ${scanning ? '' : 'hidden'}`}>
        <div id={VIEWPORT_ID} className="w-full" />
        {scanning && flashlightSupported && <FlashlightToggle on={flashlightOn} onToggle={toggleFlashlight} />}
        <ScanSuccessFlash active={flashing} />
      </div>
      {cameraError && <p className="text-sm text-red-700 dark:text-red-400">{cameraError}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleCode(manual);
          setManual('');
        }}
      >
        <label htmlFor="label-confirm-code" className="form-label">
          Scan or type a label&rsquo;s barcode
        </label>
        <div className="flex gap-2">
          <input
            id="label-confirm-code"
            className="form-input"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoComplete="off"
            // A handheld scanner types into whatever has focus.
            autoFocus
          />
          <button type="submit" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <ScanLine className="h-3.5 w-3.5" /> Check
          </button>
        </div>
      </form>

      {outcome && (
        <p
          role="status"
          className={`flex items-center gap-1.5 text-sm ${
            outcome.kind === 'matched'
              ? 'text-emerald-800 dark:text-emerald-300'
              : outcome.kind === 'repeat'
                ? 'text-theme-text-secondary'
                : 'text-red-700 dark:text-red-400'
          }`}
        >
          {outcome.kind === 'matched' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : outcome.kind === 'repeat' ? null : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          {outcome.kind === 'matched' && `${outcome.name} — confirmed`}
          {outcome.kind === 'repeat' && `${outcome.name} was already scanned`}
          {outcome.kind === 'foreign' && `${outcome.code} is not one of the labels in this batch`}
          {outcome.kind === 'error' && outcome.message}
        </p>
      )}

      {remaining.length > 0 && scanned.size > 0 && (
        <details className="text-sm">
          <summary className="text-theme-text-secondary cursor-pointer">
            {formatNumber(remaining.length)} not scanned yet
          </summary>
          <ul className="text-theme-text-muted mt-1 max-h-40 list-disc overflow-y-auto pl-5">
            {remaining.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={scanned.size === 0 || saving}
          className="btn-success btn-sm inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Mark {formatNumber(scanned.size)} scanned {scanned.size === 1 ? 'item' : 'items'} as labelled
        </button>
        <button
          type="button"
          onClick={() => {
            void stopScanner();
            onCancel();
          }}
          className="btn-secondary btn-sm"
        >
          Back
        </button>
      </div>
    </div>
  );
};

export default LabelScanConfirm;
