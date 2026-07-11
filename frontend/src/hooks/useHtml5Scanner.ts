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
    const scale = Math.min(
      1,
      (viewfinderWidth * 0.8) / target.width,
      (viewfinderHeight * 0.8) / target.height,
    );
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
  const [scanning, setScanning] = useState(false);
  const [flashlightSupported, setFlashlightSupported] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const flashlightOnRef = useRef(false);
  flashlightOnRef.current = flashlightOn;
  // Keep onScan in a ref so the callback given to html5-qrcode always
  // calls the latest version without restarting the scanner.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Already stopped
      }
      scannerRef.current = null;
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
    if (cameras.length === 0) {
      throw new Error('No cameras found on this device');
    }

    // Choose the scan target. Use a back-camera device id only when its label
    // reliably identifies it, or when there is a single camera (desktop
    // webcam). Otherwise hand html5-qrcode a facingMode:environment constraint
    // and let the browser pick the rear camera — matching labels alone is
    // unreliable on mobile (labels are empty before permission is granted and
    // localized on many devices), and falling back to cameras[0] frequently
    // selects the FRONT camera.
    const backCamera = cameras.find((c) => /back|rear|environment/i.test(c.label));
    const cameraTarget: string | MediaTrackConstraints =
      backCamera?.id ??
      (cameras.length === 1 && cameras[0]
        ? cameras[0].id
        : { facingMode: { ideal: 'environment' } });

    const startConfig = {
      fps: scanConfig.fps,
      qrbox: makeResponsiveQrbox(scanConfig.qrbox),
    };

    const html5QrCode = new Html5Qrcode(viewportId, libConfig);
    scannerRef.current = html5QrCode;

    await html5QrCode.start(cameraTarget, startConfig, onSuccess, onFailure);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        void scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return {
    scanning,
    startScanner,
    stopScanner,
    flashlightSupported,
    flashlightOn,
    toggleFlashlight,
  };
}
