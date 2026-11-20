import { describe, it, expect } from 'vitest';
import { orderStatusLabel } from './orderStatus';

describe('orderStatusLabel', () => {
  it('uses shipping wording for a shipped order (W67b-18)', () => {
    expect(orderStatusLabel('ready_for_pickup', 'ship')).toBe('Ready to ship');
    expect(orderStatusLabel('fulfilled', 'ship')).toBe('Shipped');
  });

  it('keeps the pickup wording for an order collected at the station', () => {
    expect(orderStatusLabel('ready_for_pickup', 'pickup')).toBe('Ready for pickup');
    expect(orderStatusLabel('fulfilled', 'pickup')).toBe('Fulfilled');
  });

  it('labels the statuses shipping does not change the same way for both', () => {
    expect(orderStatusLabel('ordered', 'ship')).toBe('Ordered from vendor');
    expect(orderStatusLabel('awaiting_payment', 'ship')).toBe('Awaiting payment');
  });

  it('falls back to the raw value for a status it does not know', () => {
    expect(orderStatusLabel('on_hold', 'ship')).toBe('on_hold');
  });
});
