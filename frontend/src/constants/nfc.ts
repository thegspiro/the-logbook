import { NfcTagTarget } from './enums';

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

/**
 * Ids are string UUIDs, but the bound is deliberately loose-and-capped rather
 * than a strict UUID match so tags stay readable if id formats ever change.
 * The origin check in `parseNfcTagPath` is what actually makes a value safe;
 * this only keeps a matched id to a plausible shape.
 */
const TAG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface NfcTargetSpec {
  target: NfcTagTarget;
  /** Matched against `url.pathname`; every capture group must be a valid id. */
  pathPattern: RegExp;
  /**
   * Query parameters that carry an id, in precedence order. When a spec names
   * any, at least one must be present and valid for the tag to match, and only
   * the first valid one is carried into the returned route.
   */
  idQueryParams?: readonly string[];
  /** Rebuilds the canonical in-app route from already-validated pieces. */
  toPath: (ids: readonly string[], query: { name: string; value: string } | null) => string;
}

/**
 * Every destination a tag may point at.
 *
 * `/display/:code` is deliberately absent. It is a public, unauthenticated
 * kiosk screen for a tablet left in a room, keyed by a non-guessable code —
 * putting that code on a tag anyone can read hands it to whoever walks past,
 * and routing a member's phone to a wall display is not a check-in anyway.
 */
const TAG_TARGETS: readonly NfcTargetSpec[] = [
  {
    target: NfcTagTarget.EVENT_CHECK_IN,
    // A tag written against the plain event page still means "check in here".
    pathPattern: /^\/events\/([^/]+)(?:\/check-in)?\/?$/,
    toPath: (ids) => `/events/${ids[0]}/check-in`,
  },
  {
    target: NfcTagTarget.ADMIN_HOURS_CLOCK_IN,
    pathPattern: /^\/admin-hours\/([^/]+)\/clock-in\/?$/,
    toPath: (ids) => `/admin-hours/${ids[0]}/clock-in`,
  },
  {
    target: NfcTagTarget.SHIFT_CHECK_IN,
    pathPattern: /^\/scheduling\/checkin\/?$/,
    // `apparatus` resolves to whichever shift is running when the tag is
    // tapped, so a tag on the truck outlives every individual shift. `shift`
    // is checked first because ShiftCheckInPage prefers it, and the parsed
    // route has to mean what the page will do with it.
    idQueryParams: ['shift', 'apparatus'],
    toPath: (_ids, query) => `/scheduling/checkin?${query?.name}=${encodeURIComponent(query?.value ?? '')}`,
  },
];

export interface NfcTagMatch {
  /** Which kind of destination the tag named. */
  target: NfcTagTarget;
  /** Canonical in-app route, rebuilt from validated pieces. */
  path: string;
}

/**
 * Turns the raw text read off an NFC tag into an in-app route, or null when
 * the payload is not one of ours.
 *
 * SECURITY — an NFC tag is writable by anyone holding a phone, so its payload
 * is untrusted input on par with a scanned QR code. Four invariants keep a
 * hostile tag from turning a tap into an open redirect or a
 * `javascript:`/`data:` navigation:
 *
 *  1. The payload is resolved against this app's own origin and rejected
 *     unless it lands back on that exact origin.
 *  2. Only the paths named in `TAG_TARGETS` are accepted.
 *  3. Every id — captured from the path or read from a query parameter — must
 *     match `TAG_ID_PATTERN`. A parameter the spec does not name is dropped
 *     rather than forwarded, so a tag cannot smuggle `?next=` past the parser
 *     by hanging it off a route that is otherwise legitimate.
 *  4. The route is **rebuilt** from those validated pieces — the raw string is
 *     never returned — so callers hand a fixed-shape path to react-router
 *     rather than assigning an attacker-supplied URL to `window.location`.
 */
export function parseNfcTagPath(rawPayload: string, origin?: string): NfcTagMatch | null {
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

  for (const spec of TAG_TARGETS) {
    const match = spec.pathPattern.exec(url.pathname);
    if (!match) continue;

    const ids = match.slice(1);
    if (ids.some((id) => !id || !TAG_ID_PATTERN.test(id))) continue;

    let query: { name: string; value: string } | null = null;
    if (spec.idQueryParams) {
      for (const name of spec.idQueryParams) {
        const value = url.searchParams.get(name);
        if (value && TAG_ID_PATTERN.test(value)) {
          query = { name, value };
          break;
        }
      }
      // A spec that names id parameters cannot be satisfied without one.
      if (!query) continue;
    }

    return { target: spec.target, path: spec.toPath(ids, query) };
  }
  return null;
}

/**
 * What tapping a tag of this kind does, as a noun phrase — "opens Engine 4
 * shift check-in". Lives beside the registry so a new target cannot be added
 * without deciding how the UI names it.
 */
const TARGET_ACTION_NOUNS: Record<NfcTagTarget, string> = {
  [NfcTagTarget.EVENT_CHECK_IN]: 'check-in',
  [NfcTagTarget.ADMIN_HOURS_CLOCK_IN]: 'clock-in',
  [NfcTagTarget.SHIFT_CHECK_IN]: 'shift check-in',
};

export function nfcActionNoun(target: NfcTagTarget): string {
  return TARGET_ACTION_NOUNS[target];
}

function withOrigin(origin: string | undefined, path: string): string {
  const appOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${appOrigin}${path}`;
}

/** Absolute URL to encode onto a tag for an event's self check-in page. */
export function buildEventCheckInUrl(eventId: string, origin?: string): string {
  return withOrigin(origin, `/events/${eventId}/check-in`);
}

/** Absolute URL to encode onto a tag for an admin hours category's clock-in. */
export function buildAdminHoursClockInUrl(categoryId: string, origin?: string): string {
  return withOrigin(origin, `/admin-hours/${categoryId}/clock-in`);
}

/**
 * Absolute URL to encode onto a tag for shift check-in.
 *
 * Prefer the apparatus form for anything physically mounted: it resolves to
 * whichever shift is running at tap time, so one tag on the truck serves every
 * shift, where a shift-keyed tag is dead the moment that shift ends.
 */
export function buildShiftCheckInUrl(ref: { apparatusId: string } | { shiftId: string }, origin?: string): string {
  const query = 'apparatusId' in ref ? `apparatus=${ref.apparatusId}` : `shift=${ref.shiftId}`;
  return withOrigin(origin, `/scheduling/checkin?${query}`);
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
