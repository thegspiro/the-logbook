import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { BoardEntry } from '../types/suggestions';

const mockListBoard = vi.fn();
const mockVote = vi.fn();
const mockWithdrawVote = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    listBoard: (...args: unknown[]) => mockListBoard(...args) as unknown,
    vote: (...args: unknown[]) => mockVote(...args) as unknown,
    withdrawVote: (...args: unknown[]) => mockWithdrawVote(...args) as unknown,
  },
}));

import SuggestionBoardPanel from './SuggestionBoardPanel';

const entry = (overrides: Partial<BoardEntry> = {}): BoardEntry => ({
  id: 'e1',
  boxId: 'b1',
  boxName: 'Ideas',
  title: 'Hose dryer',
  summary: 'Dry hose faster after calls.',
  disposition: 'under_review',
  publicResponse: null,
  voteCount: 2,
  hasVoted: false,
  publishedAt: '2026-09-20T15:00:00Z',
  ...overrides,
});

describe('SuggestionBoardPanel', () => {
  beforeEach(() => {
    mockListBoard.mockReset();
    mockVote.mockReset();
    mockWithdrawVote.mockReset();
    mockListBoard.mockResolvedValue({ items: [entry()], total: 1 });
  });

  it('asks for the top ideas first, then newest when switched', async () => {
    renderWithRouter(<SuggestionBoardPanel boxes={[]} />);
    await screen.findByText('Hose dryer');
    expect(mockListBoard).toHaveBeenLastCalledWith({ boxId: '', disposition: '', sort: 'top', skip: 0, limit: 25 });

    await userEvent.setup().click(screen.getByRole('button', { name: 'New' }));
    expect(mockListBoard).toHaveBeenLastCalledWith({ boxId: '', disposition: '', sort: 'new', skip: 0, limit: 25 });
  });

  it('votes, then takes the vote back', async () => {
    mockVote.mockResolvedValue(entry({ voteCount: 3, hasVoted: true }));
    mockWithdrawVote.mockResolvedValue(entry({ voteCount: 2, hasVoted: false }));
    renderWithRouter(<SuggestionBoardPanel boxes={[]} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Vote for Hose dryer, 2 votes' }));
    const voted = await screen.findByRole('button', { name: 'Remove your vote for Hose dryer, 3 votes' });
    expect(voted).toHaveAttribute('aria-pressed', 'true');
    expect(mockVote).toHaveBeenCalledWith('e1');

    await user.click(voted);
    expect(await screen.findByRole('button', { name: 'Vote for Hose dryer, 2 votes' })).toBeInTheDocument();
    expect(mockWithdrawVote).toHaveBeenCalledWith('e1');
  });

  it('shows the reviewers’ latest response with the idea', async () => {
    mockListBoard.mockResolvedValue({ items: [entry({ publicResponse: 'Ordered one.' })], total: 1 });
    renderWithRouter(<SuggestionBoardPanel boxes={[]} />);

    expect(await screen.findByText('Ordered one.')).toBeInTheDocument();
  });

  it('says so when the board is empty', async () => {
    mockListBoard.mockResolvedValue({ items: [], total: 0 });
    renderWithRouter(<SuggestionBoardPanel boxes={[]} />);

    expect(await screen.findByText('No ideas here yet')).toBeInTheDocument();
  });
});
