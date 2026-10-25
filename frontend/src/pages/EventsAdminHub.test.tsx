/**
 * Events Administration's two-level navigation: the area cards and page
 * strip Training, Inventory and Scheduling Administration draw, driven by the
 * unchanged `?tab=` URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetAdminHubSummary = vi.fn();

vi.mock('../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetAdminHubSummary(...args) as unknown,
  },
}));

vi.mock('./EventCreatePage', () => ({ EventCreatePage: () => <p>create body</p> }));
vi.mock('./PastEventsTab', () => ({ default: () => <p>past events body</p> }));
vi.mock('./EventRequestsTab', () => ({ default: () => <p>requests body</p> }));
vi.mock('./AnalyticsDashboardPage', () => ({ default: () => <p>qr analytics body</p> }));
vi.mock('./CommunityEngagementTab', () => ({ default: () => <p>community body</p> }));
vi.mock('./EventCardCheckinsTab', () => ({ default: () => <p>card check-ins body</p> }));
vi.mock('./EventsSettingsTab', () => ({ default: () => <p>settings body</p> }));

import { EventsAdminHub } from './EventsAdminHub';

const summary = (attention: { href: string; count: number }[]) => ({
  moduleKey: 'events',
  generatedAt: '2026-10-25T12:00:00Z',
  timezone: 'UTC',
  metrics: [],
  attention: attention.map((item, index) => ({
    key: `item-${index}`,
    title: 'Something to do',
    detail: '',
    actionLabel: 'Review',
    severity: 'warning',
    oldestAgeDays: null,
    ...item,
  })),
});

const renderAt = (url: string) => {
  window.history.pushState({}, '', url);
  return renderWithRouter(<EventsAdminHub />);
};

describe('EventsAdminHub', () => {
  beforeEach(() => {
    mockGetAdminHubSummary.mockReset();
    mockGetAdminHubSummary.mockResolvedValue(summary([]));
  });

  it('opens on Create Event under the Events area by default', async () => {
    renderAt('/events/admin');

    expect(screen.getByRole('heading', { level: 1, name: 'Events Administration' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true');
    const strip = screen.getByRole('tablist', { name: 'Events pages' });
    expect(within(strip).getByRole('tab', { name: 'Create Event' })).toHaveAttribute('aria-selected', 'true');
    expect(within(strip).getByRole('tab', { name: 'Past Events' })).toHaveAttribute('aria-selected', 'false');
    expect(await screen.findByText('create body')).toBeInTheDocument();
  });

  it('resolves an existing ?tab= link to its area', async () => {
    renderAt('/events/admin?tab=card_checkins');

    expect(screen.getByRole('tab', { name: 'Check-ins' })).toHaveAttribute('aria-selected', 'true');
    const strip = screen.getByRole('tablist', { name: 'Check-ins pages' });
    expect(within(strip).getByRole('tab', { name: 'Card Check-ins' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('card check-ins body')).toBeInTheDocument();
  });

  it('lands on an area’s first page when its card is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/events/admin?tab=create');

    await user.click(screen.getByRole('tab', { name: 'Community Outreach' }));

    expect(window.location.search).toBe('?tab=requests');
    expect(await screen.findByText('requests body')).toBeInTheDocument();
    const strip = screen.getByRole('tablist', { name: 'Community Outreach pages' });
    await user.click(within(strip).getByRole('tab', { name: 'Community Engagement' }));
    expect(window.location.search).toBe('?tab=community');
    expect(await screen.findByText('community body')).toBeInTheDocument();
  });

  it('keeps a panel in the document for every page tab of the area', () => {
    renderAt('/events/admin?tab=past_events');

    const strip = screen.getByRole('tablist', { name: 'Events pages' });
    const panelIds = screen.getAllByRole('tabpanel', { hidden: true }).map((panel) => panel.id);
    const controlled = within(strip)
      .getAllByRole('tab')
      .map((tab) => tab.getAttribute('aria-controls'));
    expect(controlled).toHaveLength(2);
    for (const id of controlled) expect(panelIds).toContain(id);
  });

  it('badges the page and its area from the attention queue', async () => {
    mockGetAdminHubSummary.mockResolvedValue(
      summary([
        { href: '/events/admin?tab=requests', count: 3 },
        { href: '/events/admin?tab=past_events', count: 2 },
      ])
    );
    renderAt('/events/admin?tab=requests');

    const strip = screen.getByRole('tablist', { name: 'Community Outreach pages' });
    expect(await within(strip).findByText('3')).toBeInTheDocument();
    const eventsCard = screen.getByRole('tab', { name: 'Events' });
    expect(eventsCard).toHaveAccessibleDescription(/2 need attention/);
  });
});
