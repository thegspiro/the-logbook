const mockGetMonth = vi.fn();
const mockGetWeek = vi.fn();
const mockSignup = vi.fn();
const mockEligible = vi.fn();
const mockMyOffers = vi.fn();
const mockRespond = vi.fn();
const mockCancelSwap = vi.fn();

vi.mock('../../../modules/scheduling', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../modules/scheduling');
  return {
    ...actual,
    schedulingService: {
      getMonthCalendar: (...args: unknown[]) => mockGetMonth(...args) as unknown,
      getWeekCalendar: (...args: unknown[]) => mockGetWeek(...args) as unknown,
      signupForShift: (...args: unknown[]) => mockSignup(...args) as unknown,
      getEligiblePositionsBulk: (...args: unknown[]) => mockEligible(...args) as unknown,
      getMySwapRequests: (...args: unknown[]) => mockMyOffers(...args) as unknown,
      respondToSwapOffer: (...args: unknown[]) => mockRespond(...args) as unknown,
      cancelSwapRequest: (...args: unknown[]) => mockCancelSwap(...args) as unknown,
      getCalendarFeed: () => Promise.resolve({ token: 't', feed_path: '/feed' }),
    },
  };
});

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      user: { id: 'me-1', full_name: 'Sam Poe', timezone: 'America/New_York' },
    };
    return selector ? selector(state) : state;
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShiftRecord } from '../../../modules/scheduling';
import ShiftBoard from './ShiftBoard';

const ME = 'me-1';

// The board reads "today" from the clock, so the fixture month is pinned to a
// fake one — otherwise every past-day assertion would rot within the month.
const NOW = new Date(2026, 7, 20, 9, 0, 0);

const shift = (overrides: Partial<ShiftRecord>): ShiftRecord => ({
  id: 's1',
  organization_id: 'org',
  shift_date: '2026-08-25',
  start_time: '2026-08-25T10:00:00Z',
  end_time: '2026-08-25T22:00:00Z',
  positions: [
    { position: 'officer', required: true },
    { position: 'driver', required: true },
    { position: 'firefighter', required: true },
    { position: 'firefighter', required: true },
  ],
  attendee_count: 0,
  call_count: 0,
  is_finalized: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  roster: [],
  ...overrides,
});

const SHORT_DAY = shift({ id: 'day-25', shift_date: '2026-08-25', attendee_count: 2 });
const MINE = shift({
  id: 'mine-26',
  shift_date: '2026-08-26',
  attendee_count: 4,
  roster: [
    { assignment_id: 'a1', user_id: ME, user_name: 'Sam Poe', position: 'driver', status: 'assigned' },
    { assignment_id: 'a2', user_id: 'u2', user_name: 'Dana Ruiz', position: 'officer', status: 'assigned' },
    { assignment_id: 'a3', user_id: 'u3', user_name: 'A B', position: 'firefighter', status: 'assigned' },
    { assignment_id: 'a4', user_id: 'u4', user_name: 'C D', position: 'firefighter', status: 'assigned' },
  ],
});

/** The desktop grid. The phone grid is in the document too — only CSS hides
 *  it — so every cell query has to say which calendar it means. */
const grid = () => within(screen.getByRole('grid', { name: 'Month calendar' }));

const renderBoard = () =>
  render(
    <ShiftBoard view="month" visibleDate={new Date(2026, 7, 15)} onVisibleDateChange={vi.fn()} onViewChange={vi.fn()} />
  );

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date is faked: timers and microtasks must keep running normally or
  // userEvent's click sequence never settles.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockGetMonth.mockResolvedValue([SHORT_DAY, MINE]);
  mockGetWeek.mockResolvedValue([]);
  mockSignup.mockResolvedValue({ id: 'a9' });
  mockEligible.mockResolvedValue({ 'day-25': ['firefighter', 'driver'], 'mine-26': ['firefighter'] });
  mockMyOffers.mockResolvedValue([]);
  mockRespond.mockResolvedValue({ id: 'sw1' });
  mockCancelSwap.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ShiftBoard', () => {
  it('loads the visible month once, roster included', async () => {
    renderBoard();
    await waitFor(() => expect(mockGetMonth).toHaveBeenCalledWith(2026, 8));
    expect(mockGetMonth).toHaveBeenCalledTimes(1);
  });

  it('counts the month’s open seats where the eye lands first', async () => {
    renderBoard();
    // Two open on the 25th, none on the shift the member already holds.
    expect(await screen.findByTestId('month-open-seats')).toHaveTextContent('2 open seats this month');
  });

  it('colours a cell "yours" ahead of its staffing', async () => {
    renderBoard();
    await screen.findByText(/open seats this month/i);
    expect(grid().getAllByText(/You \+ 3\/4/).length).toBeGreaterThan(0);
  });

  it('shows the selected day’s crew without another request', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    mockGetMonth.mockClear();

    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    expect((await screen.findAllByText('2 of 4 seats open')).length).toBeGreaterThan(0);
    expect(mockGetMonth).not.toHaveBeenCalled();
  });

  it('claims a seat and re-reads the roster from the server', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    const claimed = shift({ ...SHORT_DAY, attendee_count: 3 });
    mockGetMonth.mockResolvedValue([claimed, MINE]);

    const [claimButton] = await screen.findAllByRole('button', { name: /take a seat on this shift/i });
    await user.click(claimButton as HTMLElement);

    // The first open seat the member is cleared for, in the shift's own seat
    // order — driver before firefighter, because that is the order the crew is
    // built in and the seat the department most needs filled.
    await waitFor(() => expect(mockSignup).toHaveBeenCalledWith('day-25', { position: 'driver' }));
    await waitFor(() => expect(mockGetMonth).toHaveBeenCalledTimes(2));
  });

  it('puts the seat back when the claim is refused', async () => {
    const user = userEvent.setup();
    mockSignup.mockRejectedValue(new Error('Seat taken'));
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    const [claimButton] = await screen.findAllByRole('button', { name: /take a seat on this shift/i });
    await user.click(claimButton as HTMLElement);

    await waitFor(() => expect(mockSignup).toHaveBeenCalled());
    // The optimistic seat is rolled back, so the badge reads what it did before.
    expect((await screen.findAllByText('2 of 4 seats open')).length).toBeGreaterThan(0);
  });

  it('dims rather than removes when a filter is applied', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);

    await user.click(screen.getByRole('button', { name: 'My shifts' }));

    // The month keeps its shape: the 25th is still there, just dimmed.
    const cell = grid().getByRole('gridcell', { name: /Tuesday, August 25/ });
    expect(cell).toBeInTheDocument();
    expect(cell.className).toContain('opacity-35');
    expect(grid().getByRole('gridcell', { name: /Wednesday, August 26/ }).className).not.toContain('opacity-35');
  });

  it('offers a way to start when the range is empty', async () => {
    mockGetMonth.mockResolvedValue([]);
    render(
      <ShiftBoard
        view="month"
        visibleDate={new Date(2026, 7, 15)}
        onVisibleDateChange={vi.fn()}
        onViewChange={vi.fn()}
        emptyAction={<button type="button">Create the first shift</button>}
      />
    );
    expect(await screen.findByRole('button', { name: /create the first shift/i })).toBeInTheDocument();
  });

  it('surfaces a failed load instead of showing an empty month', async () => {
    mockGetMonth.mockRejectedValue(new Error('offline'));
    renderBoard();
    // The reason reaches the member rather than presenting as an empty month.
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });
});

describe('offers waiting on the member', () => {
  const OFFER = {
    id: 'sw1',
    offering_shift_id: 'day-25',
    requesting_user_id: 'u2',
    requesting_user_name: 'Dana Ruiz',
    target_user_id: ME,
    status: 'pending',
    created_at: '2026-08-20T00:00:00Z',
  };

  it('surfaces an offer on the day it belongs to', async () => {
    const user = userEvent.setup();
    mockMyOffers.mockResolvedValue([OFFER]);
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    expect((await screen.findAllByText(/Dana Ruiz offered you this seat/i)).length).toBeGreaterThan(0);
  });

  it('accepts through the member path, then re-reads the roster', async () => {
    const user = userEvent.setup();
    mockMyOffers.mockResolvedValue([OFFER]);
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    const [accept] = await screen.findAllByRole('button', { name: /take the shift/i });
    mockMyOffers.mockResolvedValue([]);
    await user.click(accept as HTMLElement);

    await waitFor(() => expect(mockRespond).toHaveBeenCalledWith('sw1', true));
    await waitFor(() => expect(mockGetMonth).toHaveBeenCalledTimes(2));
  });

  it('declines without touching the roster call', async () => {
    const user = userEvent.setup();
    mockMyOffers.mockResolvedValue([OFFER]);
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    const [decline] = await screen.findAllByRole('button', { name: /^decline$/i });
    await user.click(decline as HTMLElement);
    await waitFor(() => expect(mockRespond).toHaveBeenCalledWith('sw1', false));
  });

  it('keeps the board usable when the offer list cannot be loaded', async () => {
    // Non-critical: the banners just do not appear, and the roster below them
    // is still correct.
    mockMyOffers.mockRejectedValue(new Error('offline'));
    renderBoard();
    expect(await screen.findByTestId('month-open-seats')).toHaveTextContent('2 open seats this month');
  });
});

describe('asking about eligibility', () => {
  it('asks once for the whole day rather than once per shift', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    mockEligible.mockClear();

    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    await waitFor(() => expect(mockEligible).toHaveBeenCalledWith(['day-25']));
    expect(mockEligible).toHaveBeenCalledTimes(1);
  });

  it('does not re-ask for a day it already answered', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));
    await waitFor(() => expect(mockEligible).toHaveBeenCalled());
    mockEligible.mockClear();

    await user.click(grid().getByRole('gridcell', { name: /Wednesday, August 26/ }));
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    // Only the newly-seen day is asked about.
    expect(mockEligible).toHaveBeenCalledTimes(1);
    expect(mockEligible).toHaveBeenCalledWith(['mine-26']);
  });
});

describe('the quiet refresh', () => {
  it('re-reads when the board regains focus', async () => {
    // Two members working the same day otherwise see each other's claims only
    // after navigating: a board left open all morning shows breakfast's counts.
    renderBoard();
    await screen.findByText(/open seats this month/i);
    mockGetMonth.mockClear();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(mockGetMonth).toHaveBeenCalledTimes(1));
  });

  it('holds off while a claim is in flight', async () => {
    // Pulling the roster out from under a decision being made on it is worse
    // than showing it a minute late.
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    mockSignup.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));
    const [claim] = await screen.findAllByRole('button', { name: /take a seat on this shift/i });
    await user.click(claim as HTMLElement);

    mockGetMonth.mockClear();
    window.dispatchEvent(new Event('focus'));
    expect(mockGetMonth).not.toHaveBeenCalled();

    release?.();
  });

  it('leaves the last good data on screen when a background read fails', async () => {
    renderBoard();
    await screen.findByTestId('month-open-seats');
    mockGetMonth.mockRejectedValue(new Error('offline'));

    window.dispatchEvent(new Event('focus'));

    // No error banner: the member did not ask for this read, and a failed
    // poll is not news.
    await waitFor(() => expect(mockGetMonth).toHaveBeenCalled());
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
    expect(screen.getByTestId('month-open-seats')).toHaveTextContent('2 open seats this month');
  });
});
