import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Calendar } from 'lucide-react';

const mockCheckPermission = vi.fn<(permission: string) => boolean>();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ checkPermission: (permission: string) => mockCheckPermission(permission) }),
}));

import { EventsPageHeader } from './EventsPageHeader';

const renderAt = (path: string, ui: React.ReactElement) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

const strip = () => screen.getByRole('navigation', { name: 'Events sections' });
const stripLinks = () =>
  within(strip())
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('EventsPageHeader', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
  });

  it('offers every member the events list and their attendance requests', () => {
    renderAt('/events', <EventsPageHeader icon={Calendar} title="Events" />);

    expect(stripLinks()).toEqual(['Events', 'Attendance Requests']);
    expect(within(strip()).getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  });

  it('adds Templates for events.manage, Attendance Trends for analytics.view and CRR Activities for crr.record or events.manage, each on its own grant', () => {
    mockCheckPermission.mockImplementation((permission) => permission === 'analytics.view');
    const { unmount } = renderAt('/events', <EventsPageHeader icon={Calendar} title="Events" />);
    expect(stripLinks()).toEqual(['Events', 'Attendance Requests', 'Attendance Trends']);
    unmount();

    mockCheckPermission.mockImplementation((permission) => permission === 'events.manage');
    const { unmount: unmountManager } = renderAt('/events', <EventsPageHeader icon={Calendar} title="Events" />);
    expect(stripLinks()).toEqual(['Events', 'Attendance Requests', 'Event Templates', 'CRR Activities']);
    unmountManager();

    // The Community Outreach Team records CRR activities without managing events.
    mockCheckPermission.mockImplementation((permission) => permission === 'crr.record');
    renderAt('/events', <EventsPageHeader icon={Calendar} title="Events" />);
    expect(stripLinks()).toEqual(['Events', 'Attendance Requests', 'CRR Activities']);
  });

  it('traces an event’s own pages back through Events, not Attendance Trends', () => {
    // /events/:id/analytics shares a last segment with /events/analytics; the
    // strip must still mark Events, the prefix it actually sits under.
    mockCheckPermission.mockReturnValue(true);
    renderAt(
      '/events/e-1/analytics',
      <EventsPageHeader
        icon={Calendar}
        title="QR Code Analytics"
        parentCrumbs={[{ label: 'Spring Drill', path: '/events/e-1' }]}
      />
    );

    expect(within(strip()).getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
    const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(trail).getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events');
    expect(within(trail).getByRole('link', { name: 'Spring Drill' })).toHaveAttribute('href', '/events/e-1');
    expect(trail).toHaveTextContent('QR Code Analytics');
  });
});
