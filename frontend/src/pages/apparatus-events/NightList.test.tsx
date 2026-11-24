const mockListNights = vi.fn();

vi.mock('../../services/api', () => ({
  apparatusEventService: {
    listNights: (...args: unknown[]) => mockListNights(...args) as unknown,
  },
}));

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { NightSummary } from '../../types/apparatusEvent';
import { NightList } from './NightList';

const START = new Date(Date.now() + 5 * 86_400_000).toISOString();

const night = (overrides: Partial<NightSummary> = {}): NightSummary => ({
  event_id: 'night-1',
  title: 'Santamobile 2026',
  start_datetime: START,
  end_datetime: START,
  template_name: 'Santamobile — Full',
  unit_numbers: ['E1'],
  filled: 1,
  total: 4,
  is_cancelled: false,
  attendance_finalized: false,
  checked_in: 0,
  pending_requests: 0,
  ...overrides,
});

describe('NightList', () => {
  beforeEach(() => {
    mockListNights.mockReset();
  });

  it('flags a night with seat requests waiting for the coordinator', async () => {
    mockListNights.mockResolvedValue([night({ pending_requests: 2 }), night({ event_id: 'night-2' })]);
    renderWithRouter(<NightList scope="upcoming" />);

    expect(await screen.findByText('2 requests waiting')).toBeInTheDocument();
    expect(screen.getAllByText('1 of 4 seats filled')).toHaveLength(2);
    expect(screen.queryAllByText(/requests? waiting/)).toHaveLength(1);
  });
});
