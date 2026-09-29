import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { ConfirmProvider } from '../../contexts/ConfirmContext';

const mockGetShift = vi.fn();
const mockGetMyAttendance = vi.fn();
const mockCheckOut = vi.fn();
vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShift: (...a: unknown[]) => mockGetShift(...a) as unknown,
    getMyAttendance: (...a: unknown[]) => mockGetMyAttendance(...a) as unknown,
    checkOut: (...a: unknown[]) => mockCheckOut(...a) as unknown,
    checkIn: vi.fn(),
    getActiveShiftForApparatus: vi.fn(),
  },
}));

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: { getShiftChecklists: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/Chicago',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import ShiftCheckInPage from './ShiftCheckInPage';

const HOUR = 60 * 60 * 1000;

const shiftEnding = (endsInMs: number) => ({
  id: 'shift-1',
  shift_date: '2026-09-29',
  start_time: new Date(Date.now() - HOUR).toISOString(),
  end_time: new Date(Date.now() + endsInMs).toISOString(),
  apparatus_unit_number: 'E-1',
  attendee_count: 1,
  is_finalized: false,
  checkin_open: true,
});

const checkedIn = { checked_in_at: new Date(Date.now() - 60 * 1000).toISOString() };

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/scheduling/checkin?shift=shift-1']}>
      <ConfirmProvider>
        <ShiftCheckInPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  mockGetShift.mockReset();
  mockGetShift.mockResolvedValue(shiftEnding(11 * HOUR));
  mockGetMyAttendance.mockReset();
  mockGetMyAttendance.mockResolvedValue(checkedIn);
  mockCheckOut.mockReset();
  mockCheckOut.mockResolvedValue({
    ...checkedIn,
    checked_out_at: new Date().toISOString(),
    duration_minutes: 0,
  });
});

describe('ShiftCheckInPage check-out', () => {
  it('asks before checking out ahead of the scheduled end, and stays checked in on a no', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Check Out' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('you cannot check back in to this shift');
    await user.click(within(dialog).getByRole('button', { name: 'Stay checked in' }));

    expect(mockCheckOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check Out' })).toBeInTheDocument();
  });

  it('checks out once confirmed, and shows a zero-hour result as 0 hours', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Check Out' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Check out now' }));

    expect(mockCheckOut).toHaveBeenCalledWith('shift-1');
    expect(await screen.findByText('0 hours')).toBeInTheDocument();
  });

  it('checks out without asking once the shift is over', async () => {
    mockGetShift.mockResolvedValue(shiftEnding(-5 * 60 * 1000));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Check Out' }));

    expect(mockCheckOut).toHaveBeenCalledWith('shift-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
