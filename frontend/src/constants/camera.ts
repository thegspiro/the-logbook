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
export const NATIVE_BARCODE_FORMATS = [
  'code_128',
  'code_39',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'qr_code',
] as const;

export const HAS_BARCODE_DETECTOR =
  typeof window !== 'undefined' && 'BarcodeDetector' in window;

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
