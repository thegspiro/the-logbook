import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { SuggestionBoxAdmin } from '../types/suggestions';

const mockListAdminBoxes = vi.fn();
const mockReviewerOptions = vi.fn();
const mockDeleteBox = vi.fn();
const mockUpdateBox = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    listAdminBoxes: (...args: unknown[]) => mockListAdminBoxes(...args) as unknown,
    getReviewerOptions: (...args: unknown[]) => mockReviewerOptions(...args) as unknown,
    deleteBox: (...args: unknown[]) => mockDeleteBox(...args) as unknown,
    updateBox: (...args: unknown[]) => mockUpdateBox(...args) as unknown,
  },
}));

import SuggestionBoxesAdminPage from './SuggestionBoxesAdminPage';

const box = (overrides: Partial<SuggestionBoxAdmin> = {}): SuggestionBoxAdmin => ({
  id: 'b1',
  name: 'Ideas',
  description: null,
  anonymityMode: 'allowed',
  followUpEnabled: true,
  isActive: true,
  reviewerPositions: [{ id: 'p1', name: 'Training Officer' }],
  reviewerMembers: [],
  watcherPositions: [],
  watcherMembers: [],
  publicBoardEnabled: false,
  submissionCount: 0,
  ...overrides,
});

describe('SuggestionBoxesAdminPage deleting', () => {
  beforeEach(() => {
    mockListAdminBoxes.mockReset();
    mockReviewerOptions.mockReset();
    mockDeleteBox.mockReset();
    mockUpdateBox.mockReset();
    mockReviewerOptions.mockResolvedValue({ positions: [], members: [] });
    mockDeleteBox.mockResolvedValue(undefined);
  });

  it('deletes an empty box after a plain confirmation', async () => {
    mockListAdminBoxes.mockResolvedValue([box()]);
    renderWithRouter(<SuggestionBoxesAdminPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete Ideas' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete box' }));

    expect(mockDeleteBox).toHaveBeenCalledWith('b1');
    await vi.waitFor(() => expect(screen.queryByText('Ideas')).not.toBeInTheDocument());
  });

  it('asks for the name before deleting a box with submissions', async () => {
    mockListAdminBoxes.mockResolvedValue([box({ submissionCount: 3 })]);
    renderWithRouter(<SuggestionBoxesAdminPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete Ideas' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('3 submissions');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete permanently' });
    expect(confirmButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Type Ideas to delete it permanently/), 'ideas');
    expect(confirmButton).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/Type Ideas/));
    await user.type(within(dialog).getByLabelText(/Type Ideas/), 'Ideas');
    await user.click(confirmButton);

    expect(mockDeleteBox).toHaveBeenCalledWith('b1', 'Ideas');
  });

  it('offers archiving instead, sending the whole box', async () => {
    // The board setting rides along untouched: archiving must not switch it off.
    mockListAdminBoxes.mockResolvedValue([box({ submissionCount: 1, publicBoardEnabled: true })]);
    mockUpdateBox.mockResolvedValue(box({ submissionCount: 1, publicBoardEnabled: true, isActive: false }));
    renderWithRouter(<SuggestionBoxesAdminPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete Ideas' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive instead' }));

    expect(mockUpdateBox).toHaveBeenCalledWith('b1', {
      name: 'Ideas',
      description: null,
      anonymityMode: 'allowed',
      followUpEnabled: true,
      isActive: false,
      reviewerPositionIds: ['p1'],
      reviewerMemberIds: [],
      watcherPositionIds: [],
      watcherMemberIds: [],
      publicBoardEnabled: true,
    });
    expect(mockDeleteBox).not.toHaveBeenCalled();
    expect(await screen.findByText('Not accepting submissions')).toBeInTheDocument();
  });
});
