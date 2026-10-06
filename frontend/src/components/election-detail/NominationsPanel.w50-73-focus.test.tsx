/**
 * W50-73 — submitting a nomination clears the position, which disables the
 * Nominate button under the keyboard user's focus. Focus fell to <body>, so
 * the next Tab landed on the layout's skip link and a "Skip to main content"
 * box popped in over the page. Focus now returns to the form.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetCandidates = vi.fn();
const mockGetUsers = vi.fn();
const mockCreateNomination = vi.fn();
vi.mock('../../services/api', () => ({
  electionService: {
    getCandidates: (...a: unknown[]) => mockGetCandidates(...a) as unknown,
    createNomination: (...a: unknown[]) => mockCreateNomination(...a) as unknown,
  },
  userService: {
    getUsers: (...a: unknown[]) => mockGetUsers(...a) as unknown,
  },
}));

vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import NominationsPanel from './NominationsPanel';
import type { Election } from '../../types/election';

const election = {
  id: 'el1',
  title: 'Annual Officer Election',
  status: 'nominations',
  positions: ['Chief', 'Captain'],
} as unknown as Election;

describe('NominationsPanel keeps focus on the form after Nominate (W50-73)', () => {
  beforeEach(() => {
    mockGetCandidates.mockReset();
    mockGetUsers.mockReset();
    mockCreateNomination.mockReset();
    mockGetCandidates.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([]);
    mockCreateNomination.mockResolvedValue({ id: 'c1', name: 'Me', accepted: true });
  });

  it('moves focus to the position select rather than dropping it to <body>', async () => {
    const user = userEvent.setup();
    render(<NominationsPanel electionId="el1" election={election} currentUserId="user-me" nominationsOpen />);

    const position = await screen.findByLabelText(/Position/);
    await user.selectOptions(position, 'Chief');
    const nominate = screen.getByRole('button', { name: 'Nominate' });
    await user.click(nominate);

    await waitFor(() => expect(mockCreateNomination).toHaveBeenCalled());
    await waitFor(() => expect(nominate).toBeDisabled());
    expect(position).toHaveFocus();

    // The refetch that follows must not swap the form for the loading line:
    // on screen focus sat on <body> because the select had been unmounted.
    await waitFor(() => expect(mockGetCandidates).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Loading nominations…')).not.toBeInTheDocument();
    expect(position).toBeInTheDocument();
    expect(position).toHaveFocus();
  });
});
