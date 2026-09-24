import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockSummary = vi.fn();
const mockListBoxes = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    getReviewSummary: (...args: unknown[]) => mockSummary(...args) as unknown,
    listBoxes: (...args: unknown[]) => mockListBoxes(...args) as unknown,
  },
}));

import SuggestionsPage from './SuggestionsPage';

describe('SuggestionsPage', () => {
  beforeEach(() => {
    mockSummary.mockReset();
    mockListBoxes.mockReset();
    mockListBoxes.mockResolvedValue([]);
    window.history.pushState({}, '', '/suggestions');
  });

  it('offers no Review tab to a member who reviews nothing', async () => {
    mockSummary.mockResolvedValue({ isReviewer: false, openCount: 0, boxes: [] });
    renderWithRouter(<SuggestionsPage />);

    expect(await screen.findByRole('tab', { name: 'Submit' })).toBeInTheDocument();
    await screen.findByText('No suggestion boxes yet');
    expect(screen.queryByRole('tab', { name: /Review/ })).not.toBeInTheDocument();
  });

  it('shows a reviewer the Review tab with the open count', async () => {
    mockSummary.mockResolvedValue({ isReviewer: true, openCount: 3, boxes: [] });
    renderWithRouter(<SuggestionsPage />);

    expect(await screen.findByRole('tab', { name: /Review\s*3/ })).toBeInTheDocument();
  });
});
