import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, Nfc } from 'lucide-react';
import { useNfcScanner } from '../../hooks/useNfcScanner';
import { NfcCheckInStatus } from '../../constants/enums';
import {
  checkInResultTone,
  isIssuedCardCode,
  isPlausibleCardSerial,
  normalizeCardSerial,
} from '../../modules/membership/constants/idCards';

/** What the public badge-tap endpoint returns (camelCase, like the station's). */
export interface KioskBadgeTapResult {
  status: NfcCheckInStatus;
  message: string;
  targetName?: string | null | undefined;
  memberDisplayName?: string | null | undefined;
}

interface KioskBadgeReaderProps {
  /** The room's display code — the only credential the kiosk holds. */
  displayCode: string;
  /** Called when the server says this room no longer accepts card taps. */
  onDisabled: () => void;
}

/** A card held a beat too long fires twice; the second read is dropped. */
const DUPLICATE_TAP_MS = 4000;

/** How long a result stays on screen before the reader returns to "ready". */
const RESULT_VISIBLE_MS = 6000;

/**
 * A USB reader types its whole serial in a burst and ends with Enter. A longer
 * gap means a person at a keyboard, so the buffer is dropped rather than left
 * to corrupt the next real read. Same value as the check-in station.
 */
const WEDGE_KEY_GAP_MS = 120;

/**
 * Member ID card reader for a room's public kiosk.
 *
 * Reads either through Web NFC (an Android tablet) or a USB reader that types
 * the serial like a keyboard, as the check-in station does. Nobody is signed
 * in here: the server decides the event from the room's display code, checks
 * the member in — or out, when they already are — and answers with no more
 * than a first name and initial, which is all this screen shows.
 *
 * Web NFC needs a tap on the screen to start (the browser requires a user
 * gesture), so a tablet shows a one-time "Start card reader" button for
 * whoever sets it up. A USB reader needs nothing and is always listening.
 */
export const KioskBadgeReader: React.FC<KioskBadgeReaderProps> = ({ displayCode, onDisabled }) => {
  const [result, setResult] = useState<KioskBadgeTapResult | null>(null);
  const busyRef = useRef(false);
  const lastTapRef = useRef<{ key: string; at: number } | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showResult = useCallback((next: KioskBadgeTapResult) => {
    setResult(next);
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => setResult(null), RESULT_VISIBLE_MS);
  }, []);

  const submit = useCallback(
    async (rawSerial: string, rawPayload?: string | null) => {
      const serial = normalizeCardSerial(rawSerial);
      if (!serial || !isPlausibleCardSerial(serial) || busyRef.current) return;

      // Only a code this system issued is forwarded, so a transit card or a
      // hotel key tapped at the kiosk does not send a stranger's tag contents
      // through a credential lookup.
      const payload = isIssuedCardCode(rawPayload) ? normalizeCardSerial(rawPayload ?? '') : undefined;
      const key = payload ?? serial;
      const previous = lastTapRef.current;
      if (previous && previous.key === key && Date.now() - previous.at < DUPLICATE_TAP_MS) return;
      lastTapRef.current = { key, at: Date.now() };

      busyRef.current = true;
      try {
        const response = await fetch(`/api/public/v1/display/${encodeURIComponent(displayCode)}/badge-tap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload ? { tag_uid: serial, tag_payload: payload } : { tag_uid: serial }),
        });
        if (response.status === 403 || response.status === 404) {
          // Switched off (or the code was rotated) since the page loaded: stop
          // offering a reader rather than refusing every member in turn.
          onDisabled();
          return;
        }
        if (response.status === 429) {
          showResult({
            status: NfcCheckInStatus.REFUSED,
            message: 'Too many taps just now. Wait a minute, or scan the QR code with your phone.',
          });
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        showResult((await response.json()) as KioskBadgeTapResult);
      } catch {
        showResult({
          status: NfcCheckInStatus.REFUSED,
          message: 'The tap could not be recorded. Try again, or scan the QR code with your phone.',
        });
      } finally {
        busyRef.current = false;
      }
    },
    [displayCode, onDisabled, showResult]
  );

  const handleTag = useCallback(
    (tag: { serialNumber: string; payload: string | null }) => {
      void submit(tag.serialNumber, tag.payload);
    },
    [submit]
  );

  const { supported: nfcSupported, scanning, error: scanError, start, stop } = useNfcScanner({ onTag: handleTag });

  useEffect(
    () => () => {
      stop();
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    },
    [stop]
  );

  // USB keyboard-wedge reader. The kiosk has no text inputs, so every burst
  // that ends in Enter is a card.
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastKeyAt > WEDGE_KEY_GAP_MS) buffer = '';
      lastKeyAt = now;
      if (event.key === 'Enter') {
        const captured = buffer;
        buffer = '';
        if (captured) void submit(captured);
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [submit]);

  if (result) {
    const tone = checkInResultTone(result.status);
    const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : CircleAlert;
    const toneClasses =
      tone === 'success'
        ? 'border-green-500 bg-green-50 text-green-900 dark:bg-green-500/15 dark:text-white'
        : tone === 'info'
          ? 'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-500/15 dark:text-white'
          : 'border-red-500 bg-red-50 text-red-900 dark:bg-red-500/15 dark:text-white';
    return (
      <div className={`rounded-2xl border-2 px-6 py-5 text-center ${toneClasses}`} role="status" aria-live="assertive">
        <Icon className="mx-auto mb-2 h-10 w-10" aria-hidden="true" />
        {result.memberDisplayName && <p className="text-2xl font-bold">{result.memberDisplayName}</p>}
        <p className="text-lg">{result.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Nfc className={`h-8 w-8 text-red-500 ${scanning ? 'animate-pulse' : ''}`} aria-hidden="true" />
        <p className="text-theme-text-primary text-xl font-medium">Or tap your ID card here</p>
      </div>
      {nfcSupported && !scanning && (
        // Web NFC only starts from a user gesture. Whoever sets the tablet up
        // presses this once; a USB reader is already listening regardless.
        <button type="button" onClick={() => void start()} className="btn-secondary">
          Start card reader
        </button>
      )}
      {scanError && <p className="text-theme-text-muted text-sm">{scanError}</p>}
    </div>
  );
};
