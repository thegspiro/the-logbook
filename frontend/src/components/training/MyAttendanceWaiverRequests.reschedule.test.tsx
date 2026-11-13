import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';

const mockListMine = vi.fn();
const mockConfirm = vi.fn();
const mockWithdraw = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    listMine: (...args: unknown[]) => mockListMine(...args) as unknown,
    confirm: (...args: unknown[]) => mockConfirm(...args) as unknown,
    withdraw: (...args: unknown[]) => mockWithdraw(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MyAttendanceWaiverRequests from './MyAttendanceWaiverRequests';

/** A request whose session moved from 20 to 27 November and waits on the member. */
const moved = (over: Partial<AttendanceWaiverRequest> = {}): AttendanceWaiverRequest => ({
  id: 'req-1',
  workflow: 'training_session',
  user_id: 'user-1',
  member_name: 'Pat Doe',
  event_id: 'evt-1',
  event_title: 'Ladder Drill',
  event_start: '2026-11-27T23:00:00Z',
  session_date: '2026-11-27',
  status: 'pending',
  category: null,
  reason: null,
  submitted_at: '2026-11-11T15:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_name: null,
  chief_override: false,
  info_requested_at: null,
  reconfirm_requested_at: '2026-11-13T12:00:00Z',
  can_withdraw: true,
  can_respond: false,
  can_confirm: true,
  can_request_info: false,
  can_decide: false,
  can_override: false,
  actions: [],
  ...over,
});

const wrap = (list: React.ReactNode) => <section aria-label="My Waiver Requests">{list}</section>;

describe('MyAttendanceWaiverRequests — a moved session', () => {
  beforeEach(() => {
    mockListMine.mockReset();
    mockConfirm.mockReset();
    mockWithdraw.mockReset();
    mockListMine.mockResolvedValue([moved()]);
  });

  it('asks whether the new date still needs a waiver', async () => {
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    expect(await screen.findByText(/This session moved to .*November 27, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Do you still need to be excused\?/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('confirms, and the prompt goes once the server says so', async () => {
    mockConfirm.mockResolvedValue(moved({ reconfirm_requested_at: null, can_confirm: false }));
    const user = userEvent.setup();
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(mockConfirm).toHaveBeenCalledWith('req-1');
    await vi.waitFor(() => expect(screen.queryByText(/This session moved/)).not.toBeInTheDocument());
  });

  it('withdraws after the member confirms the dialog', async () => {
    mockWithdraw.mockResolvedValue(
      moved({ status: 'withdrawn', reconfirm_requested_at: null, can_confirm: false, can_withdraw: false })
    );
    const user = userEvent.setup();
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog', { name: 'Withdraw your request?' });
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw request' }));
    expect(mockWithdraw).toHaveBeenCalledWith('req-1');
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
  });

  it('shows no prompt on a request that is not waiting', async () => {
    mockListMine.mockResolvedValue([moved({ reconfirm_requested_at: null, can_confirm: false })]);
    renderWithRouter(<MyAttendanceWaiverRequests wrap={wrap} />);
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });
});
