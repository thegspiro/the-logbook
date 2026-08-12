import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockGetElections = vi.fn();
const mockGetElection = vi.fn();

vi.mock('../../../services/api', () => ({
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getElection: (...args: unknown[]) => mockGetElection(...args) as unknown,
  },
}));

import { RunoffChain } from './RunoffChain';

type Round = {
  id: string;
  title: string;
  status: string;
  runoff_round: number;
  total_votes: number;
  parent_election_id?: string;
  is_runoff?: boolean;
  enable_runoffs?: boolean;
};

const ORIGINAL: Round = {
  id: 'e0',
  title: 'Fire Chief Election',
  status: 'closed',
  runoff_round: 0,
  total_votes: 19,
  enable_runoffs: true,
};
const ROUND_1: Round = {
  id: 'e1',
  title: 'Fire Chief Election - Runoff Round 1',
  status: 'closed',
  runoff_round: 1,
  total_votes: 18,
  parent_election_id: 'e0',
  is_runoff: true,
  enable_runoffs: true,
};
const ROUND_2: Round = {
  id: 'e2',
  title: 'Fire Chief Election - Runoff Round 2',
  status: 'closed',
  runoff_round: 2,
  total_votes: 18,
  parent_election_id: 'e1',
  is_runoff: true,
  enable_runoffs: true,
};

function seed(rounds: Round[]) {
  mockGetElections.mockResolvedValue(rounds);
  mockGetElection.mockImplementation((id: string) => {
    const found = rounds.find((r) => r.id === id);
    return found ? Promise.resolve(found) : Promise.reject(new Error('not found'));
  });
}

describe('RunoffChain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows every round of a three-round chain, not just the root and its child', async () => {
    seed([ORIGINAL, ROUND_1, ROUND_2]);

    renderWithRouter(<RunoffChain election={ORIGINAL as never} />);

    await waitFor(() => {
      expect(screen.getByText('Runoff 2')).toBeInTheDocument();
    });
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByText('Runoff 1')).toBeInTheDocument();
  });

  it('finds the root from the last round, however deep it is', async () => {
    seed([ORIGINAL, ROUND_1, ROUND_2]);

    renderWithRouter(<RunoffChain election={ROUND_2 as never} />);

    await waitFor(() => {
      expect(screen.getByText('Original')).toBeInTheDocument();
    });
    expect(screen.getByText('Runoff 1')).toBeInTheDocument();
    // The round being viewed is marked as the current page.
    expect(screen.getByRole('link', { name: /Runoff 2/ })).toHaveAttribute('aria-current', 'page');
  });

  it('orders the chain by round and shows each round its vote count', async () => {
    seed([ROUND_2, ORIGINAL, ROUND_1]);

    renderWithRouter(<RunoffChain election={ORIGINAL as never} />);

    await waitFor(() => {
      expect(screen.getByText('Runoff 2')).toBeInTheDocument();
    });
    const labels = screen.getAllByText(/^(Original|Runoff \d)$/).map((n) => n.textContent);
    expect(labels).toEqual(['Original', 'Runoff 1', 'Runoff 2']);
    expect(screen.getAllByText(/closed · 18 votes/)).toHaveLength(2);
    expect(screen.getByText(/closed · 19 votes/)).toBeInTheDocument();
  });

  it('renders nothing for an election with no runoffs', async () => {
    const plain = { ...ORIGINAL, enable_runoffs: false, is_runoff: false };
    seed([plain]);

    const { container } = renderWithRouter(<RunoffChain election={plain as never} />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('does not hang on a cycle in the parent links', async () => {
    const a = { ...ORIGINAL, id: 'a', parent_election_id: 'b', is_runoff: true };
    const b = { ...ROUND_1, id: 'b', parent_election_id: 'a' };
    seed([a, b]);

    renderWithRouter(<RunoffChain election={a as never} />);

    await waitFor(() => {
      expect(screen.getByText('Multi-Stage Election Chain')).toBeInTheDocument();
    });
  });
});
