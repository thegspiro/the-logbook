import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeNfcError, getNfcUnavailableReason, isNfcSupported } from '../constants/nfc';

export type NfcWriteStatus = 'idle' | 'waiting' | 'success' | 'error';

interface UseNfcWriterReturn {
  /** Whether Web NFC is usable here; false hides the writer UI entirely. */
  supported: boolean;
  /** User-facing reason NFC is unavailable, or null when it is available. */
  unavailableReason: string | null;
  status: NfcWriteStatus;
  /** Set while `status === 'error'`. */
  error: string | null;
  /** Begins a write; resolves true once a tag was written. */
  writeUrl: (url: string) => Promise<boolean>;
  /** Aborts a pending write (the browser stays armed until a tag taps). */
  cancel: () => void;
  /** Returns to `idle`, clearing any success/error result. */
  reset: () => void;
}

/**
 * Writes a URL to an NFC tag via Web NFC.
 *
 * `NDEFReader.write()` does not resolve when the call is made — it arms the
 * radio and stays pending until a tag is physically held against the phone.
 * That makes an AbortController mandatory rather than optional: without one,
 * a member who changes their mind leaves the device armed, and the next tag
 * they pass near the phone gets silently overwritten.
 */
export function useNfcWriter(): UseNfcWriterReturn {
  const [status, setStatus] = useState<NfcWriteStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Guards against setState after unmount, since a write stays pending for as
  // long as it takes someone to find the tag.
  const mountedRef = useRef(true);

  const supported = useMemo(() => isNfcSupported(), []);
  const unavailableReason = useMemo(() => getNfcUnavailableReason(), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (mountedRef.current) setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const writeUrl = useCallback(async (url: string): Promise<boolean> => {
    const Reader = typeof window !== 'undefined' ? window.NDEFReader : undefined;
    if (!Reader) {
      setError(getNfcUnavailableReason() ?? 'NFC is not available on this device.');
      setStatus('error');
      return false;
    }

    // A second tap on the button restarts the write rather than stacking two
    // armed readers on the same radio.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setStatus('waiting');

    try {
      await new Reader().write({ records: [{ recordType: 'url', data: url }] }, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return false;
      setStatus('success');
      return true;
    } catch (err: unknown) {
      if (!mountedRef.current) return false;
      // A cancel is a decision, not a failure — `cancel()` already set idle.
      if (controller.signal.aborted) return false;
      setError(describeNfcError(err, 'Could not write to the tag. Try again with the tag flat against the phone.'));
      setStatus('error');
      return false;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { supported, unavailableReason, status, error, writeUrl, cancel, reset };
}
