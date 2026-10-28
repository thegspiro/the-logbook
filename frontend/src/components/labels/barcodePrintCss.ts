/**
 * Print-time CSS for JsBarcode SVGs, shared by every label print path.
 *
 * JsBarcode draws a white background <rect> as a direct child of the <svg>
 * and the bars as <rect>s inside a <g>. Forcing the bars black guards against
 * a dark-theme or high-contrast fill leaking into the print, but the rule must
 * not reach the background rect: a bare `svg rect { fill: #000 }` painted it
 * black too, and every Code 128 label printed as a solid black box. The QR
 * symbology draws <path>s, which is why switching to QR appeared to fix it.
 */
export const BARCODE_SVG_PRINT_CSS = `
  .barcode-label svg > rect {
    fill: #fff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .barcode-label svg g rect {
    fill: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
`;
