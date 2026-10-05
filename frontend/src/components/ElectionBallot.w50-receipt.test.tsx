/**
 * ElectionBallot — an in-app cast shows the receipt hash the API returned,
 * and the verify form is mounted with the ballot (W50-53).
 *
 * Before this the hash reached the browser in the vote response and was
 * dropped on the floor: the voter saw a toast and had nothing to verify.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetCandidates = vi.fn();
const mockCheckEligibility = vi.fn();
const mockCastVote = vi.fn();
const mockBulkCastVotes = vi.fn();
const mockVerifyReceipt = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    getCandidates: (...args: unknown[]) => mockGetCandidates(...args) as unknown,
    checkEligibility: (...args: unknown[]) => mockCheckEligibility(...args) as unknown,
    castVote: (...args: unknown[]) => mockCastVote(...args) as unknown,
    bulkCastVotes: (...args: unknown[]) => mockBulkCastVotes(...args) as unknown,
    verifyReceipt: (...args: unknown[]) => mockVerifyReceipt(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ElectionBallot } from './ElectionBallot';
import type { Election } from '../types/election';

const CANDIDATES = [
  { id: 'c1', name: 'Alice Anderson', position: 'Chief', accepted: true },
  { id: 'c2', name: 'Bob Baker', position: 'Captain', accepted: true },
];

const election = (overrides: Partial<Election> = {}): Election =>
  ({
    id: 'el1',
    title: 'Officer Election',
    election_type: 'officer',
    start_date: '2026-07-01T00:00:00Z',
    end_date: '2026-08-01T00:00:00Z',
    status: 'open',
    voting_method: 'simple_majority',
    positions: ['Chief', 'Captain'],
    ...overrides,
  }) as Election;

const openEligibility = {
  is_eligible: true,
  has_voted: false,
  positions_voted: [],
  positions_remaining: ['Chief', 'Captain'],
};

describe('ElectionBallot receipts (W50-53)', () => {
  beforeEach(() => {
    mockGetCandidates.mockReset();
    mockCheckEligibility.mockReset();
    mockCastVote.mockReset();
    mockBulkCastVotes.mockReset();
    mockVerifyReceipt.mockReset();
    mockGetCandidates.mockResolvedValue(CANDIDATES);
    mockCheckEligibility.mockResolvedValue(openEligibility);
  });

  it('shows the receipt hash beside the position after a simple cast', async () => {
    const user = userEvent.setup();
    mockCastVote.mockResolvedValue({
      id: 'v1',
      election_id: 'el1',
      candidate_id: 'c1',
      voted_at: '2026-07-04T15:30:00Z',
      receipt_hash: 'hash-chief',
    });
    mockCheckEligibility.mockResolvedValueOnce(openEligibility).mockResolvedValueOnce({
      is_eligible: true,
      has_voted: true,
      positions_voted: ['Chief'],
      positions_remaining: ['Captain'],
    });

    render(<ElectionBallot electionId="el1" election={election()} />);
    await user.click(await screen.findByRole('button', { name: 'Select Alice Anderson' }));
    await user.click(screen.getByRole('button', { name: 'Submit Vote for Chief' }));

    const receipt = await screen.findByTestId('receipt-Chief');
    expect(receipt).toHaveTextContent('hash-chief');
    expect(receipt).toHaveTextContent(/Save this receipt/);
    expect(screen.getByText('Vote submitted for Chief')).toBeInTheDocument();
  });

  it('keeps the receipts on screen when the last cast flips the ballot to "already voted"', async () => {
    const user = userEvent.setup();
    mockCastVote.mockResolvedValue({
      id: 'v2',
      election_id: 'el1',
      candidate_id: 'c1',
      voted_at: '2026-07-04T15:30:00Z',
      receipt_hash: 'hash-only',
    });
    mockCheckEligibility
      .mockResolvedValueOnce({ is_eligible: true, has_voted: false, positions_voted: [], positions_remaining: [] })
      .mockResolvedValueOnce({ is_eligible: false, has_voted: true, positions_voted: [], positions_remaining: [] });

    render(<ElectionBallot electionId="el1" election={election({ positions: [] })} />);
    await user.click(await screen.findByRole('button', { name: 'Select Alice Anderson' }));
    await user.click(screen.getByRole('button', { name: 'Submit Vote' }));

    expect(await screen.findByText('You have already voted in this election.')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-_default')).toHaveTextContent('hash-only');
    expect(screen.getByRole('heading', { name: 'Verify a vote receipt' })).toBeInTheDocument();
  });

  it('shows every hash a bulk (approval) cast returns', async () => {
    const user = userEvent.setup();
    mockBulkCastVotes.mockResolvedValue([
      { id: 'v3', election_id: 'el1', candidate_id: 'c1', voted_at: '2026-07-04T15:30:00Z', receipt_hash: 'hash-a' },
      { id: 'v4', election_id: 'el1', candidate_id: 'c2', voted_at: '2026-07-04T15:30:00Z', receipt_hash: 'hash-b' },
    ]);
    mockGetCandidates.mockResolvedValue(CANDIDATES.map((c) => ({ ...c, position: undefined })));
    mockCheckEligibility
      .mockResolvedValueOnce({ is_eligible: true, has_voted: false, positions_voted: [], positions_remaining: [] })
      .mockResolvedValueOnce({ is_eligible: true, has_voted: true, positions_voted: [], positions_remaining: ['x'] });

    render(<ElectionBallot electionId="el1" election={election({ voting_method: 'approval', positions: [] })} />);
    await user.click(await screen.findByRole('button', { name: 'Approve Alice Anderson' }));
    await user.click(screen.getByRole('button', { name: 'Approve Bob Baker' }));
    await user.click(screen.getByRole('button', { name: 'Submit Vote' }));

    const receipt = await screen.findByTestId('receipt-_default');
    expect(receipt).toHaveTextContent('hash-a');
    expect(receipt).toHaveTextContent('hash-b');
  });

  it('mounts the verify form under the ballot and routes it to the election', async () => {
    const user = userEvent.setup();
    mockVerifyReceipt.mockResolvedValue({
      verified: true,
      counted: true,
      message: 'Your vote has been recorded and is counted',
    });

    render(<ElectionBallot electionId="el1" election={election()} />);
    await screen.findByRole('button', { name: 'Select Alice Anderson' });
    await user.type(screen.getByLabelText('Receipt'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(mockVerifyReceipt).toHaveBeenCalledWith('el1', 'abc');
    expect(await screen.findByRole('status')).toHaveTextContent('Vote counted');
  });
});
