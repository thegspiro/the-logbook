/**
 * W50-73 — the Add Candidate form's labels sat beside their controls with no
 * htmlFor/id pairing, so a screen reader announced each field as unlabelled
 * and tapping a label focused nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { Election } from '../types/election';

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

const election = {
  id: 'elec-1',
  status: 'draft',
  positions: ['Chief'],
  ballot_items: [],
  total_votes: 0,
} as unknown as Election;

describe('CandidateManagement add form labels (W50-73)', () => {
  beforeEach(() => {
    getCandidates.mockReset();
    getUsers.mockReset();
    getCandidates.mockResolvedValue([]);
    getUsers.mockResolvedValue([]);
  });

  it('associates every label with its control', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CandidateManagement electionId="elec-1" election={election} />);
    await user.click(await screen.findByRole('button', { name: '+ Add Candidate' }));

    expect(screen.getByLabelText('Position')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText('Select Member')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText(/^Name/)).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Statement')).toBeInstanceOf(HTMLTextAreaElement);
  });
});
