/**
 * MM6-1: the meeting waivers list read `user_name` and `reason`, but
 * GET /meetings/{id}/attendance-waivers returns `member_name` and
 * `waiver_reason` — a clerk saw a raw user id and never the reason.
 *
 * MM6-2: creating a meeting, editing its agenda, deleting it and listing its
 * waivers are /meetings endpoints gated on meetings.manage, and the page
 * offered them on minutes.manage. A position holding only one of the two was
 * offered controls that 403, or denied ones it could use. Opening or creating
 * the minutes of a meeting stays on minutes.manage, as its endpoint is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetMeetings = vi.fn();
const mockGetSummary = vi.fn();
const mockGetWaivers = vi.fn();
const mockListAllMinutes = vi.fn();
const mockGetStats = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  meetingsService: {
    getMeetings: (...a: unknown[]) => mockGetMeetings(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
    getAttendanceWaivers: (...a: unknown[]) => mockGetWaivers(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    listAllMinutes: (...a: unknown[]) => mockListAllMinutes(...a) as unknown,
    getStats: (...a: unknown[]) => mockGetStats(...a) as unknown,
    getOutlines: vi.fn().mockResolvedValue([]),
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

const renderPage = async () => {
  renderWithRouter(<MinutesPage />);
  await screen.findByText('October Business Meeting');
};

describe('MinutesPage meeting controls', () => {
  beforeEach(() => {
    granted = new Set();
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
    mockGetWaivers.mockReset();
    mockGetWaivers.mockResolvedValue([
      {
        attendee_id: 'a-1',
        user_id: 'u-7f3c',
        member_name: 'Jordan Avery',
        waiver_reason: 'On shift at Station 2',
        granted_by: 'u-1',
        granted_by_name: 'Casey Lin',
        granted_at: '2026-10-01T22:00:00Z',
      },
    ]);
  });

  it('names the waived member and gives the reason the server sent', async () => {
    granted = new Set(['meetings.manage']);
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /Attendance Waivers/ }));

    expect(await screen.findByText('Jordan Avery')).toBeInTheDocument();
    expect(screen.getByText('Reason: On shift at Station 2')).toBeInTheDocument();
    expect(screen.queryByText('u-7f3c')).not.toBeInTheDocument();
  });

  it('does not offer meeting writes to a member who may only manage minutes', async () => {
    granted = new Set(['minutes.manage']);
    await renderPage();

    expect(screen.queryByRole('button', { name: 'Record Minutes' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit the agenda of October Business Meeting' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete October Business Meeting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Attendance Waivers/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create minutes from October Business Meeting' })).toBeInTheDocument();
  });

  it('offers meeting writes to a member who may manage meetings', async () => {
    granted = new Set(['meetings.manage']);
    await renderPage();

    expect(screen.getByRole('button', { name: 'Record Minutes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit the agenda of October Business Meeting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete October Business Meeting' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create minutes from October Business Meeting' })
    ).not.toBeInTheDocument();
  });
});
