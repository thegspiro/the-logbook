import { describe, it, expect } from 'vitest';

import { formatCurrency, formatCurrencyWhole } from './currencyFormatting';

describe('formatCurrency', () => {
  it('formats a positive amount with cents', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('formats zero as a real amount, not the null sentinel', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats negative amounts', () => {
    expect(formatCurrency(-42.5)).toBe('-$42.50');
  });

  it('returns "-" for null', () => {
    expect(formatCurrency(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatCurrency(undefined)).toBe('-');
  });
});

describe('formatCurrencyWhole', () => {
  it('rounds to whole dollars', () => {
    expect(formatCurrencyWhole(1234.56)).toBe('$1,235');
  });

  it('formats zero as a real amount, not the null sentinel', () => {
    expect(formatCurrencyWhole(0)).toBe('$0');
  });

  it('returns "--" for null', () => {
    expect(formatCurrencyWhole(null)).toBe('--');
  });

  it('returns "--" for undefined', () => {
    expect(formatCurrencyWhole(undefined)).toBe('--');
  });
});
