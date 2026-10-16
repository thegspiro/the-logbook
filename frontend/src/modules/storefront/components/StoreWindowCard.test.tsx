/**
 * The card shows a short countdown pill and announces the same deadline in
 * words. They rounded in opposite directions, so 14½ days read "14d left" and
 * "Ordering closes in 15 days" on one card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Storefront } from '../types';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { StoreWindowCard } from './StoreWindowCard';

const NOW = new Date('2026-10-16T08:00:00Z');

const storefront = {
  window: {
    id: 'window-1',
    name: 'Fall shirt order',
    opensAt: '2026-10-16T07:00:00Z',
    // 14 days 12 hours from NOW.
    closesAt: '2026-10-30T20:00:00Z',
  },
  otherOpenWindows: [],
  showOpenOrderBanner: true,
} as unknown as Storefront;

describe('StoreWindowCard countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says the same number of days in the pill and in words', () => {
    render(<StoreWindowCard storefront={storefront} onSelectWindow={vi.fn()} />);

    expect(screen.getByText('14d left')).toBeInTheDocument();
    expect(screen.getByText('Ordering closes in 14 days')).toBeInTheDocument();
    expect(screen.queryByText('Ordering closes in 15 days')).not.toBeInTheDocument();
  });
});
