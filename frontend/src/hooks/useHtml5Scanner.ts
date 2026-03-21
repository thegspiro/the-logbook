import { useRef, useState, useCallback, useEffect } from 'react';
import { Html5Qrcode, type Html5QrcodeSupportedFormats } from 'html5-qrcode';

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
  }, []);

  const startScanner = useCallback(async () => {
    // Stop any existing instance first
    await stopScanner();

    const config: { formatsToSupport?: Html5QrcodeSupportedFormats[]; verbose: boolean } = {
      verbose: false,
    };
    if (formatsToSupport) {
      config.formatsToSupport = formatsToSupport;
    }

    const html5QrCode = new Html5Qrcode(viewportId, config);
    scannerRef.current = html5QrCode;

    const onSuccess = (decodedText: string) => {
      onScanRef.current(decodedText);
    };
    const onFailure = () => {};

    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        scanConfig,
        onSuccess,
        onFailure,
      );
    } catch {
      await html5QrCode.start(
        { facingMode: 'user' },
        scanConfig,
        onSuccess,
        onFailure,
      );
    }

    setScanning(true);
  }, [viewportId, scanConfig, formatsToSupport, stopScanner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        void scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return { scanning, startScanner, stopScanner };
}
