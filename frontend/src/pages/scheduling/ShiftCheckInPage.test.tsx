import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { ConfirmProvider } from '../../contexts/ConfirmContext';

const mockGetShift = vi.fn();
const mockGetMyAttendance = vi.fn();
const mockCheckOut = vi.fn();
const mockGetActiveShiftForApparatus = vi.fn();
const mockGetActivePreShiftWork = vi.fn();
const mockGetPreShiftEligibleShifts = vi.fn();
const mockStartPreShiftWork = vi.fn();
const mockEndPreShiftWork = vi.fn();
vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShift: (...a: unknown[]) => mockGetShift(...a) as unknown,
    getMyAttendance: (...a: unknown[]) => mockGetMyAttendance(...a) as unknown,
    checkOut: (...a: unknown[]) => mockCheckOut(...a) as unknown,
    checkIn: vi.fn(),
    getActiveShiftForApparatus: (...a: unknown[]) => mockGetActiveShiftForApparatus(...a) as unknown,
    getActivePreShiftWork: (...a: unknown[]) => mockGetActivePreShiftWork(...a) as unknown,
    getPreShiftEligibleShifts: (...a: unknown[]) => mockGetPreShiftEligibleShifts(...a) as unknown,
    startPreShiftWork: (...a: unknown[]) => mockStartPreShiftWork(...a) as unknown,
    endPreShiftWork: (...a: unknown[]) => mockEndPreShiftWork(...a) as unknown,
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

const renderPage = (url = '/scheduling/checkin?shift=shift-1') =>
  render(
    <MemoryRouter initialEntries={[url]}>
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
  // No pre-shift work unless a block says otherwise.
  mockGetActiveShiftForApparatus.mockReset();
  mockGetActivePreShiftWork.mockReset();
  mockGetActivePreShiftWork.mockResolvedValue(null);
  mockGetPreShiftEligibleShifts.mockReset();
  mockGetPreShiftEligibleShifts.mockResolvedValue({ enabled: true, shifts: [] });
  mockStartPreShiftWork.mockReset();
  mockEndPreShiftWork.mockReset();
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

const tomorrowEarly = {
  id: 'shift-4am',
  shift_date: '2026-10-12',
  start_time: new Date(Date.now() + 13 * HOUR).toISOString(),
  end_time: new Date(Date.now() + 25 * HOUR).toISOString(),
  apparatus_id: 'truck-1',
  apparatus_unit_number: 'E-1',
  apparatus_name: null,
  position: 'firefighter',
  on_scanned_apparatus: true,
};

const notYetOpen = {
  ...tomorrowEarly,
  id: 'shift-4am',
  attendee_count: 0,
  is_finalized: false,
  checkin_open: false,
  checkin_closed_reason: 'This shift has not started yet. Check-in opens 2 hours before the shift starts.',
};

const runningSession = {
  id: 'pw-1',
  shift_id: 'shift-4am',
  user_id: 'u-1',
  started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  status: 'active',
  shift_date: '2026-10-12',
  shift_start_time: tomorrowEarly.start_time,
  shift_apparatus_name: 'E-1',
  shift_is_finalized: false,
};

describe('ShiftCheckInPage pre-shift work', () => {
  beforeEach(() => {
    mockGetActiveShiftForApparatus.mockResolvedValue({ id: 'shift-4am' });
    mockGetShift.mockResolvedValue(notYetOpen);
    mockGetMyAttendance.mockResolvedValue(null);
    mockGetPreShiftEligibleShifts.mockResolvedValue({ enabled: true, shifts: [tomorrowEarly] });
  });

  it('offers pre-shift work when check-in is not open yet, and starts it for the chosen shift', async () => {
    mockStartPreShiftWork.mockResolvedValue(runningSession);
    const user = userEvent.setup();
    renderPage('/scheduling/checkin?apparatus=truck-1');

    expect(await screen.findByRole('button', { name: 'Check In' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Doing pre-shift work?' }));
    expect(screen.getByRole('radio')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Start pre-shift work' }));

    expect(mockGetPreShiftEligibleShifts).toHaveBeenCalledWith('truck-1');
    expect(mockStartPreShiftWork).toHaveBeenCalledWith('shift-4am', 'truck-1');
    expect(await screen.findByRole('button', { name: 'End pre-shift work' })).toBeInTheDocument();
  });

  it('shows a running session first, and ending it is the scan-out', async () => {
    // Once: after ending, the page re-reads and the server reports none running.
    mockGetActivePreShiftWork.mockResolvedValueOnce(runningSession);
    mockEndPreShiftWork.mockResolvedValue({ ...runningSession, status: 'pending', duration_minutes: 30 });
    const user = userEvent.setup();
    renderPage('/scheduling/checkin?apparatus=truck-1');

    expect(await screen.findByText('Pre-shift work in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check In' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/what did you do/i), 'SCBA check');
    await user.click(screen.getByRole('button', { name: 'End pre-shift work' }));

    expect(mockEndPreShiftWork).toHaveBeenCalledWith('pw-1', 'SCBA check');
    expect(await screen.findByRole('button', { name: 'Check In' })).toBeInTheDocument();
  });

  it('does not offer pre-shift work once check-in is open', async () => {
    mockGetShift.mockResolvedValue({ ...notYetOpen, checkin_open: true, checkin_closed_reason: null });
    renderPage('/scheduling/checkin?apparatus=truck-1');

    expect(await screen.findByRole('button', { name: 'Check In' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Doing pre-shift work?' })).not.toBeInTheDocument();
  });

  it('does not offer pre-shift work when the department has turned it off', async () => {
    mockGetPreShiftEligibleShifts.mockResolvedValue({ enabled: false, shifts: [] });
    renderPage('/scheduling/checkin?apparatus=truck-1');

    expect(await screen.findByRole('button', { name: 'Check In' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Doing pre-shift work?' })).not.toBeInTheDocument();
  });

  it('still offers it when the vehicle has no shift resolved at all', async () => {
    mockGetActiveShiftForApparatus.mockRejectedValue(new Error('404'));
    renderPage('/scheduling/checkin?apparatus=truck-1');

    expect(await screen.findByText('No Active Shift')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Doing pre-shift work?' })).toBeInTheDocument();
  });
});
