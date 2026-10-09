/**
 * Saving a file the API served, under the name the server chose.
 *
 * The server names downloads from the record they belong to
 * (`2026-10-08_Engine-1_Pump-Manual.pdf`); fetching through axios rather than
 * a bare link keeps the session-refresh interceptor in the path, and this
 * keeps that name instead of falling back to the uploader's.
 */

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/**
 * The filename in a Content-Disposition header, preferring the RFC 5987
 * `filename*=UTF-8''…` form Starlette sends for non-ASCII names. Directory
 * parts are dropped; the browser would ignore them, but nothing here should
 * depend on that.
 */
export function filenameFromContentDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  let name: string | undefined;
  if (extended?.[1]) {
    try {
      name = decodeURIComponent(extended[1].trim());
    } catch {
      name = undefined;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(header);
    name = (plain?.[1] ?? plain?.[2])?.trim();
  }
  const base = name?.split(/[\\/]/).pop()?.trim();
  return base || undefined;
}

export function saveFile({ blob, filename }: DownloadedFile): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
