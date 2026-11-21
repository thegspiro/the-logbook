/**
 * Whether a department logo URL is safe to put in an `<img src>`.
 *
 * SEC: rejects `javascript:` and `data:text/html`, and SVG data URIs, which can
 * carry script. Only http(s), same-origin paths and raster image data URIs pass.
 * Shared by the app shell and the print pages that show the logo, so one check
 * governs every place it is drawn.
 */
export function isValidLogoUrl(url: string): boolean {
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('/') ||
    url.startsWith('data:image/png') ||
    url.startsWith('data:image/jpeg') ||
    url.startsWith('data:image/webp') ||
    url.startsWith('data:image/gif')
  );
}
