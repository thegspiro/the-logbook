/**
 * Tap NFC tags while walking an equipment check.
 *
 * Arming it keeps the phone's reader on for the rest of the walk, so a crew
 * member can tap a compartment's tag to jump to it and a tool's tag to answer
 * it without touching the screen between taps. Each tap is resolved against
 * this check's template (`POST /inventory/nfc/resolve-check`); what the check
 * form does with the answer — where to scroll, which rows to mark — is the
 * form's, handed back through `onResolved`.
 *
 * Taps are resolved one at a time, in the order they were made, so two quick
 * taps cannot land out of order and leave the form on the first compartment.
 *
 * Renders nothing where Web NFC is unavailable (iPhones, desktops): the
 * check is completed exactly as before there.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Nfc } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { parseInventoryTagCode } from '../../../constants/nfc';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { InventoryNfcResolveCheckResponse } from '../types/nfc';

interface CheckNfcTapProps {
  templateId: string;
  /** Acts on what was tapped and returns the line to show the crew. */
  onResolved: (tap: InventoryNfcResolveCheckResponse) => string;
}

export const CheckNfcTap: React.FC<CheckNfcTapProps> = ({ templateId, onResolved }) => {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  const onTag = useCallback(
    (tag: { serialNumber: string; payload: string | null }) => {
      const code = parseInventoryTagCode(tag.payload);
      const serial = tag.serialNumber.replace(/[^0-9A-Za-z]/g, '');
      if (!code && serial.length < 4) {
        setError('That tag could not be read. Hold the phone still against it and try again.');
        return;
      }
      queueRef.current = queueRef.current.then(async () => {
        setBusy(true);
        setError(null);
        try {
          const tap = await inventoryService.resolveCheckNfcTag({
            template_id: templateId,
            code: code || undefined,
            serial_number: serial.length >= 4 ? serial : undefined,
          });
          setMessage(onResolvedRef.current(tap));
        } catch (err: unknown) {
          setMessage(null);
          setError(getErrorMessage(err, 'That tag could not be read.'));
        } finally {
          setBusy(false);
        }
      });
    },
    [templateId]
  );

  const { supported, scanning, error: scanError, start, stop } = useNfcScanner({ onTag });
  useEffect(() => () => stop(), [stop]);

  if (!supported) return null;

  const shownError = error || scanError;

  return (
    <div className="space-y-2">
      <button
        type="button"
        // Web NFC needs the click's user activation, so scan() starts here.
        onClick={() => (scanning ? stop() : void start())}
        aria-pressed={scanning}
        className="btn-secondary mobile-touch-target inline-flex w-full items-center justify-center gap-2"
      >
        <Nfc className={`h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true" />
        {scanning ? 'Tapping tags: tap here to stop' : 'Tap NFC tags'}
      </button>
      <p role="status" aria-live="polite" className="text-theme-text-secondary text-sm">
        {busy ? 'Reading tag…' : message}
      </p>
      {shownError && (
        <div className="alert-danger flex items-start gap-2" role="alert">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{shownError}</p>
        </div>
      )}
    </div>
  );
};

export default CheckNfcTap;
