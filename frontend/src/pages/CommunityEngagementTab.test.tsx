import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { CommunityEngagement } from '../services/api';

const getCommunityEngagement = vi.fn();
const getCommunityEngagementEvents = vi.fn();
const downloadCsv = vi.fn<(contents: string, filename: string) => void>();
vi.mock('../utils/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/csv')>()),
  downloadCsv: (contents: string, filename: string) => downloadCsv(contents, filename),
}));
vi.mock('../services/api', () => ({
  dashboardService: {
    getCommunityEngagement: (...args: unknown[]) => getCommunityEngagement(...args) as unknown,
    getCommunityEngagementEvents: (...args: unknown[]) => getCommunityEngagementEvents(...args) as unknown,
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import CommunityEngagementTab from './CommunityEngagementTab';

const report = (overrides: Partial<CommunityEngagement> = {}): CommunityEngagement => ({
  total_public_events: 30,
  total_member_attendees: 200,
  total_external_attendees: 900,
  upcoming_public_events: 3,
  period: 'year',
  period_start: '2026-01-01T05:00:00Z',
  period_end: '2026-11-10T17:00:00Z',
  current: {
    events_held: 19,
    people_reached: 2140,
    counted: 412,
    signed_in: 412,
    estimated: 1728,
    member_hours: 312,
    members_involved: 41,
    requests_received: 18,
    requests_completed: 14,
  },
  previous: {
    events_held: 15,
    people_reached: 1634,
    counted: 300,
    signed_in: 300,
    estimated: 1334,
    member_hours: 332,
    members_involved: 38,
    requests_received: 18,
    requests_completed: 12,
  },
  upcoming_events: 3,
  turnout: { events: 6, counted: 412, signed_in: 412, expected: 480 },
  granularity: 'month',
  by_period: [
    { period: '2026-09', events: 4, counted: 112, signed_in: 112, estimated: 268 },
    { period: '2026-10', events: 3, counted: 25, signed_in: 25, estimated: 40 },
  ],
  by_type: [
    { group: 'request', label: 'School Visit', events: 6, people_reached: 860 },
    { group: 'department', label: 'Public Education', events: 2, people_reached: 300 },
  ],
  recent_events: [
    {
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
    },
    {
      event_id: 'e2',
      title: 'CPR class',
      start_datetime: '2026-10-29T22:00:00Z',
      type_label: 'CPR',
      organization_name: 'Holt Auto Group',
      request_id: 'r2',
      signed_in: 25,
      headcount: null,
      counted: 25,
      expected: 30,
      people_reached: 25,
      reach_is_estimate: false,
      crew: 2,
      member_hours: 6,
    },
  ],
  ...overrides,
});

const Search = () => <p data-testid="search">{useLocation().search}</p>;

const renderTab = (search = '?tab=community') =>
  render(
    <MemoryRouter initialEntries={[`/events/admin${search}`]}>
      <Routes>
        <Route
          path="/events/admin"
          element={
            <>
              <CommunityEngagementTab />
              <Search />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe('CommunityEngagementTab', () => {
  beforeEach(() => {
    getCommunityEngagement.mockReset();
    getCommunityEngagement.mockResolvedValue(report());
    getCommunityEngagementEvents.mockReset();
    getCommunityEngagementEvents.mockResolvedValue([]);
    downloadCsv.mockReset();
  });

  it('reports reach as counted plus estimated, with the change against last year', async () => {
    renderTab();

    const reached = await screen.findByRole('group', { name: 'People reached' });
    expect(within(reached).getByText('2,140')).toBeInTheDocument();
    expect(within(reached).getByText('412 counted · 1,728 estimated')).toBeInTheDocument();
    expect(within(reached).getByText('+31%')).toBeInTheDocument();
    expect(screen.getByText(/412 counted against ~\s*480 expected \(86%\) across 6 events/)).toBeInTheDocument();
    expect(getCommunityEngagement).toHaveBeenCalledWith('year');
  });

  it('reports completions in the period beside the requests received in it', async () => {
    renderTab();

    const requests = await screen.findByRole('group', { name: 'Requests completed' });
    expect(within(requests).getByText('14')).toBeInTheDocument();
    expect(within(requests).getByText('18 received')).toBeInTheDocument();
    // 14 against 12 completed at the same point last year.
    expect(within(requests).getByText('+17%')).toBeInTheDocument();
  });

  it('breaks reach down by request type and by event type, separately', async () => {
    renderTab();

    const byType = await screen.findByRole('region', { name: 'By type of outreach' });
    const headings = within(byType)
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Public requests', 'Department events']);
    expect(within(byType).getByText('School Visit')).toBeInTheDocument();
    expect(within(byType).getByText('Public Education')).toBeInTheDocument();
  });

  it('exports every event in the period, not only the ones the table shows', async () => {
    getCommunityEngagement.mockResolvedValue(report({ current: { ...report().current, events_held: 312 } }));
    getCommunityEngagementEvents.mockResolvedValue(report().recent_events);
    renderTab();

    expect(await screen.findByText('The latest 2 of 312; the export has them all.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(getCommunityEngagementEvents).toHaveBeenCalledWith('year');
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [contents, filename] = downloadCsv.mock.calls[0] ?? [];
    expect(String(contents)).toContain('Oakville Elementary');
    expect(String(filename)).toMatch(/^community-engagement-year-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('marks an estimate as one and shows a count beside what was expected', async () => {
    renderTab();

    const table = await screen.findByRole('table', { name: 'Recent outreach events' });
    const assembly = within(table).getByRole('row', { name: /Oakville Elementary/ });
    expect(within(assembly).getByText('~120 est.')).toBeInTheDocument();
    const cpr = within(table).getByRole('row', { name: /Holt Auto Group/ });
    expect(within(cpr).getByText('25 signed in')).toBeInTheDocument();
    expect(within(cpr).getByText('of ~30 expected')).toBeInTheDocument();
  });

  it("opens on the dashboard card's period and keeps a new choice in the URL", async () => {
    renderTab('?tab=community&period=quarter');
    expect(await screen.findByRole('button', { name: 'This quarter' })).toHaveAttribute('aria-pressed', 'true');
    expect(getCommunityEngagement).toHaveBeenCalledWith('quarter');

    await userEvent.click(screen.getByRole('button', { name: 'All time' }));

    expect(getCommunityEngagement).toHaveBeenLastCalledWith('all');
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=community&period=all');
  });

  it('says nothing about change when there is no earlier period', async () => {
    getCommunityEngagement.mockResolvedValue(report({ period: 'all', previous: null }));
    renderTab('?tab=community&period=all');

    await screen.findByText('People reached');
    expect(screen.queryByText('+31%')).not.toBeInTheDocument();
    expect(screen.queryByText(/Changes compare with/)).not.toBeInTheDocument();
  });

  it('offers a retry when the report fails to load', async () => {
    getCommunityEngagement.mockRejectedValueOnce(new Error('Network down'));
    renderTab();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('People reached')).toBeInTheDocument();
  });
});
