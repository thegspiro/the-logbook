/**
 * Web NFC support detection, payload decoding, and error messaging.
 *
 * Mirrors the shape of `constants/camera.ts`: the availability check lives
 * here so every call site reports the same actionable reason instead of
 * surfacing a raw DOMException.
 */

/** True when this browser exposes Web NFC (Chrome on Android, secure context). */
export function isNfcSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.NDEFReader === 'function';
}

/**
 * Returns a user-facing reason why NFC cannot be used, or null when it should
 * work. Two distinct failures present identically as a missing `NDEFReader`,
 * and members need to be told which one they are hitting: an insecure origin
 * (plain HTTP over a LAN IP — browsers only expose Web NFC in a secure
 * context) versus a browser that has never shipped the API at all. Without
 * this split, an iPhone user and an admin on http:// both see "NFC
 * unavailable" and neither learns what to do about it.
 */
export function getNfcUnavailableReason(): string | null {
  if (typeof window === 'undefined') return 'NFC is not available in this environment.';
  if (isNfcSupported()) return null;
  if (!window.isSecureContext) {
    return 'NFC requires a secure (HTTPS) connection. Open this page over HTTPS to use NFC tags.';
  }
  return 'This device or browser does not support NFC tags. Use Chrome on Android, or scan the QR code instead.';
}

/**
 * NDEF record types that carry text we can act on. Tags may also hold
 * `mime`, `smart-poster`, or vendor `external` records; those are skipped
 * rather than guessed at.
 */
const TEXT_RECORD_TYPES = new Set(['url', 'absolute-url', 'text']);

/**
 * Decodes a single NDEF record to its text payload, or null when the record
 * carries no text we understand.
 */
export function readNdefRecordText(record: NDEFRecord): string | null {
  if (!TEXT_RECORD_TYPES.has(record.recordType) || !record.data) return null;
  try {
    // `encoding` is only set on `text` records; url records are always UTF-8.
    return new TextDecoder(record.encoding || 'utf-8').decode(record.data);
  } catch {
    // An unknown/unsupported encoding label makes TextDecoder throw. A tag we
    // cannot read is not an error worth surfacing — the scan keeps running.
    return null;
  }
}

/** Returns the first readable text payload across an NDEF message's records. */
export function readNdefMessageText(message: NDEFMessage): string | null {
  for (const record of message.records) {
    const text = readNdefRecordText(record);
    if (text) return text;
  }
  return null;
}

// Event ids are string UUIDs, but the bound is deliberately loose-and-capped
// rather than a strict UUID match so the tag stays readable if id formats ever
// change; the origin check below is what actually makes the value safe.
const EVENT_TAG_PATTERNS = [/^\/events\/([A-Za-z0-9_-]{1,64})\/check-in\/?$/, /^\/events\/([A-Za-z0-9_-]{1,64})\/?$/];

/**
 * Turns the raw text read off an NFC tag into an in-app route, or null when
 * the payload is not one of ours.
 *
 * SECURITY — an NFC tag is writable by anyone holding a phone, so its payload
 * is untrusted input on par with a scanned QR code. Two invariants keep a
 * hostile tag from turning a tap into an open redirect or a
 * `javascript:`/`data:` navigation:
 *
 *  1. The payload is resolved against this app's own origin and rejected
 *     unless it lands back on that exact origin.
 *  2. Only the two known event paths are accepted, and the *normalized* path
 *     is returned — never the raw string — so callers hand a fixed-shape route
 *     to react-router rather than assigning an attacker-supplied URL to
 *     `window.location`.
 */
export function parseEventTagPath(rawPayload: string, origin?: string): string | null {
  const trimmed = rawPayload.trim();
  if (!trimmed) return null;

  const appOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  if (!appOrigin) return null;

  let url: URL;
  try {
    url = new URL(trimmed, appOrigin);
  } catch {
    return null;
  }

  // Rejects other hosts and, because a `javascript:`/`data:` URL parses to an
  // origin of "null", those schemes too.
  if (url.origin !== appOrigin) return null;

  for (const pattern of EVENT_TAG_PATTERNS) {
    const match = pattern.exec(url.pathname);
    const eventId = match?.[1];
    if (eventId) return `/events/${eventId}/check-in`;
  }
  return null;
}

/** Absolute URL to encode onto a tag for an event's self check-in page. */
export function buildEventCheckInUrl(eventId: string, origin?: string): string {
  const appOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${appOrigin}/events/${eventId}/check-in`;
}

/**
 * Maps a Web NFC DOMException to something a member can act on. The spec's
 * names are opaque ("NotReadableError" for an NFC radio that is switched off),
 * so the raw `message` is not worth showing.
 */
export function describeNfcError(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'NFC permission was denied. Allow NFC for this site in your browser settings and try again.';
    case 'NotSupportedError':
      return 'This device does not have NFC hardware available.';
    case 'NotReadableError':
      return 'NFC is switched off. Turn on NFC in your device settings and try again.';
    case 'NetworkError':
      return 'The tag moved away before the transfer finished. Hold the phone still against the tag.';
    case 'AbortError':
      return 'NFC was cancelled.';
    default:
      return fallback;
  }
}
