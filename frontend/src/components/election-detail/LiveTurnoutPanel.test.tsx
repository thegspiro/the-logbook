import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetStats = vi.fn();
vi.mock('../../services/electionService', () => ({
  electionService: {
    getStats: (...args: unknown[]) => mockGetStats(...args) as unknown,
  },
}));

import LiveTurnoutPanel from './LiveTurnoutPanel';
import { BACKGROUND_REQUEST_CONFIG } from '../../utils/backgroundRequest';
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
    // A panel that refreshes itself on a timer is not evidence anyone is there.
    expect(mockGetStats).toHaveBeenCalledWith('e1', BACKGROUND_REQUEST_CONFIG);
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
    render(<LiveTurnoutPanel electionId="e1" election={{ ...election, quorum_type: 'none' }} />);
    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Quorum/)).not.toBeInTheDocument();
  });
  // ELEC2-17: the panel compared the backend's two-decimal turnout against a
  // target it worked out itself, so it could disagree with the results call,
  // which compares the raw voter count (or the raw ratio) with the bar.
  describe('decides quorum the way the results do', () => {
    it('counts 7 of 30 voters as meeting a 7-voter quorum', async () => {
      mockGetStats.mockResolvedValue({
        ...stats,
        total_eligible_voters: 30,
        total_voters: 7,
        voter_turnout_percentage: 23.33,
      });
      render(<LiveTurnoutPanel electionId="e1" election={{ ...election, quorum_type: 'count', quorum_value: 7 }} />);
      expect(await screen.findByText('MET')).toBeInTheDocument();
    });

    it('does not count 2 of 3 as meeting a 66.67% quorum', async () => {
      mockGetStats.mockResolvedValue({
        ...stats,
        total_eligible_voters: 3,
        total_voters: 2,
        voter_turnout_percentage: 66.67,
      });
      render(<LiveTurnoutPanel electionId="e1" election={{ ...election, quorum_value: 66.67 }} />);
      expect(await screen.findByText(/Quorum progress/)).toBeInTheDocument();
      expect(screen.queryByText('MET')).not.toBeInTheDocument();
    });
  });
});
