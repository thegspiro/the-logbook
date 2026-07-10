/**
 * Print environment detection.
 *
 * The label pages print by writing markup into a hidden iframe and calling
 * `iframe.contentWindow.print()`. That is reliable on desktop, but mobile
 * Safari frequently prints a blank page (or the parent document) from a
 * detached/hidden iframe. On such devices we prefer a server-generated PDF the
 * user can view, print, or share through the OS instead.
 */
export function prefersPdfOverBrowserPrint(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  // Coarse pointer + no hover ≈ phone/tablet touchscreen (excludes touch
  // laptops, which still print reliably).
  return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
}
