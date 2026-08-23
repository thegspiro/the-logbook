import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeNfcError, getNfcUnavailableReason, isNfcSupported, readNdefMessageText } from '../constants/nfc';

interface UseNfcScannerOptions {
  /**
   * Called with the first readable text payload of each tag that is tapped.
   * Optional: a card that carries no NDEF text — which is most ID cards — has
   * nothing to hand this, and such a reader wants `onTag` instead.
   */
  onRead?: (payload: string) => void;
  /**
   * Called for every tag tapped, with its hardware serial number.
   *
   * This is what identifies an ID card. The tag in a printed card is
   * typically factory-programmed and blank: no NDEF records at all, so
   * `onRead` never fires for it, and the serial is the only thing to go on.
   */
  onTag?: (tag: { serialNumber: string; payload: string | null }) => void;
}

interface UseNfcScannerReturn {
  supported: boolean;
  unavailableReason: string | null;
  /** True while the radio is armed and waiting for a tag. */
  scanning: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Reads NFC tags while the app is open, so a member can tap a tag on a
 * station door without leaving the page they are on.
 *
 * Note this is additive: an Android phone that taps a URL tag with the app
 * closed opens the link in the browser directly, no scan needed. This hook
 * covers the case the OS does not — the app already being in the foreground.
 */
export function useNfcScanner({ onRead, onTag }: UseNfcScannerOptions): UseNfcScannerReturn {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // Keeps the reader bound to the latest callbacks without restarting the scan.
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const onTagRef = useRef(onTag);
  onTagRef.current = onTag;

  const supported = useMemo(() => isNfcSupported(), []);
  const unavailableReason = useMemo(() => getNfcUnavailableReason(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (mountedRef.current) setScanning(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Leaving the page must disarm the radio; an orphaned scan keeps firing
      // reading events against an unmounted component's callback.
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    const Reader = typeof window !== 'undefined' ? window.NDEFReader : undefined;
    if (!Reader) {
      setError(getNfcUnavailableReason() ?? 'NFC is not available on this device.');
      return;
    }
    if (abortRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    const reader = new Reader();
    reader.onreading = (event: NDEFReadingEvent) => {
      const payload = readNdefMessageText(event.message);
      // Fires for every tap, text or not: an ID card's tag is usually blank,
      // and its serial number is the whole of what identifies the member.
      onTagRef.current?.({ serialNumber: event.serialNumber, payload });
      // A tag with no text records (or an unreadable encoding) is ignored so
      // the scan stays armed for the next tap instead of dead-ending.
      if (payload) onReadRef.current?.(payload);
    };
    reader.onreadingerror = () => {
      if (mountedRef.current) setError('That tag could not be read. Try holding the phone against it again.');
    };

    try {
      await reader.scan({ signal: controller.signal });
      if (mountedRef.current && !controller.signal.aborted) setScanning(true);
    } catch (err: unknown) {
      if (abortRef.current === controller) abortRef.current = null;
      if (!mountedRef.current || controller.signal.aborted) return;
      setError(describeNfcError(err, 'Could not start NFC scanning.'));
      setScanning(false);
    }
  }, []);

  return { supported, unavailableReason, scanning, error, start, stop };
}
