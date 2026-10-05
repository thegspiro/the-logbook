/**
 * W50-73 — the Add Custom Ballot Item form's labels had no htmlFor/id
 * pairing, so its fields were announced unlabelled and a label tap focused
 * nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { Election } from '../types/election';

const getBallotTemplates = vi.fn();
const getSavedBallotTemplates = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getBallotTemplates: (...args: unknown[]) => getBallotTemplates(...args) as unknown,
    getSavedBallotTemplates: (...args: unknown[]) => getSavedBallotTemplates(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { BallotBuilder } from './BallotBuilder';

const election = {
  id: 'elec-1',
  status: 'draft',
  positions: ['Chief'],
  ballot_items: [],
  total_votes: 0,
} as unknown as Election;

describe('BallotBuilder custom item form labels (W50-73)', () => {
  beforeEach(() => {
    getBallotTemplates.mockReset();
    getSavedBallotTemplates.mockReset();
    getBallotTemplates.mockResolvedValue([]);
    getSavedBallotTemplates.mockResolvedValue([]);
  });

  it('associates every label with its control', async () => {
    const user = userEvent.setup();
    renderWithRouter(<BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} />);
    // Both the empty state and the toolbar offer the same button; either opens the form.
    const [open] = await screen.findAllByRole('button', { name: /Custom Item/ });
    expect(open).toBeDefined();
    await user.click(open as HTMLElement);

    expect(screen.getByLabelText('Title *')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Description')).toBeInstanceOf(HTMLTextAreaElement);
    expect(screen.getByLabelText('Item Type')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText('Vote Type')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText('Who Can Vote')).toBeInstanceOf(HTMLSelectElement);

    await user.selectOptions(screen.getByLabelText('Vote Type'), 'candidate_selection');
    expect(screen.getByLabelText('Position')).toBeInstanceOf(HTMLSelectElement);
  });
});
