/**
 * Return whether a value is an absolute HTTP(S) URL suitable for an external
 * link.  React escapes markup, but it does not reject executable URL schemes
 * such as `javascript:` when a value is assigned to an anchor's `href`.
 */
export function isSafeExternalUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
