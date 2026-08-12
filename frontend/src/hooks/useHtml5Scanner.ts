import { useRef, useState, useCallback, useEffect } from 'react';
import { Html5Qrcode, type Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { getCameraUnavailableReason } from '../constants/camera';

/**
 * Builds a responsive qrbox callback: html5-qrcode invokes it with the live
 * viewfinder size, letting the scan region fit small phones and large tablets
 * alike instead of a fixed pixel box that overflows narrow screens or leaves a
 * tiny target on wide ones. The configured size is treated as the maximum;
 * aspect ratio is preserved (linear barcodes want a wide box, QR a square one).
 */
function makeResponsiveQrbox(target: { width: number; height: number }) {
  return (viewfinderWidth: number, viewfinderHeight: number) => {
    const scale = Math.min(1, (viewfinderWidth * 0.8) / target.width, (viewfinderHeight * 0.8) / target.height);
    return {
      width: Math.max(1, Math.round(target.width * scale)),
      height: Math.max(1, Math.round(target.height * scale)),
    };
  };
}

interface UseHtml5ScannerOptions {
  /** DOM element ID where html5-qrcode renders the camera preview. */
  viewportId: string;
  /** Scan configuration passed to html5-qrcode. */
  scanConfig: { fps: number; qrbox: { width: number; height: number } };
  /** Called with each decoded value. */
  onScan: (decodedText: string) => void;
  /** Restrict to specific barcode formats (default: all). */
  formatsToSupport?: Html5QrcodeSupportedFormats[];
}

interface UseHtml5ScannerReturn {
  scanning: boolean;
  startScanner: () => Promise<void>;
  stopScanner: () => Promise<void>;
  /** Whether the active camera exposes a controllable flashlight. */
  flashlightSupported: boolean;
  /** Whether the flashlight is currently on. */
  flashlightOn: boolean;
  /** Toggle the flashlight (no-op when unsupported). */
  toggleFlashlight: () => Promise<void>;
}

/**
 * Manages the html5-qrcode camera lifecycle: init, start with
 * environment→user facingMode fallback, stop, and cleanup on unmount.
 */
export function useHtml5Scanner({
  viewportId,
  scanConfig,
  onScan,
  formatsToSupport,
}: UseHtml5ScannerOptions): UseHtml5ScannerReturn {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Invalidates an in-flight start when the user stops/closes the scanner
  // while a permission prompt or camera startup is still pending.
  const lifecycleRef = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [flashlightSupported, setFlashlightSupported] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const flashlightOnRef = useRef(false);
  flashlightOnRef.current = flashlightOn;
  // Whether the scanner was live when the page was backgrounded, so it can be
  // resumed on return. See the visibilitychange effect below.
  const wasScanningRef = useRef(false);
  // Keep onScan in a ref so the callback given to html5-qrcode always
  // calls the latest version without restarting the scanner.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stopScanner = useCallback(async () => {
    lifecycleRef.current += 1;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // Already stopped
      }
      try {
        if (typeof scanner.clear === 'function') scanner.clear();
      } catch {
        // The preview may already have been removed with its owning modal.
      }
    }
    setScanning(false);
    setFlashlightOn(false);
    setFlashlightSupported(false);
  }, []);

  const toggleFlashlight = useCallback(async () => {
    const scanner = scannerRef.current;
    // applyVideoConstraints is absent on older browsers (and on test mocks).
    if (!scanner || typeof scanner.applyVideoConstraints !== 'function') return;
    const next = !flashlightOnRef.current;
    try {
      // `torch` is the Web API name for the flashlight; not in the standard
      // MediaTrackConstraints type.
      await scanner.applyVideoConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setFlashlightOn(next);
    } catch {
      // The camera reported torch support but rejected the constraint — hide
      // the affordance rather than leaving a dead button.
      setFlashlightSupported(false);
    }
  }, []);

  const startScanner = useCallback(async () => {
    // Stop any existing instance first
    await stopScanner();
    const lifecycle = lifecycleRef.current;

    // Fail fast with an actionable message on insecure origins (HTTP LAN),
    // where the camera APIs are simply absent.
    const unavailable = getCameraUnavailableReason();
    if (unavailable) throw new Error(unavailable);

    const libConfig: { formatsToSupport?: Html5QrcodeSupportedFormats[]; verbose: boolean } = {
      verbose: false,
    };
    if (formatsToSupport) {
      libConfig.formatsToSupport = formatsToSupport;
    }

    const onSuccess = (decodedText: string) => {
      onScanRef.current(decodedText);
    };
    const onFailure = () => {};

    // Enumerate cameras first — this triggers the browser permission prompt
    // and gives us device IDs across desktop and mobile.
    const cameras = await Html5Qrcode.getCameras();
    if (lifecycle !== lifecycleRef.current) {
      throw new DOMException('Camera startup was cancelled', 'AbortError');
    }
    if (cameras.length === 0) {
      // Named as the DOMException `getUserMedia` raises for the same fact, so
      // `describeCameraError` gives an empty enumeration and a rejected
      // request the one answer they share — this device has no camera — rather
      // than sending one of the two to browser settings for a permission that
      // does not exist.
      const error = new Error('No cameras found on this device');
      error.name = 'NotFoundError';
      throw error;
    }

    // Choose the scan target. Use a device id only when its label reliably
    // identifies a rear camera. In every other case let the browser satisfy an
    // ideal environment constraint. This works for a single desktop webcam as
    // well, while avoiding a common mobile failure where enumeration exposes
    // only the front camera initially and selecting its id prevents the browser
    // from switching to the rear camera.
    const backCamera = cameras.find((c) => /back|rear|environment/i.test(c.label));
    const cameraTarget: string | MediaTrackConstraints = backCamera?.id ?? {
      facingMode: { ideal: 'environment' },
    };

    const startConfig = {
      fps: scanConfig.fps,
      qrbox: makeResponsiveQrbox(scanConfig.qrbox),
    };

    const html5QrCode = new Html5Qrcode(viewportId, libConfig);
    scannerRef.current = html5QrCode;

    try {
      await html5QrCode.start(cameraTarget, startConfig, onSuccess, onFailure);
    } catch (error) {
      // A failed start can still leave a partially-created video track or DOM
      // preview in html5-qrcode. Best-effort cleanup makes retrying work and
      // prevents the mobile camera indicator from remaining on.
      try {
        await html5QrCode.stop();
      } catch {
        // The library rejects stop() when startup failed before it became live.
      }
      try {
        if (typeof html5QrCode.clear === 'function') html5QrCode.clear();
      } catch {
        // The preview may not have been mounted yet.
      }
      if (scannerRef.current === html5QrCode) scannerRef.current = null;
      throw error;
    }
    if (lifecycle !== lifecycleRef.current) {
      try {
        await html5QrCode.stop();
      } catch {
        // It may already have stopped while the start promise was settling.
      }
      try {
        if (typeof html5QrCode.clear === 'function') html5QrCode.clear();
      } catch {
        // The owning viewport may already have unmounted.
      }
      if (scannerRef.current === html5QrCode) scannerRef.current = null;
      throw new DOMException('Camera startup was cancelled', 'AbortError');
    }
    setScanning(true);

    // Detect flashlight capability on the running track (guard: the method is
    // absent on older browsers and on test mocks).
    try {
      const caps =
        typeof html5QrCode.getRunningTrackCapabilities === 'function'
          ? (html5QrCode.getRunningTrackCapabilities() as { torch?: boolean })
          : null;
      setFlashlightSupported(caps?.torch === true);
    } catch {
      setFlashlightSupported(false);
    }
  }, [viewportId, scanConfig, formatsToSupport, stopScanner]);

  // Release the camera while the page is backgrounded, and pick it back up on
  // return. Without this, switching apps or locking the screen mid-scan leaves
  // the capture track held: iOS suspends the track but does not resume it, so
  // the user comes back to a permanently frozen preview, and the OS camera
  // indicator stays lit meanwhile. Restart only if we were actually scanning,
  // so returning to an idle scanner screen doesn't switch the camera on.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (scannerRef.current) {
          wasScanningRef.current = true;
          void stopScanner();
        }
      } else if (wasScanningRef.current) {
        wasScanningRef.current = false;
        void startScanner().catch(() => {
          // Camera may be unavailable on return (permission revoked, device
          // taken by another app). Leave the scanner stopped; the UI's own
          // start control remains available.
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [startScanner, stopScanner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

  return {
    scanning,
    startScanner,
    stopScanner,
    flashlightSupported,
    flashlightOn,
    toggleFlashlight,
  };
}
