import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
    vi.mocked(Element.prototype.scrollIntoView).mockReset();
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

  it('brings the active tab into view once the Review tab appears', async () => {
    window.history.pushState({}, '', '/suggestions?tab=review');
    mockSummary.mockResolvedValue({ isReviewer: true, openCount: 0, boxes: [] });
    const scrolled: Element[] = [];
    vi.mocked(Element.prototype.scrollIntoView).mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    renderWithRouter(<SuggestionsPage />);

    const reviewTab = await screen.findByRole('tab', { name: /Review/ });
    expect(reviewTab).toHaveAttribute('aria-selected', 'true');
    // The scroll runs in a passive effect, and the summary resolves outside
    // act(), so the tab can reach the DOM before that effect has flushed.
    await waitFor(() => expect(scrolled).toContain(reviewTab));
  });

  it('shows a reviewer the Review tab with the open count', async () => {
    mockSummary.mockResolvedValue({ isReviewer: true, openCount: 3, boxes: [] });
    renderWithRouter(<SuggestionsPage />);

    expect(await screen.findByRole('tab', { name: /Review\s*3/ })).toBeInTheDocument();
  });

  it('offers the Idea board tab only when a box has a board', async () => {
    mockSummary.mockResolvedValue({ isReviewer: false, openCount: 0, boxes: [] });
    mockListBoxes.mockResolvedValue([
      {
        id: 'b1',
        name: 'Ideas',
        description: null,
        anonymityMode: 'allowed',
        followUpEnabled: true,
        publicBoardEnabled: true,
      },
    ]);
    renderWithRouter(<SuggestionsPage />);

    expect(await screen.findByRole('tab', { name: /Idea board|Ideas/ })).toBeInTheDocument();
  });

  it('offers no Idea board tab when no box has one', async () => {
    mockSummary.mockResolvedValue({ isReviewer: false, openCount: 0, boxes: [] });
    renderWithRouter(<SuggestionsPage />);

    await screen.findByText('No suggestion boxes yet');
    expect(screen.queryByRole('tab', { name: /Idea board|Ideas/ })).not.toBeInTheDocument();
  });
});
