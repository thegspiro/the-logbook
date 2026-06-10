/**
 * Shared barcode-label size presets + helpers, used by every module's label
 * print page. Mirrors the backend LABEL_FORMATS keys so the on-screen preview
 * and the generated PDF stay in sync.
 */

export interface LabelPreset {
  id: string;
  name: string;
  description: string;
  width: string;
  height: string;
  barcodeHeight: number;
  barcodeWidth: number;
  barcodeFontSize: number;
  nameFontSize: string;
  subtitleFontSize: string;
  padding: string;
  pageWidth: string;
  pageHeight: string;
  columns: number;
  autoRotate: boolean;
}

export const LABEL_PRESETS: LabelPreset[] = [
  {
    id: 'dymo_30252',
    name: 'Dymo 30252',
    description: '1.125" x 3.5" — Standard address label',
    width: '3.5in', height: '1.125in',
    barcodeHeight: 40, barcodeWidth: 1.5, barcodeFontSize: 10,
    nameFontSize: '9pt', subtitleFontSize: '7pt',
    padding: '0.06in 0.1in',
    pageWidth: '3.5in', pageHeight: '1.125in', columns: 1, autoRotate: false,
  },
  {
    id: 'dymo_30256',
    name: 'Dymo 30256',
    description: '2.3125" x 4" — Shipping label',
    width: '4in', height: '2.3125in',
    barcodeHeight: 50, barcodeWidth: 1.8, barcodeFontSize: 14,
    nameFontSize: '11pt', subtitleFontSize: '8pt',
    padding: '0.08in 0.12in',
    pageWidth: '4in', pageHeight: '2.3125in', columns: 1, autoRotate: false,
  },
  {
    id: 'dymo_30334',
    name: 'Dymo 30334',
    description: '2.25" x 1.25" — Multi-purpose label',
    width: '2.25in', height: '1.25in',
    barcodeHeight: 35, barcodeWidth: 1.1, barcodeFontSize: 9,
    nameFontSize: '8pt', subtitleFontSize: '6.5pt',
    padding: '0.05in 0.08in',
    pageWidth: '2.25in', pageHeight: '1.25in', columns: 1, autoRotate: false,
  },
  {
    id: 'dymo_30336',
    name: 'Dymo 30336',
    description: '1" x 2.125" — Small multipurpose label',
    width: '2.125in', height: '1in',
    barcodeHeight: 30, barcodeWidth: 1, barcodeFontSize: 8,
    nameFontSize: '7pt', subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2.125in', pageHeight: '1in', columns: 1, autoRotate: false,
  },
  {
    id: 'rollo_4x6',
    name: 'Rollo 4" x 6"',
    description: '4" x 6" — Shipping label',
    width: '4in', height: '6in',
    barcodeHeight: 60, barcodeWidth: 2, barcodeFontSize: 16,
    nameFontSize: '14pt', subtitleFontSize: '10pt',
    padding: '0.12in 0.2in',
    pageWidth: '4in', pageHeight: '6in', columns: 1, autoRotate: true,
  },
  {
    id: 'rollo_2x1',
    name: 'Rollo / Thermal 2" x 1"',
    description: '2" x 1" — Small thermal label',
    width: '2in', height: '1in',
    barcodeHeight: 32, barcodeWidth: 1, barcodeFontSize: 8,
    nameFontSize: '7pt', subtitleFontSize: '6pt',
    padding: '0.04in 0.08in',
    pageWidth: '2in', pageHeight: '1in', columns: 1, autoRotate: true,
  },
  {
    id: 'thermal_1x1',
    name: 'Thermal 1" x 1"',
    description: '1" x 1" — Square asset tag',
    width: '1in', height: '1in',
    barcodeHeight: 24, barcodeWidth: 0.8, barcodeFontSize: 6,
    nameFontSize: '6pt', subtitleFontSize: '5pt',
    padding: '0.03in',
    pageWidth: '1in', pageHeight: '1in', columns: 1, autoRotate: true,
  },
  {
    id: 'letter',
    name: 'Letter Paper (Grid)',
    description: '8.5" x 11" — 30 labels per page (Avery 5160)',
    width: '2.625in', height: '1in',
    barcodeHeight: 35, barcodeWidth: 1.2, barcodeFontSize: 8,
    nameFontSize: '8pt', subtitleFontSize: '6.5pt',
    padding: '0.05in 0.1in',
    pageWidth: '8.5in', pageHeight: '11in', columns: 3, autoRotate: false,
  },
];

export const DEFAULT_PRESET_ID = 'dymo_30252';
export const CUSTOM_PRESET_ID = 'custom';

/** Code128 supports ASCII 0-127. Strip anything outside that range. */
export function sanitizeForCode128(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[^\x00-\x7F]/g, '');
}

export function isKnownPreset(id: string): boolean {
  return id === CUSTOM_PRESET_ID || LABEL_PRESETS.some((p) => p.id === id);
}

/** Synthesize a preset for an arbitrary width × height (inches) sticker. */
export function buildCustomPreset(widthIn: number, heightIn: number): LabelPreset {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const minDim = Math.min(widthIn, heightIn);
  return {
    id: CUSTOM_PRESET_ID,
    name: 'Custom size',
    description: `${widthIn}" × ${heightIn}" — custom label`,
    width: `${widthIn}in`, height: `${heightIn}in`,
    barcodeHeight: Math.round(clamp(heightIn * 36, 20, 70)),
    barcodeWidth: 1.2,
    barcodeFontSize: Math.round(clamp(minDim * 9, 6, 14)),
    nameFontSize: `${Math.round(clamp(heightIn * 8, 6, 12))}pt`,
    subtitleFontSize: `${Math.round(clamp(heightIn * 6, 5, 10))}pt`,
    padding: '0.05in 0.08in',
    pageWidth: `${widthIn}in`, pageHeight: `${heightIn}in`, columns: 1, autoRotate: true,
  };
}
