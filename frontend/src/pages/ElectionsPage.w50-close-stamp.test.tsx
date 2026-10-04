/**
 * The list card dates a closed election by its actual close, not the
 * scheduled end (W50-14). The list response carries `closed_at` only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getElectionSettings: vi.fn().mockRejectedValue(new Error('not needed')),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
  ranksService: { getRanks: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['elections.manage'] },
    checkPermission: () => true,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

const closedEarly = {
  id: 'e1',
  title: 'Officer Election',
  election_type: 'officer',
  start_date: '2026-09-29T00:00:00Z',
  end_date: '2026-10-02T05:45:00Z',
  closed_at: '2026-09-30T07:07:00Z',
  status: 'closed',
  positions: ['Chief'],
  runoff_round: 0,
};

describe('ElectionsPage close stamp (W50-14)', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
  });

  it('shows the actual close on a closed card', async () => {
    mockGetElections.mockResolvedValue([closedEarly]);
    renderWithRouter(<ElectionsPage />);
    // The status filter strip also has a "Closed" button; the stamp is the
    // one carrying a date.
    const stamp = await screen.findByText(/^Closed .*2026/);
    expect(stamp).toHaveTextContent('September 30, 2026');
    expect(stamp).not.toHaveTextContent('October 2, 2026');
  });

  it('shows no close stamp on an open card', async () => {
    mockGetElections.mockResolvedValue([{ ...closedEarly, closed_at: null, status: 'open' }]);
    renderWithRouter(<ElectionsPage />);
    expect(await screen.findByText('Officer Election')).toBeInTheDocument();
    expect(screen.queryByText(/^Closed .*2026/)).not.toBeInTheDocument();
  });
});
