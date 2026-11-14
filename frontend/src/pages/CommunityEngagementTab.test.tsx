import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { CommunityEngagement } from '../services/api';

const getCommunityEngagement = vi.fn();
vi.mock('../services/api', () => ({
  dashboardService: {
    getCommunityEngagement: (...args: unknown[]) => getCommunityEngagement(...args) as unknown,
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
    signed_in: 300,
    estimated: 1334,
    member_hours: 332,
    members_involved: 38,
    requests_received: 18,
    requests_completed: 12,
  },
  upcoming_events: 3,
  turnout: { events: 6, signed_in: 412, expected: 480 },
  granularity: 'month',
  by_period: [
    { period: '2026-09', events: 4, signed_in: 112, estimated: 268 },
    { period: '2026-10', events: 3, signed_in: 25, estimated: 40 },
  ],
  by_type: [{ label: 'School Visit', events: 6, people_reached: 860 }],
  recent_events: [
    {
      event_id: 'e1',
      title: 'Fire prevention assembly',
      start_datetime: '2026-11-04T15:00:00Z',
      type_label: 'School Visit',
      organization_name: 'Oakville Elementary',
      request_id: 'r1',
      signed_in: 0,
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
  });

  it('reports reach as signed in plus estimated, with the change against last year', async () => {
    renderTab();

    const reached = await screen.findByRole('group', { name: 'People reached' });
    expect(within(reached).getByText('2,140')).toBeInTheDocument();
    expect(within(reached).getByText('412 signed in · 1,728 estimated')).toBeInTheDocument();
    expect(within(reached).getByText('+31%')).toBeInTheDocument();
    expect(screen.getByText(/412 signed in against ~\s*480 expected \(86%\) across 6 events/)).toBeInTheDocument();
    expect(screen.getByText('14 / 18')).toBeInTheDocument();
    expect(getCommunityEngagement).toHaveBeenCalledWith('year');
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
