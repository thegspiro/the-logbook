/**
 * Draws a browser-printed Code 128 so every module is a whole number of
 * printer dots.
 *
 * JsBarcode draws modules in CSS pixels (1/96"). A 203 dpi thermal head
 * then gets 2.115 dots per module, so bar edges land at a different fraction
 * of a dot each time and round differently: a one-module bar prints 2 or 3
 * dots wide, a two-module bar 4 or 5. On bars that are only 2 dots wide that
 * is a 50% width error, which is what scanners measure. With a whole-dot
 * module every edge sits the same fraction past a dot boundary, so they all
 * round the same way and every bar keeps its exact width.
 *
 * The server-side paths (PDF, ZPL, ESC/POS) already size in dots; see
 * backend/app/utils/label_renderer.py, whose 5 mil floor this mirrors.
 */
import JsBarcode from 'jsbarcode';

const CSS_PX_PER_INCH = 96;

// A browser print cannot ask the printer its resolution, so it is inferred
// from the stock: Dymo LabelWriters are 300 dpi; Rollo, generic thermal and
// the common Zebra desktop models are 203. A custom size is most often a
// generic thermal roll. Letter goes to an office laser or inkjet, where 300
// is also exact at 600 and 1200.
const DPI_300_PRESET_PREFIXES = ['dymo_', 'letter'];

export const THERMAL_DPI = 203;

export function printerDpiFor(presetId: string): number {
  return DPI_300_PRESET_PREFIXES.some((prefix) => presetId.startsWith(prefix)) ? 300 : THERMAL_DPI;
}

/** Horizontal padding in inches from a CSS padding shorthand in inches. */
export function horizontalPaddingInches(padding: string): number {
  const parts = padding
    .trim()
    .split(/\s+/)
    .map((p) => parseFloat(p));
  // CSS shorthand: one value is all sides; two or three put left/right second;
  // four name right second and left fourth.
  const right = parts.length === 1 ? (parts[0] ?? 0) : (parts[1] ?? 0);
  const left = parts.length === 4 ? (parts[3] ?? 0) : right;
  return (Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0);
}

/**
 * Printer dots per module: the whole number nearest the requested module
 * width, stepped down a dot at a time until the symbol fits the label. One
 * dot (5 mil at 203 dpi) is the narrowest that prints at all, so a value too
 * long even then keeps one dot and the label's max-width shrinks it.
 *
 * @param modules  the symbol's width in modules, quiet zones included
 * @param moduleCssPx  the module width the preset asks for, in CSS pixels
 */
export function code128ModuleDots(modules: number, moduleCssPx: number, availableWidthIn: number, dpi: number): number {
  let dots = Math.max(1, Math.round((moduleCssPx / CSS_PX_PER_INCH) * dpi));
  while (dots > 1 && (modules * dots) / dpi > availableWidthIn) {
    dots -= 1;
  }
  return dots;
}

export interface Code128Style {
  /** Module width in CSS pixels, as the preset sizes it on screen. */
  moduleCssPx: number;
  /** Bar height and caption size in CSS pixels; held whatever the module. */
  barHeightCssPx: number;
  fontSizeCssPx: number;
}

/**
 * Draw *value* into *svg* with whole-dot modules. Returns the dots per module,
 * or null if JsBarcode drew nothing to size. Throws what JsBarcode throws for
 * a value Code 128 cannot encode.
 */
export function drawCode128ForPrinter(
  svg: SVGSVGElement,
  value: string,
  style: Code128Style,
  availableWidthIn: number,
  dpi: number
): number | null {
  const draw = (unitsPerCssPx: number) => {
    // ISO/IEC 15417 requires a quiet zone of at least 10x the module
    // (bar) width on each side of a Code128 barcode for reliable scanning.
    const quietZone = Math.ceil(style.moduleCssPx * 10);
    JsBarcode(svg, value, {
      format: 'CODE128',
      width: style.moduleCssPx,
      height: style.barHeightCssPx * unitsPerCssPx,
      displayValue: true,
      fontSize: style.fontSizeCssPx * unitsPerCssPx,
      marginTop: 0,
      marginBottom: unitsPerCssPx,
      marginLeft: quietZone,
      marginRight: quietZone,
      textMargin: unitsPerCssPx,
      font: 'monospace',
    });
  };

  // First pass at screen scale, to count the symbol's modules.
  draw(1);
  const firstWidth = parseFloat(svg.getAttribute('width') ?? '');
  if (!(firstWidth > 0) || !(style.moduleCssPx > 0)) return null;
  const dots = code128ModuleDots(firstWidth / style.moduleCssPx, style.moduleCssPx, availableWidthIn, dpi);

  // CSS pixels each drawing unit occupies once a module is `dots` wide.
  const cssPxPerUnit = ((dots / dpi) * CSS_PX_PER_INCH) / style.moduleCssPx;
  // Second pass: scaling the drawing to whole-dot modules would scale the bar
  // height and caption with it, so draw those in compensating units. A long
  // value stepped down to one dot keeps bars as tall as a short one's.
  draw(1 / cssPxPerUnit);
  const width = parseFloat(svg.getAttribute('width') ?? '');
  const height = parseFloat(svg.getAttribute('height') ?? '');
  svg.setAttribute('width', `${(width * cssPxPerUnit) / CSS_PX_PER_INCH}in`);
  svg.setAttribute('height', `${(height * cssPxPerUnit) / CSS_PX_PER_INCH}in`);
  // Snap edges to device pixels instead of anti-aliasing them: a thermal head
  // has no grey, so a half-covered dot would print or not by rounding.
  svg.setAttribute('shape-rendering', 'crispEdges');
  return dots;
}
