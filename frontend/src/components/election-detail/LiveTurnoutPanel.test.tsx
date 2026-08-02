import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetStats = vi.fn();
vi.mock('../../services/electionService', () => ({
  electionService: {
    getStats: (...args: unknown[]) => mockGetStats(...args) as unknown,
  },
}));

import LiveTurnoutPanel from './LiveTurnoutPanel';
import type { Election } from '../../types/election';

const election = {
  id: 'e1',
  title: 'Officer Election',
  status: 'open',
  quorum_type: 'percentage',
  quorum_value: 50,
} as unknown as Election;

const stats = {
  election_id: 'e1',
  total_candidates: 2,
  total_votes_cast: 12,
  total_eligible_voters: 20,
  total_voters: 12,
  voter_turnout_percentage: 60,
  votes_by_position: {},
};

describe('LiveTurnoutPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockResolvedValue(stats);
  });

  it('shows ballots received, eligible voters, and turnout', async () => {
    render(<LiveTurnoutPanel electionId="e1" election={election} />);
    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(mockGetStats).toHaveBeenCalledWith('e1');
  });

  it('marks quorum as met when turnout reaches the percentage target', async () => {
    render(<LiveTurnoutPanel electionId="e1" election={election} />);
    await waitFor(() => {
      expect(screen.getByText('MET')).toBeInTheDocument();
    });
    expect(screen.getByText(/Quorum met/)).toBeInTheDocument();
  });

  it('shows quorum progress when not yet met', async () => {
    mockGetStats.mockResolvedValue({
      ...stats,
      total_voters: 4,
      voter_turnout_percentage: 20,
    });
    render(<LiveTurnoutPanel electionId="e1" election={election} />);
    await waitFor(() => {
      expect(screen.getByText(/Quorum progress/)).toBeInTheDocument();
    });
    expect(screen.queryByText('MET')).not.toBeInTheDocument();
  });

  it('omits the quorum bar when the election has no quorum', async () => {
    render(
      <LiveTurnoutPanel
        electionId="e1"
        election={{ ...election, quorum_type: 'none' }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Quorum/)).not.toBeInTheDocument();
  });
});
