/**
 * One failed poll does not replace the live dashboard the door officer is
 * working from; it says the figures are not updating until a poll succeeds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
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
    // Absent by default so every other test in this file exercises the case
    // where no organizer is recorded; the organizer block opts in explicitly.
    created_by_name: null,
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

describe('EventCheckInMonitoringPage when a poll fails', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the dashboard up and says it is not updating', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetCheckInMonitoring.mockReset();
    mockGetCheckInMonitoring.mockResolvedValueOnce(stats()).mockRejectedValue(new Error('Network error'));
    renderWithRouter(<EventCheckInMonitoringPage />);
    expect(await screen.findByText('Monthly Drill', { selector: 'p' })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(await screen.findByText(/Not updating: Network error/)).toBeInTheDocument();
    expect(screen.getByText('Monthly Drill', { selector: 'p' })).toBeInTheDocument();
  });
});
