/**
 * The attendance dashboard endpoint had a client method and no screen. The
 * page shows the server's figures as they come and refetches on a filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AttendanceDashboard } from '../../../services/meetingsServices';

const mockGetDashboard = vi.fn();

vi.mock('../../../services/meetingsServices', () => ({
  meetingsService: {
    getAttendanceDashboard: (...a: unknown[]) => mockGetDashboard(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import AttendanceDashboardPage from './AttendanceDashboardPage';
import { renderWithRouter } from '../../../test/utils';

const dashboard: AttendanceDashboard = {
  generated_at: '2026-10-11T12:00:00Z',
  period_months: 12,
  meeting_type_filter: null,
  total_meetings_in_period: 10,
  members: [
    {
      user_id: 'u1',
      name: 'Alice Adams',
      membership_tier: 'active',
      tier_name: 'Active',
      hire_date: null,
      attendance_pct: 87.5,
      meetings_attended: 7,
      meetings_waived: 1,
      meetings_on_leave: 1,
      meetings_absent: 1,
      total_meetings: 10,
      eligible_meetings: 8,
      voting_eligible: true,
      voting_blocked_reason: null,
    },
    {
      user_id: 'u2',
      name: 'Bob Brown',
      membership_tier: 'active',
      tier_name: 'Active',
      hire_date: null,
      attendance_pct: 20,
      meetings_attended: 2,
      meetings_waived: 0,
      meetings_on_leave: 0,
      meetings_absent: 8,
      total_meetings: 10,
      eligible_meetings: 10,
      voting_eligible: false,
      voting_blocked_reason: 'Attendance 20% below minimum 50%',
    },
  ],
  summary: {
    total_members: 2,
    avg_attendance_pct: 53.8,
    voting_eligible_count: 1,
    voting_blocked_by_attendance: 1,
  },
};

describe('AttendanceDashboardPage', () => {
  beforeEach(() => {
    mockGetDashboard.mockReset();
    mockGetDashboard.mockResolvedValue(dashboard);
  });

  it("shows each member's figures and the summary exactly as served", async () => {
    renderWithRouter(<AttendanceDashboardPage />);

    const row = within(await screen.findByRole('row', { name: /Alice Adams/ }));
    expect(row.getByText('87.5%')).toBeInTheDocument();
    expect(row.getByText('7 of 8')).toBeInTheDocument();
    expect(row.getByText('Eligible')).toBeInTheDocument();

    expect(screen.getByText('Attendance 20% below minimum 50%')).toBeInTheDocument();
    expect(screen.getByText('53.8%')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(mockGetDashboard).toHaveBeenCalledWith({ period_months: 12 });
  });

  it('asks the server again when the period or meeting type changes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AttendanceDashboardPage />);
    await screen.findByText('Alice Adams');

    await user.selectOptions(screen.getByLabelText('Period'), '6');
    await user.selectOptions(screen.getByLabelText('Meeting type'), 'business');

    expect(mockGetDashboard).toHaveBeenLastCalledWith({ period_months: 6, meeting_type: 'business' });
  });

  it('says so when a member has no meeting to count', async () => {
    const [first] = dashboard.members;
    mockGetDashboard.mockResolvedValue({
      ...dashboard,
      members: [{ ...first, eligible_meetings: 0, meetings_attended: 0, attendance_pct: 100 }],
    });
    renderWithRouter(<AttendanceDashboardPage />);

    expect(await screen.findByText('Not applicable')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    mockGetDashboard.mockRejectedValue(new Error('Request failed'));
    renderWithRouter(<AttendanceDashboardPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
