import { describe, it, expect } from 'vitest';
import { chainRangeError } from './approvalChainRange';

describe('chainRangeError', () => {
  it('accepts an ordinary range, an open end, and no range at all', () => {
    expect(chainRangeError('0', '500')).toBeNull();
    expect(chainRangeError('500', '')).toBeNull();
    expect(chainRangeError('', '500')).toBeNull();
    expect(chainRangeError('', '')).toBeNull();
  });

  it('accepts a range whose ends are equal', () => {
    expect(chainRangeError('500', '500')).toBeNull();
  });

  it('refuses a minimum above the maximum', () => {
    expect(chainRangeError('600', '500')).toBe('The minimum amount cannot be above the maximum amount.');
    expect(chainRangeError('500.01', '500')).toBe('The minimum amount cannot be above the maximum amount.');
  });

  it('refuses a negative end', () => {
    expect(chainRangeError('-1', '')).toBe('Amounts must be zero or more.');
    expect(chainRangeError('', '-5')).toBe('Amounts must be zero or more.');
  });

  it('refuses an end larger than the database can hold, and accepts the largest', () => {
    expect(chainRangeError('', '10000000000')).toBe('That amount is too large.');
    expect(chainRangeError('', '9999999999.99')).toBeNull();
  });
});
