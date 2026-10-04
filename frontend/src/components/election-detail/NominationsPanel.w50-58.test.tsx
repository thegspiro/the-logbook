/**
 * W50-58 — the nomination form told a member nothing about when nominations
 * end (the deadline sentence rendered only when a deadline existed, and no UI
 * sets one), Decline deleted the row for everyone on a single unconfirmed
 * click, and a self-nomination — accepted implicitly by the server — toasted
 * "Nomination submitted" as if someone still had to review it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetCandidates = vi.fn();
const mockGetUsers = vi.fn();
const mockCreateNomination = vi.fn();
const mockDeclineNomination = vi.fn();
const mockAcceptNomination = vi.fn();
vi.mock('../../services/api', () => ({
  electionService: {
    getCandidates: (...a: unknown[]) => mockGetCandidates(...a) as unknown,
    createNomination: (...a: unknown[]) => mockCreateNomination(...a) as unknown,
    declineNomination: (...a: unknown[]) => mockDeclineNomination(...a) as unknown,
    acceptNomination: (...a: unknown[]) => mockAcceptNomination(...a) as unknown,
  },
  userService: {
    getUsers: (...a: unknown[]) => mockGetUsers(...a) as unknown,
  },
}));

const mockConfirm = vi.fn();
vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: vi.fn(),
  },
}));

import NominationsPanel from './NominationsPanel';
import type { Candidate, Election } from '../../types/election';

const ME = 'user-me';

const election = {
  id: 'el1',
  title: 'Annual Officer Election',
  status: 'nominations',
  positions: ['Chief', 'Captain'],
} as unknown as Election;

const pendingForMe: Candidate = {
  id: 'cand-1',
  election_id: 'el1',
  user_id: ME,
  name: 'Me Myself',
  position: 'Captain',
  accepted: false,
} as unknown as Candidate;

const renderPanel = (overrides: Partial<Election> = {}) =>
  render(
    <NominationsPanel electionId="el1" election={{ ...election, ...overrides }} currentUserId={ME} nominationsOpen />
  );

describe('NominationsPanel (W50-58)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCandidates.mockReset();
    mockGetUsers.mockReset();
    mockCreateNomination.mockReset();
    mockDeclineNomination.mockReset();
    mockConfirm.mockReset();
    mockGetCandidates.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([
      { id: ME, status: 'active', full_name: 'Me Myself' },
      { id: 'user-pat', status: 'active', full_name: 'Pat Probie' },
    ]);
    mockDeclineNomination.mockResolvedValue({ success: true, message: 'ok' });
  });

  it('says nominations stay open until an officer closes them when no deadline is set', async () => {
    renderPanel();
    expect(await screen.findByTestId('nominations-close')).toHaveTextContent(
      'Nominations stay open until an officer closes them.'
    );
  });

  it('prints the deadline in the department timezone when one is set', async () => {
    renderPanel({ nomination_deadline: '2026-10-05T18:30:00Z' });
    const sentence = await screen.findByTestId('nominations-close');
    expect(sentence).toHaveTextContent('Nominations close Monday, October 5, 2026');
    expect(sentence).toHaveTextContent('6:30 PM');
    expect(sentence).not.toHaveTextContent('configured deadline');
  });

  it('asks before declining and leaves the nomination alone on Keep it', async () => {
    const user = userEvent.setup();
    mockGetCandidates.mockResolvedValue([pendingForMe]);
    mockConfirm.mockResolvedValue(false);
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Decline' }));

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmLabel: 'Decline nomination',
        cancelLabel: 'Keep it',
        message: expect.stringContaining('Captain') as unknown,
      })
    );
    expect(mockDeclineNomination).not.toHaveBeenCalled();
  });

  it('declines only after the member confirms', async () => {
    const user = userEvent.setup();
    mockGetCandidates.mockResolvedValue([pendingForMe]);
    mockConfirm.mockResolvedValue(true);
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Decline' }));

    await waitFor(() => {
      expect(mockDeclineNomination).toHaveBeenCalledWith('el1', 'cand-1');
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Nomination declined');
  });

  it('tells a self-nominator they are now a candidate, because the server accepted it already', async () => {
    const user = userEvent.setup();
    mockCreateNomination.mockResolvedValue({ ...pendingForMe, position: 'Chief', accepted: true });
    renderPanel();

    await user.selectOptions(await screen.findByLabelText(/Position/), 'Chief');
    await user.click(screen.getByRole('button', { name: 'Nominate' }));

    await waitFor(() => {
      expect(mockCreateNomination).toHaveBeenCalledWith('el1', {
        position: 'Chief',
        nominee_user_id: undefined,
        statement: undefined,
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('You are now a candidate for Chief');
  });

  it('tells a nominator the nominee still has to accept', async () => {
    const user = userEvent.setup();
    mockCreateNomination.mockResolvedValue({
      ...pendingForMe,
      id: 'cand-2',
      user_id: 'user-pat',
      name: 'Pat Probie',
      position: 'Chief',
      accepted: false,
    });
    renderPanel();

    await user.selectOptions(await screen.findByLabelText(/Position/), 'Chief');
    await user.selectOptions(screen.getByLabelText('Nominee'), 'user-pat');
    await user.click(screen.getByRole('button', { name: 'Nominate' }));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Pat Probie has been nominated for Chief and will be asked to accept'
      );
    });
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Nomination submitted');
  });
});
