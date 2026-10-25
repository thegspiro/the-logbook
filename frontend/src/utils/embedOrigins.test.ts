import { describe, it, expect } from 'vitest';
import { normalizeEmbedOrigin, parseEmbedOrigins } from './embedOrigins';

// Mirrors backend/tests/test_form_embedding.py TestOriginRule: the backend is
// the authority, and the two must agree on what the settings screen accepts.
describe('normalizeEmbedOrigin', () => {
  it.each([
    ['https://example.org', 'https://example.org'],
    ['  HTTPS://Example.ORG/ ', 'https://example.org'],
    ['https://www.station-1.example.org:8443', 'https://www.station-1.example.org:8443'],
  ])('accepts %j', (value, expected) => {
    expect(normalizeEmbedOrigin(value)).toBe(expected);
  });

  it.each([
    'http://example.org',
    'example.org',
    'https://*.example.org',
    'https://example.org/apply',
    'https://example.org?x=1',
    'https://example.org; script-src *',
    "https://example.org 'unsafe-inline'",
    'https://-bad.example.org',
    'https://example.org:0',
    'https://example.org:70000',
    "'none'",
    '*',
    '',
  ])('refuses %j', (value) => {
    expect(normalizeEmbedOrigin(value)).toBeNull();
  });
});

describe('parseEmbedOrigins', () => {
  it('reads one per line, skipping blanks and repeats, and reports bad lines as typed', () => {
    expect(parseEmbedOrigins('https://a.org\n\nhttps://A.org/\nwww.b.org\nhttps://b.org')).toEqual({
      origins: ['https://a.org', 'https://b.org'],
      invalid: ['www.b.org'],
    });
  });
});
