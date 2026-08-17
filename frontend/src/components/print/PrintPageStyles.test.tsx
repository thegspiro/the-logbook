import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PrintPageStyles from './PrintPageStyles';
import { PRINT_PREVIEW_CLASS, buildPrintPageCss } from './printPageCss';

// Comments stripped first: these rules are heavily commented — deliberately, since
// the comments are what tell the next reader why the canvas lives on the root —
// and a selector matcher would otherwise scoop up the prose above the selector.
const stylesheet = readFileSync(join(__dirname, '../../styles/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * These assertions read the stylesheet rather than a rendered page on purpose.
 *
 * jsdom does not apply the real cascade, so no DOM assertion can catch what
 * actually went wrong on 2026-08-15: the themed canvas moved from `body` to
 * `html`, and six print routes lost their grey desk because a `body` background
 * only reaches the window while the root's own background is transparent
 * (CSS Backgrounds & Borders §2.11.2). Nothing referenced the rule that moved,
 * so nothing went red.
 *
 * What is guarded is the invariant, not the formatting: the root owns the
 * canvas, the print-preview override sits on the root beside it, and the print
 * reset names the root explicitly.
 */
describe('application canvas contract', () => {
  it('paints the canvas on the root element, not the body', () => {
    const htmlRule = /\bhtml\s*\{[^}]*background:\s*linear-gradient/.test(stylesheet);
    expect(htmlRule).toBe(true);

    // The body rule must not re-take the canvas: two painted backgrounds means
    // the body one silently wins nothing and the print routes break again.
    const bodyRule = /\nbody\s*\{([^}]*)\}/.exec(stylesheet);
    expect(bodyRule).not.toBeNull();
    expect(bodyRule?.[1]).not.toMatch(/background:\s*linear-gradient/);
  });

  it('gives print routes a root-level override for their grey desk', () => {
    // Must be on the root. A `body` background cannot reach the window while the
    // root is painted, which is the whole reason this rule exists.
    expect(stylesheet).toMatch(new RegExp(`html\\.${PRINT_PREVIEW_CLASS}\\s*\\{[^}]*background:\\s*#f3f4f6`, 'i'));
  });

  it('names html in the print reset so light mode is covered', () => {
    const printBlock = /@media print \{([\s\S]*?)\n\}/.exec(stylesheet);
    expect(printBlock).not.toBeNull();

    // Find the rule that whitens the page and read its selector list, rather
    // than matching a fixed layout — Prettier owns the line breaks between
    // selectors and must be free to change them.
    const whitenRule = /([^{}]+)\{[^{}]*background:\s*white\s*!important/.exec(printBlock?.[1] ?? '');
    const selectors = (whitenRule?.[1] ?? '').split(',').map((sel) => sel.trim());

    // `.dark` lands on documentElement via ThemeContext, so it happens to cover
    // the root in dark mode. Without `html` here, light mode prints the gradient
    // whenever the reader has "Background graphics" enabled.
    expect(selectors, 'the print reset must whiten the root element, not only body/main/.dark').toContain('html');
  });
});

describe('PrintPageStyles', () => {
  it('marks the root element while mounted and cleans up after itself', () => {
    expect(document.documentElement.classList.contains(PRINT_PREVIEW_CLASS)).toBe(false);

    const { unmount } = render(<PrintPageStyles margin="0.5in 0.6in" />);
    expect(document.documentElement.classList.contains(PRINT_PREVIEW_CLASS)).toBe(true);

    // Navigating away from a print route must restore the themed canvas.
    unmount();
    expect(document.documentElement.classList.contains(PRINT_PREVIEW_CLASS)).toBe(false);
  });

  it('emits the page box the caller asked for', () => {
    expect(buildPrintPageCss({ size: 'letter landscape', margin: '0.4in 0.5in' })).toContain(
      '@page { size: letter landscape; margin: 0.4in 0.5in; }'
    );
  });

  it('defaults to letter portrait', () => {
    expect(buildPrintPageCss({ margin: '0.6in 0.75in' })).toContain('@page { size: letter; margin: 0.6in 0.75in; }');
  });

  it('zeroes the body box for print', () => {
    expect(buildPrintPageCss({ margin: '0.5in 0.6in' })).toContain('@media print { body { margin: 0; padding: 0; } }');
  });
});
