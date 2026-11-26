/**
 * MM6-7: the meetings list refetched on every keystroke in the search box and
 * on every filter change, with nothing to stop an earlier, slower response
 * landing after a later one — the list then showed results for a filter the
 * controls no longer named. The search now settles before it is sent, and a
 * response that is no longer the latest is dropped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetMeetings = vi.fn();
const mockGetSummary = vi.fn();
const mockListAllMinutes = vi.fn();
const mockGetStats = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  meetingsService: {
    getMeetings: (...a: unknown[]) => mockGetMeetings(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    listAllMinutes: (...a: unknown[]) => mockListAllMinutes(...a) as unknown,
    getStats: (...a: unknown[]) => mockGetStats(...a) as unknown,
    getOutlines: vi.fn().mockResolvedValue([]),
    // Typing also runs the archive search beneath the list.
    searchArchive: vi.fn().mockResolvedValue({ terms: [], hits: [], searched: 0, truncated: false }),
  },
}));

let granted = new Set<string>();
vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: (p: string) => granted.has(p), user: undefined };
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

const named = (title: string, id: string, meeting_type: string) => ({ ...meeting, id, title, meeting_type });

describe('MinutesPage search and filter', () => {
  beforeEach(() => {
    granted = new Set(['minutes.manage', 'meetings.manage']);
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
  });

  it('searches once for what was typed, not once per letter', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);
    await screen.findByText('October Business Meeting');

    await user.type(screen.getByLabelText('Search meetings'), 'SCBA');

    await waitFor(() => expect(mockGetMeetings).toHaveBeenCalledWith({ search: 'SCBA' }));
    const searches = mockGetMeetings.mock.calls.map(([params]) => (params as { search?: string }).search);
    expect(searches.filter((s) => s !== undefined)).toEqual(['SCBA']);
  });

  it('shows the latest filter, whichever response arrives last', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);
    await screen.findByText('October Business Meeting');

    let releaseBusiness: (value: unknown) => void = () => undefined;
    mockGetMeetings.mockImplementationOnce(() => new Promise((resolve) => (releaseBusiness = resolve)));
    await user.selectOptions(screen.getByLabelText('Filter by meeting type'), 'business');
    mockGetMeetings.mockResolvedValueOnce({ meetings: [named('Special Meeting on the Levy', 'meet-s', 'special')] });
    await user.selectOptions(screen.getByLabelText('Filter by meeting type'), 'special');
    expect(await screen.findByText('Special Meeting on the Levy')).toBeInTheDocument();

    releaseBusiness({ meetings: [named('Stale Business Meeting', 'meet-b', 'business')] });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText('Special Meeting on the Levy')).toBeInTheDocument();
    expect(screen.queryByText('Stale Business Meeting')).not.toBeInTheDocument();
  });
});
