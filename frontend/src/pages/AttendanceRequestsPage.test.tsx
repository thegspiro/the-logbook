import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { AttendanceRequestsPage } from './AttendanceRequestsPage';
import type { PendingAttendancePetition } from '../types/event';

const mockGetPending = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();
vi.mock('../services/api', () => ({
  eventService: {
    getPendingAttendancePetitions: (...args: unknown[]) => mockGetPending(...args) as unknown,
    approveAttendancePetition: (...args: unknown[]) => mockApprove(...args) as unknown,
    rejectAttendancePetition: (...args: unknown[]) => mockReject(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockCheckPermission = vi.fn();
const mockAuthState = { checkPermission: mockCheckPermission };
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState as unknown as Record<string, unknown>) : mockAuthState
  ),
}));

const pending = (over: Partial<PendingAttendancePetition> = {}): PendingAttendancePetition => ({
  id: 'pet-1',
  event_id: 'evt-1',
  user_id: 'user-1',
  user_name: 'Sam Member',
  status: 'pending',
  reason: 'Phone died at the door',
  created_at: '2026-09-29T20:00:00Z',
  event_title: 'Ladder Drill',
  event_start_datetime: '2026-09-29T18:00:00Z',
  event_end_datetime: '2026-09-29T20:00:00Z',
  attendance_finalized: false,
  ...over,
});

describe('AttendanceRequestsPage', () => {
  beforeEach(() => {
    mockGetPending.mockReset();
    mockApprove.mockReset();
    mockReject.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockGetPending.mockResolvedValue([pending()]);
  });

  it('lists requests on the viewer’s own events, linked to each event', async () => {
    renderWithRouter(<AttendanceRequestsPage />);

    expect(await screen.findByText('Phone died at the door')).toBeInTheDocument();
    expect(mockGetPending).toHaveBeenCalledWith('mine');
    expect(screen.getByRole('link', { name: 'Ladder Drill' })).toHaveAttribute('href', '/events/evt-1');
    // Only an events manager is offered the department-wide list.
    expect(screen.queryByRole('button', { name: 'All events' })).not.toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    mockGetPending.mockResolvedValue([]);
    renderWithRouter(<AttendanceRequestsPage />);

    expect(await screen.findByText('No attendance requests waiting')).toBeInTheDocument();
  });

  it('lets an events manager widen it to every event', async () => {
    mockCheckPermission.mockReturnValue(true);
    const user = userEvent.setup();
    renderWithRouter(<AttendanceRequestsPage />);

    await user.click(await screen.findByRole('button', { name: 'All events' }));

    expect(mockGetPending).toHaveBeenLastCalledWith('all');
    expect(screen.getByRole('button', { name: 'All events' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('approves from the list with the event’s times and drops the row', async () => {
    mockApprove.mockResolvedValue(pending({ status: 'approved' }));
    const user = userEvent.setup();
    renderWithRouter(<AttendanceRequestsPage />);

    await user.click(await screen.findByRole('button', { name: "Approve Sam Member's request for Ladder Drill" }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    expect(mockApprove).toHaveBeenCalledWith('evt-1', 'pet-1', {
      check_in_at: '2026-09-29T18:00:00.000Z',
      check_out_at: '2026-09-29T20:00:00.000Z',
      review_note: undefined,
    });
    expect(await screen.findByText('No attendance requests waiting')).toBeInTheDocument();
  });

  it('declines from the list with the reason typed', async () => {
    mockReject.mockResolvedValue(pending({ status: 'rejected' }));
    const user = userEvent.setup();
    renderWithRouter(<AttendanceRequestsPage />);

    await user.click(await screen.findByRole('button', { name: "Decline Sam Member's request for Ladder Drill" }));
    await user.type(screen.getByLabelText('Reason'), 'Not on the sign-in sheet');
    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    expect(mockReject).toHaveBeenCalledWith('evt-1', 'pet-1', 'Not on the sign-in sheet');
    expect(await screen.findByText('No attendance requests waiting')).toBeInTheDocument();
  });

  it('cannot approve on a finalized event, but can still decline', async () => {
    mockGetPending.mockResolvedValue([pending({ attendance_finalized: true })]);
    renderWithRouter(<AttendanceRequestsPage />);

    expect(await screen.findByText(/Attendance for this event is finalized/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Approve Sam Member's request for Ladder Drill" })).toBeDisabled();
    expect(screen.getByRole('button', { name: "Decline Sam Member's request for Ladder Drill" })).toBeEnabled();
  });

  it('offers a retry when the list fails to load', async () => {
    mockGetPending.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'Server down' } } });
    const user = userEvent.setup();
    renderWithRouter(<AttendanceRequestsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server down');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Phone died at the door')).toBeInTheDocument();
  });
});
