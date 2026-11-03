import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import toast from 'react-hot-toast';
import type { ClearanceReview } from '../types';

const mockGetReview = vi.fn();
const mockDecide = vi.fn();

vi.mock('../services/api', () => ({
  historyService: {
    getClearanceReview: (...args: unknown[]) => mockGetReview(...args) as unknown,
    decideClearance: (...args: unknown[]) => mockDecide(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import HistoryClearanceReviewPage from './HistoryClearanceReviewPage';

const review = (canDecide: boolean): ClearanceReview => ({
  request: {
    id: 'r1',
    record_type: 'member',
    record_id: 'p1',
    record_label: 'John Smith',
    revision_number: 2,
    purpose: 'public',
    status: 'pending',
    current_step_index: 0,
    steps: [
      {
        index: 0,
        name: "President's review",
        position_id: 'pos1',
        position_name: 'President',
        blocked: false,
        decision: null,
        decided_by_name: null,
        decided_by_author: false,
        note: null,
        decided_at: null,
      },
    ],
    submitted_by_name: 'Hannah Historian',
    submitted_at: '2026-11-01T12:00:00Z',
    closed_at: null,
    can_decide: canDecide,
  },
  record: {
    view: 'member',
    id: 'p1',
    display_name: 'John Smith',
    first_name: 'John',
    middle_name: null,
    last_name: 'Smith',
    suffix: null,
    nickname: null,
    badge_number: null,
    biography_html: null,
    is_memorial: false,
    is_line_of_duty_death: false,
    service_periods: [],
    relations: [],
    publication_level: 'draft',
  },
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/history/clearance/r1']}>
      <Routes>
        <Route path="/history/clearance/:requestId" element={<HistoryClearanceReviewPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('HistoryClearanceReviewPage', () => {
  beforeEach(() => {
    mockGetReview.mockReset();
    mockDecide.mockReset();
    mockDecide.mockResolvedValue({});
    vi.mocked(toast.error).mockClear();
  });

  it('clears the step for a holder of its position', async () => {
    mockGetReview.mockResolvedValue(review(true));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Clear this step' }));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith('r1', 'cleared', undefined));
  });

  it('will not return a record without saying what to change', async () => {
    mockGetReview.mockResolvedValue(review(true));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Return for changes' }));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();

    await user.type(screen.getByLabelText('Note (required to return)'), 'Check the dates');
    await user.click(screen.getByRole('button', { name: 'Return for changes' }));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith('r1', 'returned', 'Check the dates'));
  });

  it('shows the record but no decision to a member who cannot decide', async () => {
    mockGetReview.mockResolvedValue(review(false));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'John Smith' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear this step' })).not.toBeInTheDocument();
  });
});
