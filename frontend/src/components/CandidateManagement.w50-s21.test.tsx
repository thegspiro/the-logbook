/**
 * Clearing a candidate's statement (or position) on edit must persist.
 *
 * `PATCH /elections/{id}/candidates/{id}` applies
 * `model_dump(exclude_unset=True)`: an omitted key means "leave it alone", an
 * explicit null clears the column (CLAUDE.md pitfall 1, update rule).
 * `handleEdit` used to spread `statement` / `position` only when truthy, so a
 * statement the officer emptied never left the browser and the old text
 * survived behind a green "Candidate updated" toast. It now sends
 * `blankToNull` for both fields on every save.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

const candidate = {
  id: 'cand-1',
  election_id: 'elec-1',
  name: 'Jane Doe',
  position: 'Chief',
  statement: 'Vote for me',
  accepted: true,
  is_write_in: false,
  display_order: 0,
} as unknown as Candidate;

const election = {
  id: 'elec-1',
  status: 'draft',
  positions: ['Chief', 'President'],
} as unknown as Election;

describe('CandidateManagement edit clears a field (S21)', () => {
  beforeEach(() => {
    getCandidates.mockReset();
    updateCandidate.mockReset();
    getUsers.mockReset();
    getCandidates.mockResolvedValue([candidate]);
    getUsers.mockResolvedValue([]);
    updateCandidate.mockImplementation((_e: string, _c: string, data: Record<string, unknown>) =>
      Promise.resolve({ ...candidate, ...data })
    );
  });

  it('sends an explicit null for a statement and position the officer emptied', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CandidateManagement electionId="elec-1" election={election} />);

    await user.click(await screen.findByRole('button', { name: 'Edit Jane Doe' }));

    await user.clear(screen.getByPlaceholderText('Statement...'));
    await user.selectOptions(screen.getByRole('combobox'), '');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCandidate).toHaveBeenCalled());
    const payload = updateCandidate.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).toHaveProperty('statement', null);
    expect(payload).toHaveProperty('position', null);
  });
});
