import { describe, it, expect } from 'vitest';
import { slugKey, uniqueKey } from './outlineKeys';

describe('slugKey', () => {
  it('lowercases and joins words with underscores', () => {
    expect(slugKey("Treasurer's Report")).toBe('treasurer_s_report');
  });

  it('drops accents and punctuation', () => {
    expect(slugKey('Réunion — Ordre du jour!')).toBe('reunion_ordre_du_jour');
  });

  it('never returns something the server would refuse', () => {
    for (const title of ['', '   ', '###', '📋', 'A'.repeat(200)]) {
      expect(slugKey(title)).toMatch(/^[a-z0-9][a-z0-9_]*$/);
      expect(slugKey(title).length).toBeLessThanOrEqual(60);
    }
  });
});

describe('uniqueKey', () => {
  it('keeps the plain key when it is free', () => {
    expect(uniqueKey('Old Business', new Set(['new_business']))).toBe('old_business');
  });

  it('numbers a clash rather than reusing the key', () => {
    const taken = new Set(['old_business', 'old_business_2']);
    expect(uniqueKey('Old Business', taken)).toBe('old_business_3');
  });
});
