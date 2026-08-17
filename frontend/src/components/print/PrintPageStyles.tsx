/**
 * Shared page setup for the print routes.
 *
 * Six routes render a white letter-size sheet on a neutral grey "desk" and then
 * call `window.print()`. Each carried its own copy of the same three-line style
 * block, which is exactly how the 2026-08-15 move of the application canvas
 * altered all six of them without a single one referencing the rule that
 * changed. One component, so the next canvas change has one place to look.
 *
 * **Why the desk cannot be set on `body`.** A background on `body` reaches the
 * window only while the root element's `background-image` is `none` and its
 * `background-color` is `transparent` (CSS Backgrounds & Borders §2.11.2).
 * `styles/index.css` paints the themed gradient on `html`, so that propagation
 * no longer happens and a `body` rule paints the body box alone — leaving the
 * app gradient framing the sheet. The desk is therefore a root-level concern
 * too: this marks the root element, and the rule answering that mark lives
 * beside the canvas rule in `index.css`, where someone moving the canvas will
 * see it.
 *
 * A class on the root rather than a `<style>` rule because the cascade between
 * two `html` selectors would otherwise be decided by stylesheet order — which
 * is stable today and is not a thing to depend on.
 */

import { useEffect } from 'react';
import { buildPrintPageCss, PRINT_PREVIEW_CLASS, type PrintPageOptions } from './printPageCss';

const PrintPageStyles: React.FC<PrintPageOptions> = ({ size = 'letter', margin }) => {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(PRINT_PREVIEW_CLASS);
    return () => root.classList.remove(PRINT_PREVIEW_CLASS);
  }, []);

  return <style>{buildPrintPageCss({ size, margin })}</style>;
};

export default PrintPageStyles;
