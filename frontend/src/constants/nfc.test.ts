import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildEventCheckInUrl,
  describeNfcError,
  getNfcUnavailableReason,
  isNfcSupported,
  parseEventTagPath,
  readNdefMessageText,
  readNdefRecordText,
} from './nfc';

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

describe('parseEventTagPath', () => {
  it('accepts a same-origin check-in URL', () => {
    expect(parseEventTagPath(`${ORIGIN}/events/abc123/check-in`, ORIGIN)).toBe('/events/abc123/check-in');
  });

  it('accepts a plain event URL and normalizes it to the check-in route', () => {
    expect(parseEventTagPath(`${ORIGIN}/events/abc123`, ORIGIN)).toBe('/events/abc123/check-in');
  });

  it('accepts a relative path', () => {
    expect(parseEventTagPath('/events/abc123/check-in', ORIGIN)).toBe('/events/abc123/check-in');
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(parseEventTagPath(`  ${ORIGIN}/events/abc123/check-in/  `, ORIGIN)).toBe('/events/abc123/check-in');
  });

  // A tag is writable by anyone, so these are the cases that matter.
  it('rejects another origin', () => {
    expect(parseEventTagPath('https://evil.example.com/events/abc123/check-in', ORIGIN)).toBeNull();
  });

  it('rejects a javascript: payload', () => {
    expect(parseEventTagPath('javascript:alert(1)', ORIGIN)).toBeNull();
  });

  it('rejects a data: payload', () => {
    expect(parseEventTagPath('data:text/html,<script>alert(1)</script>', ORIGIN)).toBeNull();
  });

  it('rejects a protocol-relative URL pointing off-origin', () => {
    expect(parseEventTagPath('//evil.example.com/events/abc123/check-in', ORIGIN)).toBeNull();
  });

  it('rejects a same-origin path outside the events routes', () => {
    expect(parseEventTagPath(`${ORIGIN}/admin/users`, ORIGIN)).toBeNull();
  });

  it('rejects an event id longer than the cap', () => {
    expect(parseEventTagPath(`${ORIGIN}/events/${'a'.repeat(65)}/check-in`, ORIGIN)).toBeNull();
  });

  it('rejects an event id containing path traversal', () => {
    expect(parseEventTagPath(`${ORIGIN}/events/../admin/check-in`, ORIGIN)).toBeNull();
  });

  it('rejects empty and unparseable payloads', () => {
    expect(parseEventTagPath('   ', ORIGIN)).toBeNull();
    expect(parseEventTagPath('not a url at all', ORIGIN)).toBeNull();
  });

  it('drops a query string and fragment rather than forwarding them', () => {
    expect(parseEventTagPath(`${ORIGIN}/events/abc123/check-in?next=//evil.com#x`, ORIGIN)).toBe(
      '/events/abc123/check-in'
    );
  });
});

describe('buildEventCheckInUrl', () => {
  it('builds an absolute check-in URL', () => {
    expect(buildEventCheckInUrl('abc123', ORIGIN)).toBe(`${ORIGIN}/events/abc123/check-in`);
  });

  it('round-trips through parseEventTagPath', () => {
    expect(parseEventTagPath(buildEventCheckInUrl('abc123', ORIGIN), ORIGIN)).toBe('/events/abc123/check-in');
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
