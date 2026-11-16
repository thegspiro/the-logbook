import { describe, expect, it } from 'vitest';
import { toStr } from './export';

describe('toStr', () => {
  it('shows nothing, or the fallback, for a missing value', () => {
    expect(toStr(null)).toBe('');
    expect(toStr(undefined, '-')).toBe('-');
  });

  it('shows text, numbers and booleans as written', () => {
    expect(toStr("O'Brien & Sons")).toBe("O'Brien & Sons");
    expect(toStr(2.5)).toBe('2.5');
    expect(toStr(false)).toBe('false');
  });

  it('shows anything else as JSON', () => {
    expect(toStr(['EMT', 'Driver'])).toBe('["EMT","Driver"]');
  });

  it('falls back when a value cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(toStr(cyclic, '?')).toBe('?');
  });
});
