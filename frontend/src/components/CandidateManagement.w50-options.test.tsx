/**
 * W50-24: a ballot item's Approve/Deny choices are materialised by the backend
 * as Candidate rows (position = the item's id) on the item's first vote, and a
 * voter's write-in is a Candidate row their vote points at. Neither is a
 * nominee an officer should Edit or Remove — the first would rename a choice,
 * the second would delete a cast vote. The option rows never reach the list;
 * write-ins are shown read-only once voting has started.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import type { Candidate, Election } from '../types/election';

const getCandidates = vi.fn();
const getUsers = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getCandidates: (...args: unknown[]) => getCandidates(...args) as unknown,
  },
  userService: {
    getUsers: (...args: unknown[]) => getUsers(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { CandidateManagement } from './CandidateManagement';

const makeCandidate = (overrides: Partial<Candidate>): Candidate => ({
  id: 'c',
  election_id: 'elec-1',
  name: 'Someone',
  accepted: true,
  is_write_in: false,
  display_order: 0,
  nomination_date: '2026-07-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...overrides,
});

const candidates: Candidate[] = [
  makeCandidate({ id: 'nominee', name: 'Jane Doe', position: 'Chief' }),
  makeCandidate({ id: 'approve', name: 'Approve', position: 'item_1790747487501_k8vrul' }),
  makeCandidate({ id: 'deny', name: 'Deny', position: 'item_1790747487501_k8vrul' }),
  makeCandidate({ id: 'wi', name: 'Blaire Carter', position: 'Chief', is_write_in: true }),
];

const makeElection = (overrides: Partial<Election>): Election =>
  ({
    id: 'elec-1',
    status: 'draft',
    positions: ['Chief'],
    ballot_items: [
      {
        id: 'item_1790747487501_k8vrul',
        type: 'general_vote',
        title: 'Adopt the 2027 budget',
        eligible_voter_types: ['all'],
        vote_type: 'approval',
      },
    ],
    total_votes: 0,
    ...overrides,
  }) as unknown as Election;

describe('CandidateManagement option rows and write-ins (W50-24)', () => {
  beforeEach(() => {
    getCandidates.mockReset();
    getUsers.mockReset();
    getCandidates.mockResolvedValue(candidates);
    getUsers.mockResolvedValue([]);
  });

  it('never lists a ballot item option as a candidate, nor counts it', async () => {
    renderWithRouter(<CandidateManagement electionId="elec-1" election={makeElection({ status: 'open' })} />);

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Deny')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Approve' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Unassigned/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Candidates (2)' })).toBeInTheDocument();
  });

  it('shows a write-in read-only once voting has started', async () => {
    renderWithRouter(<CandidateManagement electionId="elec-1" election={makeElection({ status: 'open' })} />);

    expect(await screen.findByText('Blaire Carter')).toBeInTheDocument();
    expect(screen.getByText('Cast by a voter — read-only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Blaire Carter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Blaire Carter' })).not.toBeInTheDocument();
    // A nominee on the slate is still editable while the election is open.
    expect(screen.getByRole('button', { name: 'Edit Jane Doe' })).toBeInTheDocument();
  });

  it('keeps a pre-vote write-in editable on a draft ballot', async () => {
    renderWithRouter(<CandidateManagement electionId="elec-1" election={makeElection({ status: 'draft' })} />);

    expect(await screen.findByText('Blaire Carter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Blaire Carter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Blaire Carter' })).toBeInTheDocument();
    expect(screen.queryByText('Cast by a voter — read-only')).not.toBeInTheDocument();
  });
});
