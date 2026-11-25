import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { EventRequestListItem, OutreachCalendarItem } from '../../types/event';

const getOutreachCalendar = vi.fn();
const listRequests = vi.fn();
const getCommunityEngagement = vi.fn();
vi.mock('../../services/api', () => ({
  eventService: {
    getOutreachCalendar: (...args: unknown[]) => getOutreachCalendar(...args) as unknown,
  },
  eventRequestService: {
    listRequests: (...args: unknown[]) => listRequests(...args) as unknown,
  },
  dashboardService: {
    getCommunityEngagement: (...args: unknown[]) => getCommunityEngagement(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import OutreachOverviewTab from './OutreachOverviewTab';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Instants relative to the moment each test starts (pitfall #40). */
const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

const item = (overrides: Partial<OutreachCalendarItem>): OutreachCalendarItem => ({
  event_id: 'e1',
  title: 'School visit',
  event_type: 'public_education',
  start_datetime: fromNow(3 * DAY),
  end_datetime: fromNow(3 * DAY + 2 * HOUR),
  location: null,
  is_draft: false,
  request_id: null,
  request_organization: null,
  volunteers_filled: null,
  volunteers_total: null,
  crew_filled: null,
  crew_total: null,
  unit_numbers: [],
  attendance_finalized: false,
  ...overrides,
});

const request = (overrides: Partial<EventRequestListItem>): EventRequestListItem => ({
  id: 'r1',
  contact_name: 'Pat Requester',
  outreach_type: 'station_tour',
  status: 'submitted',
  date_flexibility: 'flexible',
  created_at: fromNow(-2 * DAY),
  ...overrides,
});

const totals = {
  events_held: 19,
  people_reached: 2140,
  counted: 412,
  signed_in: 412,
  estimated: 1728,
  member_hours: 312,
  members_involved: 41,
  requests_received: 18,
  requests_completed: 14,
};

const renderTab = () =>
  render(
    <MemoryRouter>
      <OutreachOverviewTab />
    </MemoryRouter>
  );

describe('OutreachOverviewTab', () => {
  beforeEach(() => {
    getOutreachCalendar.mockReset();
    listRequests.mockReset();
    getCommunityEngagement.mockReset();
    getOutreachCalendar.mockResolvedValue([]);
    listRequests.mockResolvedValue([]);
    getCommunityEngagement.mockResolvedValue({ current: totals });
  });

  it('lists what needs the manager under each attention card', async () => {
    getOutreachCalendar.mockResolvedValue([
      item({ event_id: 'short', title: 'Fair booth', volunteers_filled: 1, volunteers_total: 3 }),
      item({ event_id: 'full', title: 'Station tour', volunteers_filled: 3, volunteers_total: 3 }),
      item({
        event_id: 'over',
        title: 'Block party',
        start_datetime: fromNow(-3 * DAY),
        end_datetime: fromNow(-3 * DAY + 2 * HOUR),
      }),
    ]);
    listRequests.mockResolvedValue([
      request({ id: 'r-new', organization_name: 'Oak Elementary', short_notice: true }),
      request({ id: 'r-busy', organization_name: 'Scout Troop 12', status: 'in_progress' }),
    ]);

    renderTab();

    const reply = await screen.findByRole('region', { name: 'Waiting for a reply' });
    expect(within(reply).getByRole('link', { name: /Oak Elementary/ })).toHaveAttribute(
      'href',
      '/events/admin/requests/r-new'
    );
    expect(within(reply).getByText(/Unassigned · Short notice/)).toBeInTheDocument();
    expect(within(reply).queryByText('Scout Troop 12')).not.toBeInTheDocument();

    const short = screen.getByRole('region', { name: 'Short of people' });
    expect(within(short).getByRole('link', { name: /Fair booth/ })).toHaveAttribute('href', '/events/short');
    expect(within(short).getByText(/1 of 3 volunteers/)).toBeInTheDocument();
    expect(within(short).queryByText('Station tour')).not.toBeInTheDocument();

    const closeout = screen.getByRole('region', { name: 'Waiting to be closed out' });
    expect(within(closeout).getByRole('link', { name: /Block party/ })).toHaveAttribute('href', '/events/over');
  });

  it('says so when nothing needs attention', async () => {
    renderTab();

    expect(await screen.findByText('Every request has a reply.')).toBeInTheDocument();
    expect(screen.getByText('Every signup sheet and crew is full.')).toBeInTheDocument();
    expect(screen.getByText('Every recent event is closed out.')).toBeInTheDocument();
  });

  it('keeps the rest of the page when one source fails', async () => {
    listRequests.mockRejectedValue(new Error('Requests are down'));
    getOutreachCalendar.mockResolvedValue([
      item({ event_id: 'short', title: 'Fair booth', volunteers_filled: 0, volunteers_total: 2 }),
    ]);

    renderTab();

    const reply = await screen.findByRole('region', { name: 'Waiting for a reply' });
    expect(within(reply).getByRole('alert')).toHaveTextContent('Requests are down');
    const short = screen.getByRole('region', { name: 'Short of people' });
    expect(await within(short).findByRole('link', { name: /Fair booth/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'People reached' })).toHaveTextContent('2,140');
  });

  it('shows the year at a glance from Outreach Impact', async () => {
    renderTab();

    expect(await screen.findByRole('group', { name: 'Events held' })).toHaveTextContent('19');
    expect(screen.getByRole('group', { name: 'Requests completed' })).toHaveTextContent('18 received');
    expect(getCommunityEngagement).toHaveBeenCalledWith('year');
    expect(screen.getByRole('link', { name: 'Full Outreach Impact report' })).toHaveAttribute(
      'href',
      '/events/admin?tab=community'
    );
  });

  it("shows this year's goals furthest behind pace, from the same report", async () => {
    getCommunityEngagement.mockResolvedValue({
      current: totals,
      goals: {
        year: 2026,
        year_fraction: 0.5,
        year_complete: false,
        goals: [
          {
            id: 'g-ahead',
            year: 2026,
            kind: 'outreach',
            measure_id: null,
            outreach_metric: null,
            label: 'People reached',
            target: 100,
            actual: 80,
            pace_target: 50,
            met: false,
            on_pace: true,
          },
          {
            id: 'g-near',
            year: 2026,
            kind: 'outreach',
            measure_id: null,
            outreach_metric: null,
            label: 'Events held',
            target: 100,
            actual: 45,
            pace_target: 50,
            met: false,
            on_pace: false,
          },
          {
            id: 'g-far',
            year: 2026,
            kind: 'outreach',
            measure_id: null,
            outreach_metric: null,
            label: 'Member hours',
            target: 100,
            actual: 10,
            pace_target: 50,
            met: false,
            on_pace: false,
          },
        ],
      },
    });
    renderTab();

    const card = await screen.findByRole('group', { name: 'Goals for 2026' });
    expect(
      within(card)
        .getAllByRole('progressbar')
        .map((bar) => bar.getAttribute('aria-label'))
    ).toEqual(['Member hours', 'Events held']);
    expect(within(card).getByRole('link', { name: 'All goals' })).toHaveAttribute(
      'href',
      '/events/admin?tab=community'
    );
    expect(getCommunityEngagement).toHaveBeenCalledTimes(1);
  });

  it('offers to set goals when the year has none', async () => {
    getCommunityEngagement.mockResolvedValue({
      current: totals,
      goals: { year: 2026, year_fraction: 0.5, year_complete: false, goals: [] },
    });
    renderTab();

    const card = await screen.findByRole('group', { name: 'Goals for 2026' });
    expect(within(card).getByRole('link', { name: 'Set goals' })).toHaveAttribute(
      'href',
      '/events/admin?tab=settings&section=goals'
    );
  });

  it('sends "Log a request" to the requests board with its dialog open', async () => {
    renderTab();

    expect(await screen.findByRole('link', { name: 'Log a request' })).toHaveAttribute(
      'href',
      '/events/admin?tab=requests&new=1'
    );
  });

  it('lists the selected day’s events, with their staffing and request', async () => {
    const today = item({
      event_id: 'today',
      title: 'Car seat check',
      // Now is today in the department's timezone at any hour; an hour ahead
      // is tomorrow for the last hour of every day.
      start_datetime: fromNow(0),
      end_datetime: fromNow(HOUR),
      volunteers_filled: 2,
      volunteers_total: 2,
      request_id: 'r9',
      request_organization: 'Library',
      unit_numbers: ['E1'],
    });
    getOutreachCalendar.mockResolvedValue([today]);

    renderTab();

    // The day panel is the one region named by a date ("Saturday, November 21").
    const panel = await screen.findByRole('region', { name: /, / });
    expect(await within(panel).findByRole('link', { name: 'Car seat check' })).toHaveAttribute('href', '/events/today');
    expect(within(panel).getByText('2 of 2 volunteers')).toBeInTheDocument();
    expect(within(panel).getByText('E1')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Request from Library/ })).toHaveAttribute(
      'href',
      '/events/admin/requests/r9'
    );
  });

  it('fetches the week when the view switches to week', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('grid');
    const callsBefore = getOutreachCalendar.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'week' }));

    expect(screen.getByRole('button', { name: 'week' })).toHaveAttribute('aria-pressed', 'true');
    expect(getOutreachCalendar.mock.calls.length).toBeGreaterThan(callsBefore);
    const calls = getOutreachCalendar.mock.calls as [string, string][];
    const [start, end] = calls[calls.length - 1] ?? ['', ''];
    expect(new Date(end).getTime() - new Date(start).getTime()).toBeGreaterThanOrEqual(7 * DAY - HOUR);
    expect(new Date(end).getTime() - new Date(start).getTime()).toBeLessThanOrEqual(7 * DAY + HOUR);
  });
});
