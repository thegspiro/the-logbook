import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { addCalendarDays, getTodayLocalDate } from '../../../utils/dateFormatting';

const mockStationCheckIn = vi.fn();
const mockIsConnected = vi.fn();
const mockSignalUserActivity = vi.fn();
const mockGetShifts = vi.fn();
const mockGetEvents = vi.fn();
const mockListCategories = vi.fn();

vi.mock('../services/nfcCardService', () => ({
  nfcCardService: {
    stationCheckIn: (...args: unknown[]) => mockStationCheckIn(...args) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  eventService: { getEvents: (...args: unknown[]) => mockGetEvents(...args) as unknown },
}));

vi.mock('../../scheduling/services/api', () => ({
  schedulingService: { getShifts: (...args: unknown[]) => mockGetShifts(...args) as unknown },
}));

vi.mock('../../admin-hours/services/api', () => ({
  adminHoursCategoryService: { list: (...args: unknown[]) => mockListCategories(...args) as unknown },
}));

vi.mock('../../../hooks/useIdleTimer', () => ({
  signalUserActivity: (...args: unknown[]) => mockSignalUserActivity(...args) as unknown,
}));

vi.mock('../../../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set<string>(),
    loading: false,
    isConnected: (type: string) => mockIsConnected(type) as boolean,
  }),
}));

import CheckInStationPage from './CheckInStationPage';

/**
 * Fixture times are relative to now, never literal.
 *
 * The station filters out shifts that have already ended, so an absolute
 * `end_time` turns the whole suite red the moment real time passes it — which
 * is exactly what happened to an earlier version of this file overnight.
 */
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

/** Types a serial the way a USB keyboard-wedge reader does: a burst, then Enter. */
async function tapWedgeCard(serial: string) {
  for (const char of serial) {
    fireEvent.keyDown(window, { key: char });
  }
  fireEvent.keyDown(window, { key: 'Enter' });
  await waitFor(() => expect(mockStationCheckIn).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConnected.mockReturnValue(true);
  mockGetShifts.mockResolvedValue({
    shifts: [
      {
        id: 'shift-1',
        apparatus_unit_number: 'E4',
        apparatus_name: 'Engine 4',
        start_time: hoursFromNow(-6),
        end_time: hoursFromNow(6),
        is_finalized: false,
      },
    ],
    total: 1,
    skip: 0,
    limit: 50,
  });
  mockGetEvents.mockResolvedValue([]);
  mockListCategories.mockResolvedValue([]);
  mockStationCheckIn.mockResolvedValue({
    status: 'checked_in',
    message: 'Checked in to E4.',
    memberName: 'Dana Ruiz',
    membershipNumber: '1042',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CheckInStationPage', () => {
  it("offers today's unfinalized shifts to check into", async () => {
    renderWithRouter(<CheckInStationPage />);
    expect(await screen.findByRole('option', { name: /E4/ })).toBeInTheDocument();
  });

  it('will not arm a reader before a target is chosen', async () => {
    mockGetShifts.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 50 });
    renderWithRouter(<CheckInStationPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /start the reader/i })).toBeDisabled());
  });

  it('checks a member in from a USB reader and names them on screen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });

    await user.click(screen.getByRole('button', { name: /start the reader/i }));
    await tapWedgeCard('04A2245B7C1180');

    expect(mockStationCheckIn).toHaveBeenCalledWith({
      tag_uid: '04A2245B7C1180',
      tag_payload: undefined,
      target_type: 'shift',
      target_id: 'shift-1',
      direction: 'auto',
    });
    // Named in the big result card and again in the session list below it.
    expect(await screen.findAllByText('Dana Ruiz')).not.toHaveLength(0);
  });

  it('ignores keystrokes until the reader is armed', async () => {
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });

    for (const char of '04A2245B7C1180') fireEvent.keyDown(window, { key: char });
    fireEvent.keyDown(window, { key: 'Enter' });

    // A stopped station must record nothing — an operator who stopped the
    // reader to change the shift has to be able to trust that it stopped.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockStationCheckIn).not.toHaveBeenCalled();
  });

  it('drops a card held a beat too long instead of sending it twice', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));

    await tapWedgeCard('04A2245B7C1180');
    expect(mockStationCheckIn).toHaveBeenCalledTimes(1);

    await tapWedgeCard('04A2245B7C1180');
    expect(mockStationCheckIn).toHaveBeenCalledTimes(1);
  });

  it('still reads a different card immediately after one', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));

    await tapWedgeCard('04A2245B7C1180');
    await tapWedgeCard('04B3356C8D2290');

    // The duplicate guard is per card, not a page-wide cooldown — a queue at
    // the door taps far faster than any per-tap delay would allow.
    expect(mockStationCheckIn).toHaveBeenCalledTimes(2);
  });

  it('stops the reader when the target changes', async () => {
    const user = userEvent.setup();
    mockGetShifts.mockResolvedValue({
      shifts: [
        { id: 'shift-1', apparatus_unit_number: 'E4', start_time: hoursFromNow(-6), is_finalized: false },
        { id: 'shift-2', apparatus_unit_number: 'L1', start_time: hoursFromNow(-6), is_finalized: false },
      ],
      total: 2,
      skip: 0,
      limit: 50,
    });
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));
    expect(screen.getByRole('button', { name: /stop the reader/i })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/today's shifts/i), 'shift-2');

    // Otherwise taps keep landing on the shift the operator just moved off,
    // and nothing on screen says so.
    expect(await screen.findByRole('button', { name: /start the reader/i })).toBeInTheDocument();
  });

  it('renders an unregistered card as a result rather than a crash', async () => {
    const user = userEvent.setup();
    mockStationCheckIn.mockResolvedValue({
      status: 'unknown_card',
      message: 'This card is not registered. Ask an officer to add it to your member record.',
    });
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));

    await tapWedgeCard('04A2245B7C1180');
    expect(await screen.findAllByText(/not registered/i)).not.toHaveLength(0);
  });

  it('sends the chosen direction with each tap', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });

    await user.click(screen.getByRole('button', { name: /checks out/i }));
    await user.click(screen.getByRole('button', { name: /start the reader/i }));
    await tapWedgeCard('04A2245B7C1180');

    expect(mockStationCheckIn).toHaveBeenCalledWith(expect.objectContaining({ direction: 'out' }));
  });

  it('says so rather than looking broken when cards are turned off', async () => {
    // The endpoint refuses while the integration is off, so an armed-looking
    // reader would fail on every tap with nothing to explain why.
    mockIsConnected.mockReturnValue(false);
    renderWithRouter(<CheckInStationPage />);

    expect(await screen.findByText(/turned off/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start the reader/i })).not.toBeInTheDocument();
    expect(mockGetShifts).not.toHaveBeenCalled();
  });

  it('counts a tap as user activity so the session does not time out', async () => {
    // Web NFC fires no mouse, key, scroll or touch event, so a station in
    // constant use looked idle to the HIPAA session timer and logged itself
    // out mid-drill.
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));

    await tapWedgeCard('04A2245B7C1180');

    expect(mockSignalUserActivity).toHaveBeenCalled();
  });

  it('keeps the session alive even when the card is refused', async () => {
    // Somebody is standing at the device either way.
    const user = userEvent.setup();
    mockStationCheckIn.mockResolvedValue({ status: 'unknown_card', message: 'Not registered.' });
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));

    await tapWedgeCard('04A2245B7C1180');

    expect(mockSignalUserActivity).toHaveBeenCalled();
  });

  it('stops the reader when the shift it was armed against ends', async () => {
    // A station is armed once and left for hours. Taps kept landing on
    // yesterday's shift, and the only sign was attendance appearing somewhere
    // nobody looked.
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));
    expect(screen.getByRole('button', { name: /stop the reader/i })).toBeInTheDocument();

    mockGetShifts.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 50 });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByText(/has ended, so the reader stopped/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start the reader/i })).toBeInTheDocument();
  });

  it('keeps the operator on their chosen target across a refresh', async () => {
    // Silently moving an armed station onto a different shift would be worse
    // than the staleness this fixes.
    const user = userEvent.setup();
    mockGetShifts.mockResolvedValue({
      shifts: [
        { id: 'shift-1', apparatus_unit_number: 'E4', start_time: hoursFromNow(-6), is_finalized: false },
        { id: 'shift-2', apparatus_unit_number: 'L1', start_time: hoursFromNow(-6), is_finalized: false },
      ],
      total: 2,
      skip: 0,
      limit: 50,
    });
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.selectOptions(screen.getByLabelText(/today's shifts/i), 'shift-2');
    await user.click(screen.getByRole('button', { name: /start the reader/i }));

    document.dispatchEvent(new Event('visibilitychange'));
    await tapWedgeCard('04A2245B7C1180');

    expect(mockStationCheckIn).toHaveBeenCalledWith(expect.objectContaining({ target_id: 'shift-2' }));
    expect(screen.getByRole('button', { name: /stop the reader/i })).toBeInTheDocument();
  });

  it('leaves a running station alone when the refresh itself fails', async () => {
    // A dropped request is not evidence the shift ended; disarming on a blip
    // of station Wi-Fi would take a working station down.
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });
    await user.click(screen.getByRole('button', { name: /start the reader/i }));

    mockGetShifts.mockRejectedValue(new Error('network'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByRole('button', { name: /stop the reader/i })).toBeInTheDocument();
  });

  it('still offers an overnight shift that started yesterday', async () => {
    // A shift is filed under the date it started. A 24-hour tour that began at
    // 06:00 yesterday is the shift running at 02:00 now, and asking only for
    // today's date made the crew on duty vanish from the station at midnight.
    const stillRunning = hoursFromNow(4);
    mockGetShifts.mockResolvedValue({
      shifts: [
        {
          id: 'shift-overnight',
          apparatus_unit_number: 'E4',
          start_time: hoursFromNow(-20),
          end_time: stillRunning,
          is_finalized: false,
        },
      ],
      total: 1,
      skip: 0,
      limit: 50,
    });
    renderWithRouter(<CheckInStationPage />);

    expect(await screen.findByRole('option', { name: /E4/ })).toBeInTheDocument();
    // Computed, not hardcoded: literal dates here would pass today and fail
    // every day after.
    const today = getTodayLocalDate();
    expect(mockGetShifts).toHaveBeenCalledWith(
      expect.objectContaining({ start_date: addCalendarDays(today, -1), end_date: today })
    );
  });

  it('drops a yesterday-dated shift that has already ended', async () => {
    // Otherwise widening the query to yesterday would offer every finished
    // tour from the previous day.
    mockGetShifts.mockResolvedValue({
      shifts: [
        {
          id: 'shift-finished',
          apparatus_unit_number: 'L1',
          start_time: hoursFromNow(-20),
          end_time: hoursFromNow(-8),
          is_finalized: false,
        },
      ],
      total: 1,
      skip: 0,
      limit: 50,
    });
    renderWithRouter(<CheckInStationPage />);

    await waitFor(() => expect(mockGetShifts).toHaveBeenCalled());
    expect(screen.queryByRole('option', { name: /L1/ })).not.toBeInTheDocument();
  });

  it('asks the events API to exclude anything already finished', async () => {
    // Filtering on start time alone left this morning's drill in the list, and
    // since the list is ordered by start time it could be the default — so an
    // operator could arm against an event whose window shut hours ago.
    const user = userEvent.setup();
    renderWithRouter(<CheckInStationPage />);
    await screen.findByRole('option', { name: /E4/ });

    await user.click(screen.getByRole('button', { name: /event or meeting/i }));

    await waitFor(() => expect(mockGetEvents).toHaveBeenCalled());
    const eventParams = mockGetEvents.mock.calls[0]?.[0] as { end_after?: string } | undefined;
    expect(typeof eventParams?.end_after).toBe('string');
  });
});
