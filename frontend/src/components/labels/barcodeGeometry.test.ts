import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  THERMAL_DPI,
  code128ModuleDots,
  drawCode128ForPrinter,
  horizontalPaddingInches,
  printerDpiFor,
} from './barcodeGeometry';

// A 10-character value in Code 128 B: start 11 + 10 x 11 + check 11 + stop
// 13 = 145 modules, plus a 10-module quiet zone either side.
const MODULES_10_CHARS = 165;

describe('printerDpiFor', () => {
  it('reads a Dymo or Letter sheet as 300 dpi and every thermal roll as 203', () => {
    expect(printerDpiFor('dymo_30252')).toBe(300);
    expect(printerDpiFor('letter')).toBe(300);
    expect(printerDpiFor('rollo_2x1')).toBe(THERMAL_DPI);
    expect(printerDpiFor('zebra_4x6')).toBe(THERMAL_DPI);
    expect(printerDpiFor('thermal_1x1')).toBe(THERMAL_DPI);
    expect(printerDpiFor('custom')).toBe(THERMAL_DPI);
  });
});

describe('horizontalPaddingInches', () => {
  it('reads the left and right padding from each shorthand form', () => {
    expect(horizontalPaddingInches('0.03in')).toBeCloseTo(0.06);
    expect(horizontalPaddingInches('0.04in 0.08in')).toBeCloseTo(0.16);
    expect(horizontalPaddingInches('0.04in 0.08in 0.02in')).toBeCloseTo(0.16);
    expect(horizontalPaddingInches('0.01in 0.1in 0.02in 0.2in')).toBeCloseTo(0.3);
  });
});

describe('code128ModuleDots', () => {
  it('prints a 1 px module on a 2" x 1" Rollo label as 2 dots', () => {
    // 1 px = 2.115 dots at 203 dpi.
    expect(code128ModuleDots(MODULES_10_CHARS, 1, 1.84, 203)).toBe(2);
  });

  it('rounds a 1.5 px Dymo module to the nearest whole dot at 300 dpi', () => {
    // 1.5 px = 4.69 dots at 300 dpi.
    expect(code128ModuleDots(MODULES_10_CHARS, 1.5, 3.3, 300)).toBe(5);
  });

  it('steps down a dot at a time to fit narrow stock', () => {
    // 1" square tag: 165 modules at 2 dots is 1.63", at 1 dot 0.81".
    expect(code128ModuleDots(MODULES_10_CHARS, 0.8, 0.94, 203)).toBe(1);
  });

  it('never goes below one dot, even when nothing fits', () => {
    expect(code128ModuleDots(400, 1, 0.5, 203)).toBe(1);
  });
});

describe('drawCode128ForPrinter', () => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STYLE = { moduleCssPx: 1, barHeightCssPx: 32, fontSizeCssPx: 8 };

  // JsBarcode measures its caption on a canvas, which jsdom does not have.
  // A fixed advance per character stands in; the caption is not under test.
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: '',
      measureText: (text: string) => ({ width: text.length * 4 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  /** Inches per drawing unit, from the SVG's printed width and its viewBox. */
  const inchesPerUnit = (svg: SVGSVGElement) =>
    parseFloat(svg.getAttribute('width') ?? '') / parseFloat(svg.getAttribute('viewBox')?.split(' ')[2] ?? '');

  const barRects = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('g rect'));

  it('draws every bar a whole, even number of 203 dpi dots wide', () => {
    const svg = document.createElementNS(SVG_NS, 'svg');

    const dots = drawCode128ForPrinter(svg, 'INV-000381', STYLE, 1.84, 203);

    expect(dots).toBe(2);
    expect(svg.getAttribute('width')).toMatch(/in$/);
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    const perUnit = inchesPerUnit(svg);
    expect(barRects(svg).length).toBeGreaterThan(20);
    for (const bar of barRects(svg)) {
      const widthDots = parseFloat(bar.getAttribute('width') ?? '') * perUnit * 203;
      expect(widthDots).toBeCloseTo(Math.round(widthDots), 6);
      expect(Math.round(widthDots) % 2).toBe(0);
    }
  });

  it('keeps the bar height when a long value steps down to one dot', () => {
    const short = document.createElementNS(SVG_NS, 'svg');
    const long = document.createElementNS(SVG_NS, 'svg');

    expect(drawCode128ForPrinter(short, 'INV-000381', STYLE, 1.84, 203)).toBe(2);
    expect(drawCode128ForPrinter(long, 'SCBA-PACK-0042', STYLE, 1.84, 203)).toBe(1);

    const barHeightIn = (svg: SVGSVGElement) =>
      parseFloat(barRects(svg)[0]?.getAttribute('height') ?? '') * inchesPerUnit(svg);
    // 32 CSS px = 1/3", whatever the module width came to.
    expect(barHeightIn(short)).toBeCloseTo(32 / 96, 6);
    expect(barHeightIn(long)).toBeCloseTo(32 / 96, 6);
  });

  it('returns null and leaves the size alone when nothing was drawn', () => {
    const svg = document.createElementNS(SVG_NS, 'svg');

    expect(drawCode128ForPrinter(svg, 'INV-1', { ...STYLE, moduleCssPx: 0 }, 1.84, 203)).toBeNull();
    expect(svg.getAttribute('shape-rendering')).toBeNull();
  });
});
