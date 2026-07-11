import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cross-platform confirmation that a barcode/QR code was captured. Users scan
 * with gloves at arm's length in the field, so a silent success is easy to
 * miss and leads to double-scanning.
 *
 * - Visual: a brief flash overlay (works everywhere) — pair with ScanSuccessFlash.
 * - Haptic: navigator.vibrate on Android. iOS Safari does not support the
 *   Vibration API, so it is a no-op there and the visual flash carries the cue.
 */
export function useScanFeedback(): { flashing: boolean; signalScanSuccess: () => void } {
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const signalScanSuccess = useCallback(() => {
    try {
      navigator.vibrate?.(60);
    } catch {
      // Some embedded webviews throw on vibrate; the visual flash still fires.
    }
    setFlashing(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFlashing(false), 350);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { flashing, signalScanSuccess };
}
