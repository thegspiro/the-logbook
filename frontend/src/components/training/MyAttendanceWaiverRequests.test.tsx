import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockListMine = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: { listMine: (...args: unknown[]) => mockListMine(...args) as unknown },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import MyAttendanceWaiverRequests from './MyAttendanceWaiverRequests';

const request = (over: Partial<AttendanceWaiverRequest> = {}): AttendanceWaiverRequest => ({
  id: 'req-1',
  workflow: 'training_session',
  user_id: 'user-1',
  member_name: 'Pat Doe',
  event_id: 'evt-1',
  event_title: 'Ladder Drill',
  event_start: '2026-11-20T23:00:00Z',
  session_date: '2026-11-20',
  status: 'approved',
  category: 'Work',
  reason: null,
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: '2026-11-12T15:00:00Z',
  decided_by: 'u2',
  decided_by_name: 'Lt. Smith',
  chief_override: false,
  can_withdraw: false,
  can_decide: false,
  can_override: false,
  actions: [],
  ...over,
});

const wrap = (list: React.ReactNode) => <section aria-label="My Waiver Requests">{list}</section>;

describe('MyAttendanceWaiverRequests', () => {
  beforeEach(() => {
    mockListMine.mockReset();
  });

  it('renders nothing for a member who has made no request', async () => {
    mockListMine.mockResolvedValue([]);
    const { container } = renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    await vi.waitFor(() => expect(mockListMine).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each request with its status, linking to the session', async () => {
    mockListMine.mockResolvedValue([
      request(),
      request({
        id: 'req-2',
        event_id: null,
        event_title: 'Deleted Drill',
        status: 'withdrawn',
        decided_by_name: null,
      }),
    ]);
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    expect(await screen.findByRole('link', { name: 'Ladder Drill' })).toHaveAttribute('href', '/events/evt-1');
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/decided by Lt\. Smith/)).toBeInTheDocument();
    expect(screen.getByText('Deleted Drill')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Deleted Drill' })).not.toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
  });

  it('says when a pending request closes undecided, and lists an expired one by its status', async () => {
    mockListMine.mockResolvedValue([
      request({
        status: 'pending',
        decided_by_name: null,
        expires_at: '2026-11-28T05:00:00Z',
      }),
      request({ id: 'req-2', event_title: 'Pump Drill', status: 'expired', decided_by_name: null, expires_at: null }),
    ]);
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    expect(await screen.findByText(/^Closes undecided on Saturday, November 28, 2026/)).toBeInTheDocument();
    expect(screen.getAllByText(/Closes undecided/)).toHaveLength(1);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});
