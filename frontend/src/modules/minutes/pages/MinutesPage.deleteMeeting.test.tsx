/**
 * A refused meeting delete says why. The page used to answer every failure,
 * including the server refusing a meeting it will not delete, with "Check
 * your connection", which sent the clerk looking for a network problem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetMeetings = vi.fn();
const mockGetSummary = vi.fn();
const mockDeleteMeeting = vi.fn();
const mockListAllMinutes = vi.fn();
const mockGetStats = vi.fn();
const mockGetOutlines = vi.fn();

vi.mock('../../../services/api', () => ({
  meetingsService: {
    getMeetings: (...a: unknown[]) => mockGetMeetings(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
    deleteMeeting: (...a: unknown[]) => mockDeleteMeeting(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    listAllMinutes: (...a: unknown[]) => mockListAllMinutes(...a) as unknown,
    getStats: (...a: unknown[]) => mockGetStats(...a) as unknown,
    getOutlines: (...a: unknown[]) => mockGetOutlines(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: () => true, user: undefined };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

import MinutesPage from './MinutesPage';
import { renderWithRouter } from '../../../test/utils';

const meeting = {
  id: 'meet-1',
  organization_id: 'org-1',
  title: 'October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-01',
  start_time: '19:00:00',
  location: 'Station 1',
  called_by: null,
  status: 'draft',
  notes: null,
  created_at: '2026-10-03T13:30:47Z',
  updated_at: '2026-10-03T13:30:47Z',
  attendee_count: 0,
  action_item_count: 0,
};

const REFUSAL = 'An approved meeting cannot be deleted';

describe('MinutesPage meeting delete', () => {
  beforeEach(() => {
    mockGetMeetings.mockReset();
    mockGetMeetings.mockResolvedValue({ meetings: [meeting] });
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_meetings: 1,
      meetings_this_month: 1,
      open_action_items: 0,
      pending_approval: 0,
    });
    mockListAllMinutes.mockReset();
    mockListAllMinutes.mockResolvedValue([]);
    mockGetStats.mockReset();
    mockGetStats.mockResolvedValue({ total: 0, this_month: 0, open_action_items: 0, pending_approval: 0 });
    mockGetOutlines.mockReset();
    mockGetOutlines.mockResolvedValue([]);
    mockDeleteMeeting.mockReset();
    mockDeleteMeeting.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: { detail: REFUSAL } },
    });
  });

  it('Keep it deletes nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete October Business Meeting' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDeleteMeeting).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the delete is refused", async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete October Business Meeting' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
    expect(mockDeleteMeeting).toHaveBeenCalledWith('meet-1');
    expect(screen.queryByText(/Check your connection/)).not.toBeInTheDocument();
  });
});
