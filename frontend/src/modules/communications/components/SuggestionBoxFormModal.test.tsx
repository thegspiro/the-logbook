import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ReviewerOptions, SuggestionBoxAdmin } from '../types/suggestions';

const mockCreateBox = vi.fn();
const mockUpdateBox = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    createBox: (...args: unknown[]) => mockCreateBox(...args) as unknown,
    updateBox: (...args: unknown[]) => mockUpdateBox(...args) as unknown,
  },
}));

import SuggestionBoxFormModal from './SuggestionBoxFormModal';

const options: ReviewerOptions = {
  positions: [
    { id: 'p-training', name: 'Training Officer' },
    { id: 'p-chief', name: 'Chief' },
  ],
  members: [{ id: 'u-drew', name: 'Drew Member' }],
};

const existing: SuggestionBoxAdmin = {
  id: 'b1',
  name: 'Ideas',
  description: null,
  anonymityMode: 'allowed',
  followUpEnabled: false,
  isActive: true,
  reviewerPositions: [{ id: 'p-training', name: 'Training Officer' }],
  reviewerMembers: [],
  watcherPositions: [],
  watcherMembers: [{ id: 'u-drew', name: 'Drew Member' }],
  publicBoardEnabled: false,
  submissionCount: 0,
};

describe('SuggestionBoxFormModal', () => {
  beforeEach(() => {
    mockCreateBox.mockReset();
    mockUpdateBox.mockReset();
    mockUpdateBox.mockResolvedValue(existing);
  });

  it('sends the notified positions and members with the reviewers', async () => {
    renderWithRouter(<SuggestionBoxFormModal box={existing} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);

    const user = userEvent.setup();
    const notified = screen.getByRole('group', { name: 'Notified positions' });
    await user.click(within(notified).getByRole('checkbox', { name: 'Chief' }));
    await user.click(screen.getByRole('button', { name: 'Save box' }));

    expect(mockUpdateBox).toHaveBeenCalledWith('b1', {
      name: 'Ideas',
      description: null,
      anonymityMode: 'allowed',
      followUpEnabled: false,
      isActive: true,
      reviewerPositionIds: ['p-training'],
      reviewerMemberIds: [],
      watcherPositionIds: ['p-chief'],
      watcherMemberIds: ['u-drew'],
      publicBoardEnabled: false,
    });
  });

  it('keeps a notified position apart from the reviewer checklist', () => {
    renderWithRouter(<SuggestionBoxFormModal box={existing} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);

    const reviewers = screen.getByRole('group', { name: 'Reviewer positions' });
    const notified = screen.getByRole('group', { name: 'Notified positions' });
    expect(within(reviewers).getByRole('checkbox', { name: 'Training Officer' })).toBeChecked();
    expect(within(notified).getByRole('checkbox', { name: 'Training Officer' })).not.toBeChecked();
  });
});
