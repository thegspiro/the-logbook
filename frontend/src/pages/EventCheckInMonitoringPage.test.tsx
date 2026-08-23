import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const mockGetCheckInMonitoring = vi.fn();

vi.mock('../services/api', () => ({
  eventService: {
    getCheckInMonitoring: (...args: unknown[]) => mockGetCheckInMonitoring(...args) as unknown,
  },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ id: 'event-1' }) };
});

import EventCheckInMonitoringPage from './EventCheckInMonitoringPage';

function activity(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    user_name: 'John Doe',
    user_email: 'john@example.org',
    checked_in_at: '2026-06-01T18:18:00Z',
    rsvp_status: 'going',
    guest_count: 0,
    early_check_in_minutes: 42,
    check_in_overridden: false,
    ...overrides,
  };
}

function stats(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-1',
    event_name: 'Monthly Drill',
    event_type: 'training',
    start_datetime: '2026-06-01T19:00:00Z',
    end_datetime: '2026-06-01T21:00:00Z',
    is_check_in_active: true,
    check_in_window_start: '2026-06-01T18:00:00Z',
    check_in_window_end: '2026-06-01T21:00:00Z',
    total_eligible_members: 30,
    total_rsvps: 12,
    total_checked_in: 9,
    check_in_rate: 30,
    recent_check_ins: [activity()],
    early_check_ins: [activity()],
    early_check_in_count: 1,
    early_check_in_threshold_minutes: 10,
    avg_check_in_time_minutes: 20,
    last_check_in_at: '2026-06-01T18:18:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCheckInMonitoring.mockResolvedValue(stats());
});

describe('EventCheckInMonitoringPage early check-ins', () => {
  it('names the member who tapped in before the event started', async () => {
    renderWithRouter(<EventCheckInMonitoringPage />);

    expect(await screen.findByText(/1 member checked in before the event started/i)).toBeInTheDocument();
    expect(screen.getByText(/42 minutes/)).toBeInTheDocument();
  });

  it('says the time was already credited from the start, not that it needs fixing', async () => {
    // The clamp has already done the arithmetic. A panel that told the manager
    // to go and correct something would be sending them after work that is
    // done, and would bury the one case that does need them.
    renderWithRouter(<EventCheckInMonitoringPage />);

    const panel = await screen.findByRole('status');
    expect(panel).toHaveTextContent(/credited from/i);
    expect(panel).toHaveTextContent(/override their check-in time/i);
  });

  it('phrases a long wait in hours rather than making the reader divide', async () => {
    mockGetCheckInMonitoring.mockResolvedValue(
      stats({
        early_check_ins: [activity({ early_check_in_minutes: 95 })],
      })
    );
    renderWithRouter(<EventCheckInMonitoringPage />);

    expect(await screen.findByText(/1 hour 35 minutes/)).toBeInTheDocument();
  });

  it('shows nothing when no one tapped in early', async () => {
    mockGetCheckInMonitoring.mockResolvedValue(
      stats({
        early_check_ins: [],
        early_check_in_count: 0,
        recent_check_ins: [activity({ early_check_in_minutes: null })],
      })
    );
    renderWithRouter(<EventCheckInMonitoringPage />);

    await screen.findByText('Monthly Drill');
    expect(screen.queryByText(/checked in before the event started/i)).not.toBeInTheDocument();
  });

  it('badges an early tap in the recent list', async () => {
    renderWithRouter(<EventCheckInMonitoringPage />);
    expect(await screen.findByText('Early')).toBeInTheDocument();
  });

  it('does not badge a tap a manager has already ruled on', async () => {
    // An override is the organizer having decided about this member; flagging
    // it again would ask them to make the same decision every refresh.
    mockGetCheckInMonitoring.mockResolvedValue(
      stats({
        early_check_ins: [],
        early_check_in_count: 0,
        recent_check_ins: [activity({ check_in_overridden: true })],
      })
    );
    renderWithRouter(<EventCheckInMonitoringPage />);

    await screen.findByText('John Doe');
    expect(screen.queryByText('Early')).not.toBeInTheDocument();
  });

  it('does not badge a tap below the server threshold', async () => {
    mockGetCheckInMonitoring.mockResolvedValue(
      stats({
        early_check_ins: [],
        early_check_in_count: 0,
        recent_check_ins: [activity({ early_check_in_minutes: 3 })],
      })
    );
    renderWithRouter(<EventCheckInMonitoringPage />);

    await screen.findByText('John Doe');
    expect(screen.queryByText('Early')).not.toBeInTheDocument();
  });
});
