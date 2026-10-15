/**
 * Workflow review W67: with 16 days and some hours left, the card showed
 * "16 days" while its screen-reader announcement said "Ordering closes in 17
 * days" — the announcement rounded up, the countdown down.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoreWindowCard } from './StoreWindowCard';
import { StorePaymentPolicy } from '../types';
import type { Storefront } from '../types';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const NOW = new Date('2026-10-15T13:00:00Z');

const storefront = (closesAt: string): Storefront => ({
  isEnabled: true,
  storeName: 'Valley Fire Gear Shop',
  currency: 'USD',
  showOpenOrderBanner: true,
  allowPickup: true,
  allowShipping: false,
  pickupLocation: 'Station 1',
  taxRate: '0',
  acceptedPaymentMethods: ['cash'],
  paymentMethods: [],
  paymentPolicy: StorePaymentPolicy.BEFORE_PICKUP,
  sendsOrderConfirmation: true,
  window: { id: 'w1', name: 'Fall 2026 order', opensAt: '2026-10-15T08:00:00Z', closesAt },
  otherOpenWindows: [],
  products: [],
});

describe('StoreWindowCard countdown (W67)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces the same number of days the countdown shows', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // 16 days and 9 hours away.
    render(<StoreWindowCard storefront={storefront('2026-10-31T22:00:00Z')} onSelectWindow={vi.fn()} />);

    expect(screen.getByText('16 days')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Ordering closes in 16 days');
  });
});
