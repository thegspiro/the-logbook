/**
 * Hand a downloaded blob to the browser as a file.
 *
 * Files behind the app's authenticated API cannot be reached with a plain
 * link — the request needs the session cookie and, for state-changing calls,
 * the CSRF header — so they are fetched through the shared client and saved
 * from memory.
 */

/** Strip characters a filesystem or an HTTP header would object to. */
export function safeFileName(name: string, fallback = 'download'): string {
  const cleaned = Array.from(name)
    .filter((char) => char.charCodeAt(0) >= 32 && !'\\/:*?"<>|'.includes(char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
