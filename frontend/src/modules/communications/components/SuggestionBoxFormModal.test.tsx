import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
      intakeQuestions: [],
    });
  });

  it('keeps a notified position apart from the reviewer checklist', () => {
    renderWithRouter(<SuggestionBoxFormModal box={existing} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);

    const reviewers = screen.getByRole('group', { name: 'Reviewer positions' });
    const notified = screen.getByRole('group', { name: 'Notified positions' });
    expect(within(reviewers).getByRole('checkbox', { name: 'Training Officer' })).toBeChecked();
    expect(within(notified).getByRole('checkbox', { name: 'Training Officer' })).not.toBeChecked();
  });

  it('scrolls the form in one region and keeps the save action pinned outside it', () => {
    renderWithRouter(<SuggestionBoxFormModal box={existing} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByTestId('modal-panel').tagName).toBe('FORM');
    expect(within(screen.getByTestId('modal-footer')).getByRole('button', { name: 'Save box' })).toHaveAttribute(
      'type',
      'submit'
    );
  });

  it('puts the questions right after the name and description', () => {
    renderWithRouter(<SuggestionBoxFormModal box={existing} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);

    const description = screen.getByLabelText(/Description/);
    const questions = screen.getByRole('heading', { name: 'Questions' });
    const anonymity = screen.getByLabelText('Anonymity');
    expect(description.compareDocumentPosition(questions) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(questions.compareDocumentPosition(anonymity) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('puts a 422 on its field, saves the rest of an edit and stays open', async () => {
    mockUpdateBox
      .mockRejectedValueOnce({
        response: {
          status: 422,
          data: { detail: [{ field: 'name', message: 'String should have at most 100 characters' }] },
        },
      })
      .mockResolvedValue(existing);
    const onSaved = vi.fn();
    renderWithRouter(<SuggestionBoxFormModal box={existing} options={options} onClose={vi.fn()} onSaved={onSaved} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Name/), ' and more');
    await user.click(screen.getByRole('button', { name: 'Save box' }));

    const name = screen.getByLabelText(/^Name/);
    await waitFor(() => expect(name).toHaveAccessibleDescription('Name is too long — keep it to 100 characters.'));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(mockUpdateBox).toHaveBeenCalledTimes(2);
    expect((mockUpdateBox.mock.calls[0]?.[1] as { name: string }).name).toBe('Ideas and more');
    expect((mockUpdateBox.mock.calls[1]?.[1] as { name: string }).name).toBe('Ideas');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws an edit away', async () => {
    const onClose = vi.fn();
    renderWithRouter(<SuggestionBoxFormModal box={existing} options={options} onClose={onClose} onSaved={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Name/), ' box');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Ideas box');
  });
});
