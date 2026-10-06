/**
 * ElectionBallot — the in-app Cast Vote tab.
 *
 * Since the 2026-10-05 ballot convergence it is the emailed ballot's model:
 * every ballot item and plain position from `GET /elections/{id}/ballot`,
 * submitted in the emailed ballot's shape. It used to render
 * `election.positions` only, so a motion was invisible here (W50-10,
 * ELEC-28). An in-app cast still shows the receipt hash the API returned and
 * mounts the verify form (W50-53), and a member holding a proxy can cast the
 * delegating member's ballot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetMemberBallot = vi.fn();
const mockSubmitMemberBallot = vi.fn();
const mockGetMyProxies = vi.fn();
const mockVerifyReceipt = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    getMemberBallot: (...args: unknown[]) => mockGetMemberBallot(...args) as unknown,
    submitMemberBallot: (...args: unknown[]) => mockSubmitMemberBallot(...args) as unknown,
    getMyProxies: (...args: unknown[]) => mockGetMyProxies(...args) as unknown,
    verifyReceipt: (...args: unknown[]) => mockVerifyReceipt(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ElectionBallot } from './ElectionBallot';
import type { Election } from '../types/election';

const CHIEF_ID = 'position-abc123';

const ballot = (overrides: Record<string, unknown> = {}) => ({
  election: {
    id: 'el1',
    title: 'Officer Election',
    election_type: 'officer',
    start_date: '2026-07-01T00:00:00Z',
    end_date: '2026-08-01T00:00:00Z',
    status: 'open',
    voting_method: 'simple_majority',
    max_votes_per_position: 1,
    allow_write_ins: false,
    positions: ['Chief'],
    ballot_items: [
      {
        id: 'budget',
        type: 'general_vote',
        title: 'Approve the 2027 budget',
        vote_type: 'approval',
        eligible_voter_types: ['all'],
      },
      {
        id: CHIEF_ID,
        type: 'officer_election',
        title: 'Chief',
        position: 'Chief',
        vote_type: 'candidate_selection',
        eligible_voter_types: ['all'],
      },
    ],
  },
  candidates: [
    { id: 'c1', name: 'Alice Anderson', position: 'Chief', accepted: true, is_write_in: false },
    { id: 'c2', name: 'Bob Baker', position: 'Chief', accepted: true, is_write_in: false },
  ],
  items: [
    { ballot_item_id: 'budget', eligible: true, voted: false },
    { ballot_item_id: CHIEF_ID, eligible: true, voted: false },
  ],
  proxy: null,
  ...overrides,
});

const election = { id: 'el1', title: 'Officer Election' } as unknown as Election;

const confirmCast = async (user: ReturnType<typeof userEvent.setup>) => {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Cast ballot' }));
};

describe('ElectionBallot (ballot convergence, W50-10, W50-53)', () => {
  beforeEach(() => {
    mockGetMemberBallot.mockReset();
    mockSubmitMemberBallot.mockReset();
    mockGetMyProxies.mockReset();
    mockVerifyReceipt.mockReset();
    mockGetMemberBallot.mockResolvedValue(ballot());
    mockGetMyProxies.mockResolvedValue({ proxies: [], unavailable_reason: null });
  });

  it('shows the ballot items and the plain position on one ballot', async () => {
    renderWithRouter(<ElectionBallot electionId="el1" election={election} />);

    expect(await screen.findByText('Approve the 2027 budget')).toBeInTheDocument();
    expect(screen.getByText('Chief')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Alice Anderson/ })).toBeInTheDocument();
  });

  it('casts the whole ballot in one submission and shows every receipt', async () => {
    mockSubmitMemberBallot.mockResolvedValue({
      success: true,
      votes_cast: 2,
      abstentions: 0,
      message: 'Ballot recorded. 2 vote(s) cast, 0 item(s) left open.',
      receipt_hashes: ['hash-budget', 'hash-chief'],
    });
    const user = userEvent.setup();
    renderWithRouter(<ElectionBallot electionId="el1" election={election} />);

    await user.click(await screen.findByRole('radio', { name: 'Approve' }));
    await user.click(screen.getByRole('radio', { name: /Bob Baker/ }));
    // The refresh after the cast reads the items as voted.
    mockGetMemberBallot.mockResolvedValue(
      ballot({
        items: [
          { ballot_item_id: 'budget', eligible: true, voted: true },
          { ballot_item_id: CHIEF_ID, eligible: true, voted: true },
        ],
      })
    );
    await user.click(screen.getByRole('button', { name: 'Cast Ballot' }));
    await confirmCast(user);

    expect(mockSubmitMemberBallot).toHaveBeenCalledWith(
      'el1',
      [
        { ballot_item_id: 'budget', choice: 'approve', write_in_name: undefined },
        { ballot_item_id: CHIEF_ID, choice: 'c2', write_in_name: undefined },
      ],
      undefined
    );
    expect(await screen.findByText('You have already voted in this election.')).toBeInTheDocument();
    const receipts = screen.getByTestId('ballot-receipts');
    expect(within(receipts).getByText('hash-budget')).toBeInTheDocument();
    expect(within(receipts).getByText('hash-chief')).toBeInTheDocument();
  });

  it('shows an item already voted as done and leaves the rest open', async () => {
    mockGetMemberBallot.mockResolvedValue(
      ballot({
        items: [
          { ballot_item_id: 'budget', eligible: true, voted: true },
          { ballot_item_id: CHIEF_ID, eligible: true, voted: false },
        ],
      })
    );
    renderWithRouter(<ElectionBallot electionId="el1" election={election} />);

    expect(await screen.findByText('You have already voted on this item.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Alice Anderson/ })).toBeInTheDocument();
  });

  it('says why a member cannot vote when no item is open to them', async () => {
    mockGetMemberBallot.mockResolvedValue(
      ballot({
        items: [
          { ballot_item_id: 'budget', eligible: false, reason: 'Election is closed', voted: false },
          { ballot_item_id: CHIEF_ID, eligible: false, reason: 'Election is closed', voted: false },
        ],
      })
    );
    renderWithRouter(<ElectionBallot electionId="el1" election={election} />);

    expect(await screen.findByText('Election is closed')).toBeInTheDocument();
  });

  it('mounts the verify form and routes it to the election', async () => {
    renderWithRouter(<ElectionBallot electionId="el1" election={election} />);

    expect(await screen.findByRole('region', { name: /verify/i })).toBeInTheDocument();
  });

  it('lets a proxy holder switch to the delegating member and cast their ballot', async () => {
    mockGetMyProxies.mockResolvedValue({
      proxies: [{ authorization_id: 'auth-1', delegating_user_id: 'u-2', delegating_user_name: 'Bob Baker' }],
      unavailable_reason: null,
    });
    mockSubmitMemberBallot.mockResolvedValue({
      success: true,
      votes_cast: 1,
      abstentions: 1,
      message: 'Ballot recorded. 1 vote(s) cast, 1 item(s) left open.',
      receipt_hashes: ['hash-proxy'],
    });
    const user = userEvent.setup();
    renderWithRouter(<ElectionBallot electionId="el1" election={election} />);

    const chooser = await screen.findByLabelText('Voting for');
    mockGetMemberBallot.mockResolvedValue(
      ballot({
        proxy: { authorization_id: 'auth-1', delegating_user_id: 'u-2', delegating_user_name: 'Bob Baker' },
      })
    );
    await user.selectOptions(chooser, 'auth-1');

    expect(mockGetMemberBallot).toHaveBeenLastCalledWith('el1', 'auth-1');
    expect(await screen.findByText('Voting as proxy for: Bob Baker')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Deny' }));
    await user.click(screen.getByRole('button', { name: "Cast Bob Baker's Ballot" }));
    await confirmCast(user);

    expect(mockSubmitMemberBallot).toHaveBeenCalledWith(
      'el1',
      [
        { ballot_item_id: 'budget', choice: 'deny', write_in_name: undefined },
        { ballot_item_id: CHIEF_ID, choice: 'abstain', write_in_name: undefined },
      ],
      'auth-1'
    );
  });

  it('names why held proxies cannot be voted here', async () => {
    mockGetMyProxies.mockResolvedValue({
      proxies: [],
      unavailable_reason: 'Proxy voting is available on named (non-anonymous) elections only.',
    });
    renderWithRouter(<ElectionBallot electionId="el1" election={election} />);

    expect(
      await screen.findByText('Proxy voting is available on named (non-anonymous) elections only.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Voting for')).not.toBeInTheDocument();
  });
});
