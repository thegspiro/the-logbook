import { describe, it, expect, afterEach } from 'vitest';
import JsBarcode from 'jsbarcode';
import { BARCODE_SVG_PRINT_CSS } from './barcodePrintCss';

const SVG_NS = 'http://www.w3.org/2000/svg';

function renderPrintedBarcode(css: string): SVGSVGElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const label = document.createElement('div');
  label.className = 'barcode-label';
  const svg = document.createElementNS(SVG_NS, 'svg');
  label.appendChild(svg);
  document.body.appendChild(label);
  // displayValue needs canvas text metrics, which jsdom lacks; the text is not
  // what this test is about.
  JsBarcode(svg, 'INV-000381', { format: 'CODE128', displayValue: false });
  return svg;
}

describe('BARCODE_SVG_PRINT_CSS', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('keeps the background white and the bars black, so a Code 128 label does not print as a black box', () => {
    const svg = renderPrintedBarcode(BARCODE_SVG_PRINT_CSS);
    const background = svg.querySelector(':scope > rect');
    const bars = svg.querySelectorAll('g rect');

    expect(background).not.toBeNull();
    expect(getComputedStyle(background as Element).fill).toBe('rgb(255, 255, 255)');
    expect(bars.length).toBeGreaterThan(10);
    for (const bar of Array.from(bars)) {
      expect(getComputedStyle(bar).fill).toBe('rgb(0, 0, 0)');
    }
  });
});
