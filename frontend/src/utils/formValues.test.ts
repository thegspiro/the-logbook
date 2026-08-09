import { describe, it, expect } from 'vitest';
import { blankToNull, numberOrNull } from './formValues';

describe('blankToNull', () => {
  it('returns null for an emptied field so the backend clears it', () => {
    // The bug this guards: `|| undefined` omitted the key, the backend's
    // exclude_unset dump read that as "leave alone", and the old value
    // survived behind a success toast.
    expect(blankToNull('')).toBeNull();
  });

  it('treats a whitespace-only entry as cleared', () => {
    expect(blankToNull('   ')).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
  });

  it('trims and keeps a real value', () => {
    expect(blankToNull('  @treasurer  ')).toBe('@treasurer');
  });

  it('never returns undefined, which is what caused the drop', () => {
    for (const input of ['', '  ', null, undefined, 'x']) {
      expect(blankToNull(input)).not.toBeUndefined();
    }
  });
});

describe('numberOrNull', () => {
  it('returns null for a blank field', () => {
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
  });

  it('parses a numeric string', () => {
    expect(numberOrNull('12.50')).toBe(12.5);
  });

  it('keeps zero rather than treating it as blank', () => {
    // A $0 shipping rate is a real value, not an absent one.
    expect(numberOrNull('0')).toBe(0);
    expect(numberOrNull(0)).toBe(0);
  });

  it('returns null for a non-numeric entry instead of NaN', () => {
    expect(numberOrNull('abc')).toBeNull();
  });
});
