import { Html5QrcodeSupportedFormats } from 'html5-qrcode';

/** QR-only scan config (member ID cards). */
export const QR_SCAN_CONFIG = { fps: 10, qrbox: { width: 250, height: 250 } } as const;

/** Barcode-optimized scan config (wider viewport for linear codes). */
export const BARCODE_SCAN_CONFIG = { fps: 10, qrbox: { width: 250, height: 150 } } as const;

/** Barcode + QR formats supported by the inventory scanner. */
export const INVENTORY_BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.QR_CODE,
];

/** Native BarcodeDetector format strings (mirrors INVENTORY_BARCODE_FORMATS). */
export const NATIVE_BARCODE_FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'] as const;

export const HAS_BARCODE_DETECTOR = typeof window !== 'undefined' && 'BarcodeDetector' in window;

/**
 * Returns a user-facing reason string when the camera cannot be used, or null
 * when it should be available. The common mobile failure is an insecure origin
 * (plain HTTP over a LAN IP): browsers only expose `navigator.mediaDevices` in
 * a secure context, so `getUserMedia` is simply absent and a bare attempt would
 * surface as a confusing "permission denied". Detecting it here lets the UI say
 * something actionable instead.
 */
export function getCameraUnavailableReason(): string | null {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return 'Camera scanning requires a secure (HTTPS) connection. Open this page over HTTPS to scan.';
  }
  return null;
}

/**
 * Turn a failed camera start into something a member can act on.
 *
 * Every scanner passed its error to `getErrorMessage(err, 'Camera access
 * denied. Please allow camera permissions…')`, but a fallback only applies
 * when the error carries no message of its own — and `getUserMedia` always
 * rejects with a `DOMException` that has one. So the friendly copy was dead at
 * all four call sites, and what reached the screen was the browser's own
 * wording: a laptop with no webcam said **"Requested device not found"**, which
 * names no cause and suggests no action.
 *
 * The distinction that matters is in `name`, not in `message`: refusing the
 * permission prompt and having no camera at all are different problems with
 * different fixes, and only one of them is worth going to browser settings for.
 */
export function describeCameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow camera permission for this site in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Use a phone or tablet with a camera, or enter the code by hand.';
    case 'NotReadableError':
      return 'The camera is in use by another app. Close anything else using it, then try again.';
    default:
      return 'The camera could not be started. Check that this device has a working camera and that the browser is allowed to use it.';
  }
}
