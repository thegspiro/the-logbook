import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { CommunityEngagement, CommunityEventReach } from '../../services/api';

const getCommunityEngagement = vi.fn();
const getCommunityEngagementEvents = vi.fn();
const getBranding = vi.fn();
vi.mock('../../services/api', () => ({
  dashboardService: {
    getCommunityEngagement: (...args: unknown[]) => getCommunityEngagement(...args) as unknown,
    getCommunityEngagementEvents: (...args: unknown[]) => getCommunityEngagementEvents(...args) as unknown,
    getBranding: (...args: unknown[]) => getBranding(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import CommunityEngagementPrintPage from './CommunityEngagementPrintPage';

const totals = {
  events_held: 19,
  people_reached: 2140,
  counted: 412,
  signed_in: 300,
  estimated: 1728,
  member_hours: 312,
  members_involved: 41,
  requests_received: 18,
  requests_completed: 14,
};

const report = (overrides: Partial<CommunityEngagement> = {}): CommunityEngagement => ({
  total_public_events: 30,
  total_member_attendees: 200,
  total_external_attendees: 900,
  upcoming_public_events: 3,
  period: 'year',
  period_start: '2026-01-01T05:00:00Z',
  period_end: '2026-11-20T17:00:00Z',
  current: totals,
  previous: { ...totals, events_held: 15, people_reached: 1634, member_hours: 332, requests_completed: 12 },
  upcoming_events: 3,
  turnout: { events: 6, counted: 412, signed_in: 300, expected: 480 },
  granularity: 'month',
  by_period: [
    { period: '2026-09', events: 4, counted: 112, signed_in: 100, estimated: 268 },
    { period: '2026-10', events: 3, counted: 25, signed_in: 25, estimated: 40 },
  ],
  by_type: [
    { group: 'request', label: 'School Visit', events: 6, people_reached: 860 },
    { group: 'request', label: 'Station Tour', events: 5, people_reached: 520 },
    { group: 'request', label: 'CPR', events: 2, people_reached: 40 },
    { group: 'request', label: 'Fundraiser', events: 1, people_reached: 30 },
    { group: 'request', label: 'Block Party', events: 1, people_reached: 20 },
    { group: 'department', label: 'Public Education', events: 4, people_reached: 670 },
  ],
  recent_events: [],
  ...overrides,
});

const event = (overrides: Partial<CommunityEventReach> = {}): CommunityEventReach => ({
  event_id: 'e1',
  title: 'Fire prevention assembly',
  start_datetime: '2026-11-04T15:00:00Z',
  type_label: 'School Visit',
  organization_name: 'Oakville Elementary',
  request_id: 'r1',
  signed_in: 0,
  headcount: null,
  counted: null,
  expected: 120,
  people_reached: 120,
  reach_is_estimate: true,
  crew: 4,
  member_hours: 10,
  ...overrides,
});

const renderPage = (search = '?period=year') =>
  render(
    <MemoryRouter initialEntries={[`/events/admin/community/print${search}`]}>
      <Routes>
        <Route path="/events/admin/community/print" element={<CommunityEngagementPrintPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('CommunityEngagementPrintPage', () => {
  beforeEach(() => {
    getCommunityEngagement.mockReset();
    getCommunityEngagement.mockResolvedValue(report());
    getCommunityEngagementEvents.mockReset();
    getCommunityEngagementEvents.mockResolvedValue([
      event(),
      event({
        event_id: 'e2',
        title: 'Hands-only CPR',
        type_label: 'CPR',
        organization_name: null,
        headcount: 25,
        counted: 25,
        expected: null,
        people_reached: 25,
        reach_is_estimate: false,
        crew: 2,
        member_hours: 6,
      }),
    ]);
    getBranding.mockReset();
    getBranding.mockResolvedValue({ name: 'Oakville Fire Department', logo: 'https://example.org/logo.png' });
    vi.mocked(window.print).mockClear();
  });

  it('heads the page with the department, the period and its dates', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Outreach Impact Summary' })).toBeInTheDocument();
    expect(await screen.findByText('Oakville Fire Department')).toBeInTheDocument();
    expect(screen.getByText('This year · January 1, 2026 – November 20, 2026')).toBeInTheDocument();
    expect(getCommunityEngagement).toHaveBeenCalledWith('year');
    expect(getCommunityEngagementEvents).toHaveBeenCalledWith('year');
    expect(await screen.findByRole('presentation')).toHaveAttribute('src', 'https://example.org/logo.png');
  });

  it('sets each headline figure beside the previous period and the change', async () => {
    renderPage();

    const table = within(await screen.findByRole('region', { name: 'Headline figures' })).getByRole('table');
    const reached = within(table).getByRole('row', { name: /People reached/ });
    expect(within(reached).getByText('2,140')).toBeInTheDocument();
    expect(within(reached).getByText('1,634')).toBeInTheDocument();
    expect(within(reached).getByText('+31%')).toBeInTheDocument();
    expect(within(reached).getByText('412 counted, 1,728 estimated')).toBeInTheDocument();
    expect(screen.getByText(/412 were counted against about 480 expected \(86%\) across 6 events/)).toBeInTheDocument();
  });

  it('lists every type, without folding the smaller ones into Other', async () => {
    renderPage();

    const requests = await screen.findByRole('table', { name: 'Public requests' });
    const labels = within(requests)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent);
    expect(labels).toEqual(['School Visit', 'Station Tour', 'CPR', 'Fundraiser', 'Block Party']);
    expect(screen.getByRole('table', { name: 'Department events' })).toBeInTheDocument();
  });

  it('lists every event in the period, saying how its reach was found', async () => {
    renderPage();

    const assembly = await screen.findByRole('row', { name: /Fire prevention assembly/ });
    expect(within(assembly).getByText('~120 est.')).toBeInTheDocument();
    expect(within(assembly).getByText('Requested by Oakville Elementary')).toBeInTheDocument();
    const cpr = screen.getByRole('row', { name: /Hands-only CPR/ });
    expect(within(cpr).getByText('25 counted')).toBeInTheDocument();
  });

  it('prints the CRR breakdowns as tables, without the map', async () => {
    getCommunityEngagement.mockResolvedValue(
      report({
        crr: {
          activities: 2,
          previous_activities: 1,
          by_type: [
            {
              activity_type_id: 't-smoke',
              name: 'Smoke alarm install',
              activities: 2,
              previous_activities: 1,
              counts: [{ measure_id: 'm-alarms', label: 'Alarms installed', quantity: 5, previous_quantity: 3 }],
            },
          ],
          by_tag: [
            {
              tag_id: 'tag-fire',
              kind: 'risk',
              label: 'Fire',
              activities: 2,
              counts: [
                {
                  measure_id: 'm-alarms',
                  activity_type_name: 'Smoke alarm install',
                  label: 'Alarms installed',
                  quantity: 5,
                },
              ],
            },
          ],
          by_zip: [
            {
              zip_code: '22046',
              city: 'Falls Church',
              state: 'VA',
              latitude: 38.8856,
              longitude: -77.1802,
              activities: 1,
              counts: [
                {
                  measure_id: 'm-alarms',
                  activity_type_name: 'Smoke alarm install',
                  label: 'Alarms installed',
                  quantity: 3,
                },
              ],
            },
          ],
          unplaced_activities: 1,
        },
      })
    );
    renderPage();

    const types = await screen.findByRole('table', { name: /By activity \(2 activities\)/ });
    expect(within(types).getByRole('row', { name: /Smoke alarm install 2 Alarms installed 5/ })).toBeInTheDocument();
    const tags = screen.getByRole('table', { name: /By risk and priority population/ });
    expect(within(tags).getByRole('rowheader', { name: 'Fire (risk)' })).toBeInTheDocument();
    const zips = screen.getByRole('table', { name: /By ZIP code \(1 activity had no ZIP code\)/ });
    expect(within(zips).getByRole('rowheader', { name: '22046 Falls Church, VA' })).toBeInTheDocument();
  });

  it('opens the print dialog once the report has loaded', async () => {
    renderPage();

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it('prints nothing and says so when the report fails to load', async () => {
    getCommunityEngagement.mockReset();
    getCommunityEngagement.mockRejectedValue(new Error('Network down'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(window.print).not.toHaveBeenCalled();
  });

  it('leaves out the comparison for all time, which has no earlier period', async () => {
    getCommunityEngagement.mockReset();
    getCommunityEngagement.mockResolvedValue(report({ period: 'all', period_start: null, previous: null }));
    renderPage('?period=all');

    expect(await screen.findByText('All time · Through November 20, 2026')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Previous' })).not.toBeInTheDocument();
    expect(getCommunityEngagement).toHaveBeenCalledWith('all');
  });

  it('does not draw a logo whose address could run script', async () => {
    getBranding.mockReset();
    getBranding.mockResolvedValue({ name: 'Oakville Fire Department', logo: 'javascript:alert(1)' });
    renderPage();

    expect(await screen.findByText('Oakville Fire Department')).toBeInTheDocument();
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });

  it('prints the report without the department name when branding cannot be read', async () => {
    getBranding.mockReset();
    getBranding.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Outreach Impact Summary' })).toBeInTheDocument();
    expect(screen.queryByText('Oakville Fire Department')).not.toBeInTheDocument();
  });
});
