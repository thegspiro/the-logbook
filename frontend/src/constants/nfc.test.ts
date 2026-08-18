import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildAdminHoursClockInUrl,
  buildEventCheckInUrl,
  buildShiftCheckInUrl,
  describeNfcError,
  getNfcUnavailableReason,
  isNfcSupported,
  parseNfcTagPath,
  readNdefMessageText,
  readNdefRecordText,
} from './nfc';
import { NfcTagTarget } from './enums';

const ORIGIN = 'https://logbook.example.org';

function textRecord(recordType: string, value: string, encoding?: string): NDEFRecord {
  const bytes = new TextEncoder().encode(value);
  return {
    recordType,
    ...(encoding ? { encoding } : {}),
    data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { NDEFReader?: unknown }).NDEFReader;
});

describe('isNfcSupported / getNfcUnavailableReason', () => {
  it('reports unsupported when NDEFReader is absent', () => {
    expect(isNfcSupported()).toBe(false);
  });

  it('reports supported once NDEFReader exists', () => {
    (window as { NDEFReader?: unknown }).NDEFReader = function () {};
    expect(isNfcSupported()).toBe(true);
    expect(getNfcUnavailableReason()).toBeNull();
  });

  it('blames the insecure origin rather than the browser when not a secure context', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(getNfcUnavailableReason()).toContain('HTTPS');
  });

  it('blames the browser when the context is secure but the API is missing', () => {
    vi.stubGlobal('isSecureContext', true);
    const reason = getNfcUnavailableReason();
    expect(reason).toContain('does not support NFC');
    expect(reason).not.toContain('HTTPS');
  });
});

describe('readNdefRecordText', () => {
  it('decodes url records', () => {
    expect(readNdefRecordText(textRecord('url', `${ORIGIN}/events/abc/check-in`))).toBe(
      `${ORIGIN}/events/abc/check-in`
    );
  });

  it('decodes text records honouring the declared encoding', () => {
    expect(readNdefRecordText(textRecord('text', 'hello', 'utf-8'))).toBe('hello');
  });

  it('skips record types that carry no readable text', () => {
    expect(readNdefRecordText(textRecord('mime', 'ignored'))).toBeNull();
  });

  it('skips a record with no data', () => {
    expect(readNdefRecordText({ recordType: 'url' })).toBeNull();
  });

  it('returns null instead of throwing on an unsupported encoding label', () => {
    expect(readNdefRecordText(textRecord('text', 'hello', 'not-a-real-encoding'))).toBeNull();
  });

  it('returns the first readable record in a message', () => {
    const message: NDEFMessage = {
      records: [textRecord('mime', 'skipped'), textRecord('url', `${ORIGIN}/events/xyz/check-in`)],
    };
    expect(readNdefMessageText(message)).toBe(`${ORIGIN}/events/xyz/check-in`);
  });

  it('returns null when a message holds nothing readable', () => {
    expect(readNdefMessageText({ records: [textRecord('mime', 'skipped')] })).toBeNull();
  });
});

describe('parseNfcTagPath — event check-in', () => {
  it('accepts a same-origin check-in URL', () => {
    expect(parseNfcTagPath(`${ORIGIN}/events/abc123/check-in`, ORIGIN)).toEqual({
      target: NfcTagTarget.EVENT_CHECK_IN,
      path: '/events/abc123/check-in',
    });
  });

  it('accepts a plain event URL and normalizes it to the check-in route', () => {
    expect(parseNfcTagPath(`${ORIGIN}/events/abc123`, ORIGIN)?.path).toBe('/events/abc123/check-in');
  });

  it('accepts a relative path', () => {
    expect(parseNfcTagPath('/events/abc123/check-in', ORIGIN)?.path).toBe('/events/abc123/check-in');
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(parseNfcTagPath(`  ${ORIGIN}/events/abc123/check-in/  `, ORIGIN)?.path).toBe('/events/abc123/check-in');
  });

  it('rejects a deeper events route the tag has no business naming', () => {
    expect(parseNfcTagPath(`${ORIGIN}/events/abc123/edit`, ORIGIN)).toBeNull();
    expect(parseNfcTagPath(`${ORIGIN}/events/abc123/qr-code`, ORIGIN)).toBeNull();
  });
});

describe('parseNfcTagPath — admin hours clock-in', () => {
  it('accepts a clock-in URL', () => {
    expect(parseNfcTagPath(`${ORIGIN}/admin-hours/cat-9/clock-in`, ORIGIN)).toEqual({
      target: NfcTagTarget.ADMIN_HOURS_CLOCK_IN,
      path: '/admin-hours/cat-9/clock-in',
    });
  });

  it('rejects the admin hours QR page and the module root', () => {
    expect(parseNfcTagPath(`${ORIGIN}/admin-hours/categories/cat-9/qr-code`, ORIGIN)).toBeNull();
    expect(parseNfcTagPath(`${ORIGIN}/admin-hours`, ORIGIN)).toBeNull();
  });
});

describe('parseNfcTagPath — shift check-in', () => {
  it('accepts an apparatus-keyed tag', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin?apparatus=eng-4`, ORIGIN)).toEqual({
      target: NfcTagTarget.SHIFT_CHECK_IN,
      path: '/scheduling/checkin?apparatus=eng-4',
    });
  });

  it('accepts a shift-keyed tag', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin?shift=shift-7`, ORIGIN)?.path).toBe(
      '/scheduling/checkin?shift=shift-7'
    );
  });

  // ShiftCheckInPage reads `shift` first, so the parsed route has to agree.
  it('prefers shift over apparatus when a tag carries both', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin?apparatus=eng-4&shift=shift-7`, ORIGIN)?.path).toBe(
      '/scheduling/checkin?shift=shift-7'
    );
  });

  it('falls through to apparatus when the shift value is malformed', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin?shift=../admin&apparatus=eng-4`, ORIGIN)?.path).toBe(
      '/scheduling/checkin?apparatus=eng-4'
    );
  });

  it('rejects the route with no id parameter at all', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin`, ORIGIN)).toBeNull();
  });

  it('rejects an id parameter that is present but empty', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin?apparatus=`, ORIGIN)).toBeNull();
  });

  // The parser rebuilds the route, so parameters it does not name cannot ride
  // along on an otherwise legitimate path.
  it('drops query parameters outside the spec', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin?apparatus=eng-4&next=//evil.com&admin=1`, ORIGIN)?.path).toBe(
      '/scheduling/checkin?apparatus=eng-4'
    );
  });

  it('rejects the print route, which is not a check-in', () => {
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin/print?apparatus=eng-4`, ORIGIN)).toBeNull();
  });
});

describe('parseNfcTagPath — hostile payloads', () => {
  it('rejects another origin', () => {
    expect(parseNfcTagPath('https://evil.example.com/events/abc123/check-in', ORIGIN)).toBeNull();
  });

  it('rejects a javascript: payload', () => {
    expect(parseNfcTagPath('javascript:alert(1)', ORIGIN)).toBeNull();
  });

  it('rejects a data: payload', () => {
    expect(parseNfcTagPath('data:text/html,<script>alert(1)</script>', ORIGIN)).toBeNull();
  });

  it('rejects a protocol-relative URL pointing off-origin', () => {
    expect(parseNfcTagPath('//evil.example.com/events/abc123/check-in', ORIGIN)).toBeNull();
  });

  it('rejects a same-origin path outside every target', () => {
    expect(parseNfcTagPath(`${ORIGIN}/admin/users`, ORIGIN)).toBeNull();
  });

  // A public kiosk code on a readable tag would hand it to anyone walking past.
  it('rejects the public display kiosk route', () => {
    expect(parseNfcTagPath(`${ORIGIN}/display/ABC123`, ORIGIN)).toBeNull();
  });

  it('rejects an id longer than the cap', () => {
    expect(parseNfcTagPath(`${ORIGIN}/events/${'a'.repeat(65)}/check-in`, ORIGIN)).toBeNull();
    expect(parseNfcTagPath(`${ORIGIN}/scheduling/checkin?apparatus=${'a'.repeat(65)}`, ORIGIN)).toBeNull();
  });

  it('rejects an id containing path traversal', () => {
    expect(parseNfcTagPath(`${ORIGIN}/events/../admin/check-in`, ORIGIN)).toBeNull();
  });

  it('rejects a percent-encoded separator smuggled into an id', () => {
    expect(parseNfcTagPath(`${ORIGIN}/events/abc%2F..%2Fadmin/check-in`, ORIGIN)).toBeNull();
  });

  it('rejects empty and unparseable payloads', () => {
    expect(parseNfcTagPath('   ', ORIGIN)).toBeNull();
    expect(parseNfcTagPath('not a url at all', ORIGIN)).toBeNull();
  });

  it('drops a query string and fragment on a path-only target', () => {
    expect(parseNfcTagPath(`${ORIGIN}/events/abc123/check-in?next=//evil.com#x`, ORIGIN)?.path).toBe(
      '/events/abc123/check-in'
    );
  });
});

describe('tag URL builders round-trip through the parser', () => {
  it('builds and parses an event check-in URL', () => {
    const url = buildEventCheckInUrl('abc123', ORIGIN);
    expect(url).toBe(`${ORIGIN}/events/abc123/check-in`);
    expect(parseNfcTagPath(url, ORIGIN)).toEqual({
      target: NfcTagTarget.EVENT_CHECK_IN,
      path: '/events/abc123/check-in',
    });
  });

  it('builds and parses an admin hours clock-in URL', () => {
    const url = buildAdminHoursClockInUrl('cat-9', ORIGIN);
    expect(url).toBe(`${ORIGIN}/admin-hours/cat-9/clock-in`);
    expect(parseNfcTagPath(url, ORIGIN)?.target).toBe(NfcTagTarget.ADMIN_HOURS_CLOCK_IN);
  });

  it('builds and parses an apparatus shift check-in URL', () => {
    const url = buildShiftCheckInUrl({ apparatusId: 'eng-4' }, ORIGIN);
    expect(url).toBe(`${ORIGIN}/scheduling/checkin?apparatus=eng-4`);
    expect(parseNfcTagPath(url, ORIGIN)?.path).toBe('/scheduling/checkin?apparatus=eng-4');
  });

  it('builds and parses a shift-keyed check-in URL', () => {
    const url = buildShiftCheckInUrl({ shiftId: 'shift-7' }, ORIGIN);
    expect(url).toBe(`${ORIGIN}/scheduling/checkin?shift=shift-7`);
    expect(parseNfcTagPath(url, ORIGIN)?.path).toBe('/scheduling/checkin?shift=shift-7');
  });
});

describe('describeNfcError', () => {
  it.each([
    ['NotAllowedError', 'permission'],
    ['NotSupportedError', 'NFC hardware'],
    ['NotReadableError', 'switched off'],
    ['NetworkError', 'moved away'],
  ])('maps %s to actionable copy', (name, expected) => {
    const err = new Error('raw');
    err.name = name;
    expect(describeNfcError(err, 'fallback')).toContain(expected);
  });

  it('falls back for unrecognized errors', () => {
    expect(describeNfcError(new Error('boom'), 'fallback')).toBe('fallback');
    expect(describeNfcError('a string', 'fallback')).toBe('fallback');
  });
});
