import { describe, expect, it } from 'vitest';

import { isSafeExternalUrl } from './safeUrl';

describe('isSafeExternalUrl', () => {
  it.each(['https://example.org/path', 'http://localhost:3000/docs'])('accepts %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/relative', 'not a url'])(
    'rejects %s',
    (url) => {
      expect(isSafeExternalUrl(url)).toBe(false);
    }
  );

  it.each([null, undefined, ''])('rejects an absent value (%s)', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });
});
