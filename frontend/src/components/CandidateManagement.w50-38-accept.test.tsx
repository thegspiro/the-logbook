/**
 * W50-38 (owner decision 2026-10-08): a manager may accept a nomination on
 * the nominee's behalf before nominations close — the button says so, and the
 * accepted row carries a persisted "Accepted by manager" label — and Close
 * Nominations freezes the slate, so the toggle is disabled afterwards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { Candidate, Election } from '../types/election';

const getCandidates = vi.fn();
const updateCandidate = vi.fn();
const getUsers = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getCandidates: (...args: unknown[]) => getCandidates(...args) as unknown,
    updateCandidate: (...args: unknown[]) => updateCandidate(...args) as unknown,
  },
  userService: {
    getUsers: (...args: unknown[]) => getUsers(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { CandidateManagement } from './CandidateManagement';

const pending = {
  id: 'cand-1',
  election_id: 'elec-1',
  user_id: 'user-2',
  name: 'Blair Carter',
  position: 'Chief',
  accepted: false,
  is_write_in: false,
  display_order: 0,
} as unknown as Candidate;

const election = (overrides: Record<string, unknown> = {}) =>
  ({ id: 'elec-1', status: 'nominations', positions: ['Chief'], ...overrides }) as unknown as Election;

describe('CandidateManagement — accept on behalf and frozen slate (W50-38)', () => {
  beforeEach(() => {
    getCandidates.mockReset();
    updateCandidate.mockReset();
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
  });

  it('offers to accept on the nominee’s behalf and labels the result', async () => {
    getCandidates.mockResolvedValue([pending]);
    updateCandidate.mockResolvedValue({
      ...pending,
      accepted: true,
      accepted_on_behalf_by: 'manager-1',
      accepted_on_behalf_at: '2026-10-08T12:00:00Z',
    });
    const user = userEvent.setup();
    renderWithRouter(<CandidateManagement electionId="elec-1" election={election()} />);

    await user.click(await screen.findByRole('button', { name: 'Accept on behalf of Blair Carter' }));

    expect(updateCandidate).toHaveBeenCalledWith('elec-1', 'cand-1', { accepted: true });
    expect(await screen.findByText('Accepted by manager')).toBeInTheDocument();
  });

  it('disables the toggle once nominations have closed', async () => {
    getCandidates.mockResolvedValue([pending]);
    renderWithRouter(
      <CandidateManagement
        electionId="elec-1"
        election={election({ status: 'draft', nominations_closed_at: '2026-10-08T12:00:00Z' })}
      />
    );

    expect(await screen.findByRole('button', { name: 'Accept on behalf of Blair Carter' })).toBeDisabled();
    expect(screen.getByText('Not accepted before nominations closed')).toBeInTheDocument();
  });
});
