/**
 * The candidate statement is bounded client-side (W50-67).
 *
 * `CandidateBase.statement` / `CandidateUpdate.statement` carry
 * `max_length=5000` since W50-67, so an over-length statement is a 422 on
 * POST/PUT. Both textareas now stop input at that length and show how many
 * characters remain, so the limit is met in the form rather than reported
 * back as an API error after a save.
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

describe('CandidateManagement statement length (W50-67)', () => {
  beforeEach(() => {
    getCandidates.mockReset();
    updateCandidate.mockReset();
    getUsers.mockReset();
    getCandidates.mockResolvedValue([candidate]);
    getUsers.mockResolvedValue([]);
  });

  it('caps the create-form statement at 5000 and counts down as the officer types', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CandidateManagement electionId="elec-1" election={election} />);

    await user.click(await screen.findByRole('button', { name: /add candidate/i }));

    const textarea = screen.getByPlaceholderText("Candidate's statement or platform...");
    expect(textarea).toHaveAttribute('maxlength', '5000');
    expect(screen.getByText('5000 characters remaining')).toBeInTheDocument();

    await user.type(textarea, 'Ready');
    expect(screen.getByText('4995 characters remaining')).toBeInTheDocument();
  });

  it('caps the inline edit statement at 5000 and counts the existing text', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CandidateManagement electionId="elec-1" election={election} />);

    await user.click(await screen.findByRole('button', { name: 'Edit Jane Doe' }));

    const textarea = screen.getByPlaceholderText('Statement...');
    expect(textarea).toHaveAttribute('maxlength', '5000');
    // "Vote for me" is 11 characters
    expect(screen.getByText('4989 characters remaining')).toBeInTheDocument();
  });

  // The inline edit controls had no accessible name (REDRIVE-A-4).
  it('names every inline edit control', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CandidateManagement electionId="elec-1" election={election} />);

    await user.click(await screen.findByRole('button', { name: 'Edit Jane Doe' }));

    expect(screen.getByRole('textbox', { name: 'Candidate name' })).toHaveValue('Jane Doe');
    expect(screen.getByRole('combobox', { name: 'Position' })).toHaveValue('Chief');
    expect(screen.getByRole('textbox', { name: 'Statement' })).toHaveValue('Vote for me');
  });
});
