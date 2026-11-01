const mockGetMonth = vi.fn();
const mockGetWeek = vi.fn();
const mockSignup = vi.fn();
const mockEligible = vi.fn();
const mockMyOffers = vi.fn();
const mockRespond = vi.fn();
const mockCancelSwap = vi.fn();
const mockGetShifts = vi.fn();
const mockTimeOff = vi.fn();

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
      getShifts: (...args: unknown[]) => mockGetShifts(...args) as unknown,
      getApprovedTimeOffFor: (...args: unknown[]) => mockTimeOff(...args) as unknown,
      getCalendarFeed: () => Promise.resolve({ token: 't', feed_path: '/feed' }),
    },
  };
});

vi.mock('../../../stores/authStore', () => {
  const state = () => ({
    user: { id: 'me-1', full_name: 'Sam Poe', timezone: 'America/New_York' },
  });
  // Callable and carrying getState, as the real store is: consumers that read
  // it outside React (the org-scoped scheduling settings cache) use the latter.
  return {
    useAuthStore: Object.assign(
      (selector?: (s: unknown) => unknown) => {
        const s = state();
        return selector ? selector(s) : s;
      },
      { getState: state }
    ),
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

const renderBoard = (props: Partial<React.ComponentProps<typeof ShiftBoard>> = {}) =>
  render(
    <ShiftBoard
      view="month"
      visibleDate={new Date(2026, 7, 15)}
      onVisibleDateChange={vi.fn()}
      onViewChange={vi.fn()}
      {...props}
    />
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
  // Reset, not just cleared: a later-shift hint queued by one test must not
  // reach the empty month of the next.
  mockGetShifts.mockReset();
  mockGetShifts.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 1 });
  mockTimeOff.mockReset();
  mockTimeOff.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ShiftBoard', () => {
  it('loads the visible month once, roster included', async () => {
    renderBoard();
    await waitFor(() => expect(mockGetMonth).toHaveBeenCalledWith(2026, 8, undefined));
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
    expect(screen.queryByText(/Your scheduling officer has not published/)).not.toBeInTheDocument();
  });

  it('tells a member nothing is published yet when the range is empty', async () => {
    mockGetMonth.mockResolvedValue([]);
    renderBoard();
    expect(await screen.findByText('Nothing is scheduled for this month yet.')).toBeInTheDocument();
    expect(screen.getByText(/Your scheduling officer has not published shifts for these dates/)).toBeInTheDocument();
  });

  it('points an empty range at the next shift on the schedule', async () => {
    mockGetMonth.mockResolvedValue([]);
    mockGetShifts.mockResolvedValue({
      shifts: [shift({ id: 'next', shift_date: '2026-09-07' })],
      total: 1,
      skip: 0,
      limit: 1,
    });
    const onVisibleDateChange = vi.fn();
    renderBoard({ onVisibleDateChange });

    expect(await screen.findByText(/The next shift on the schedule is on Mon, Sep 7/)).toBeInTheDocument();
    // Asked from the day after the month the board fetched, not from today.
    expect(mockGetShifts).toHaveBeenCalledWith({ start_date: '2026-09-01', limit: 10 });
    expect(screen.queryByText(/Your scheduling officer has not published/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Go to the next shift' }));
    const moved = onVisibleDateChange.mock.calls[0]?.[0] as Date | undefined;
    expect(moved?.getFullYear()).toBe(2026);
    expect(moved?.getMonth()).toBe(8);
    expect(moved?.getDate()).toBe(7);
  });

  it("keeps the officer's create action beside the next-shift link", async () => {
    mockGetMonth.mockResolvedValue([]);
    mockGetShifts.mockResolvedValue({
      shifts: [shift({ id: 'next', shift_date: '2026-09-07' })],
      total: 1,
      skip: 0,
      limit: 1,
    });
    renderBoard({ emptyAction: <button type="button">Create a shift</button> });

    expect(await screen.findByRole('button', { name: 'Go to the next shift' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a shift' })).toBeInTheDocument();
  });

  it('asks a week view from the day after its Saturday', async () => {
    mockGetWeek.mockResolvedValue([]);
    renderBoard({ view: 'week', visibleDate: new Date(2026, 7, 20) });

    await waitFor(() => expect(mockGetShifts).toHaveBeenCalledWith({ start_date: '2026-08-23', limit: 10 }));
  });

  it('does not look for a later shift when the range has some', async () => {
    renderBoard();
    expect(await screen.findByTestId('month-open-seats')).toHaveTextContent('2 open seats this month');
    expect(mockGetShifts).not.toHaveBeenCalled();
  });

  it('surfaces a failed load instead of showing an empty month', async () => {
    mockGetMonth.mockRejectedValue(new Error('offline'));
    renderBoard();
    // The reason reaches the member rather than presenting as an empty month.
    expect(await screen.findByText('offline')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is scheduled/)).not.toBeInTheDocument();
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

describe('a day the member has off', () => {
  const DAY_OFF = {
    id: 't1',
    start_date: '2026-08-24',
    end_date: '2026-08-25',
    status: 'approved',
    created_at: '2026-08-10T00:00:00Z',
  };

  beforeEach(() => {
    mockTimeOff.mockReset();
    mockTimeOff.mockResolvedValue([DAY_OFF]);
  });

  it("asks for the member's own approved time off with the month", async () => {
    renderBoard();
    await waitFor(() => expect(mockTimeOff).toHaveBeenCalledWith(ME, undefined));
  });

  it('does not offer a seat on a day off, and says why', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    expect((await screen.findAllByText('You have approved time off on this day.')).length).toBeGreaterThan(0);
    // Eligibility has answered — the driver and firefighter seats would be
    // takeable — so the absent buttons are the time off, not a lookup pending.
    await waitFor(() => expect(mockEligible).toHaveBeenCalled());
    expect(screen.queryAllByRole('button', { name: /take a seat on this shift/i })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Take the .* seat on this shift$/ })).toHaveLength(0);
    expect(
      screen.getAllByRole('button', { name: 'Driver/Operator seat — you have approved time off on this day' })[0]
    ).toBeDisabled();
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it('still offers seats on a day the time off does not cover', async () => {
    mockTimeOff.mockResolvedValue([{ ...DAY_OFF, start_date: '2026-08-01', end_date: '2026-08-24' }]);
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    expect((await screen.findAllByRole('button', { name: /take a seat on this shift/i })).length).toBeGreaterThan(0);
  });

  it('withholds "Take the shift" on an offer for a day off, but still lets them decline', async () => {
    mockMyOffers.mockResolvedValue([
      {
        id: 'sw1',
        offering_shift_id: 'day-25',
        requesting_user_id: 'u2',
        requesting_user_name: 'Dana Ruiz',
        target_user_id: ME,
        status: 'pending',
        created_at: '2026-08-20T00:00:00Z',
      },
    ]);
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    expect((await screen.findAllByText(/Dana Ruiz offered you this seat/i)).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: /take the shift/i })).toHaveLength(0);
    const [decline] = screen.getAllByRole('button', { name: /^decline$/i });
    await user.click(decline as HTMLElement);
    await waitFor(() => expect(mockRespond).toHaveBeenCalledWith('sw1', false));
  });

  it('keeps the board usable when the time off cannot be loaded', async () => {
    mockTimeOff.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderBoard();
    expect(await screen.findByTestId('month-open-seats')).toHaveTextContent('2 open seats this month');
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));
    expect((await screen.findAllByRole('button', { name: /take a seat on this shift/i })).length).toBeGreaterThan(0);
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

describe("the way into a shift's full detail", () => {
  it('opens the detail panel for a shift the member is not on', async () => {
    // Claiming and giving up a seat are the board's own actions. Everything
    // else an officer does to a shift — editing it, managing attendance,
    // finalizing it — lives in the detail panel, and a fully staffed shift
    // they are not assigned to appears in no other list on the page.
    const user = userEvent.setup();
    const onViewShift = vi.fn();
    renderBoard({ onViewShift });
    await screen.findByText(/open seats this month/i);

    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));
    // The desktop panel and the phone sheet both render — only CSS hides one
    // — so the link exists twice and either copy is the same action.
    const [firstLink] = await screen.findAllByRole('button', { name: /shift details/i });
    expect(firstLink).toBeDefined();
    await user.click(firstLink as HTMLElement);

    expect(onViewShift).toHaveBeenCalledWith(expect.objectContaining({ id: 'day-25' }));
  });

  it('shows no details link when the page wires no handler', async () => {
    // A visible control that does nothing reads as a broken page.
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/open seats this month/i);
    await user.click(grid().getByRole('gridcell', { name: /Tuesday, August 25/ }));

    expect(screen.queryAllByRole('button', { name: /shift details/i })).toHaveLength(0);
  });
});

describe("the board's today", () => {
  const todayCell = () =>
    grid()
      .getAllByRole('gridcell')
      .find((cell) => cell.getAttribute('aria-current') === 'date');

  it("is the department's calendar day, not the browser's", async () => {
    // 02:00 UTC on the 21st is 22:00 on the 20th in New York, the
    // department's timezone. The test browser runs in UTC.
    vi.setSystemTime(new Date('2026-08-21T02:00:00Z'));
    renderBoard();
    await screen.findByText(/open seats this month/i);
    expect(todayCell()).toHaveAccessibleName(/Thursday, August 20/);
  });

  it('moves on to the next day while the board stays open', async () => {
    // The clock ticks on a shared 30-second interval, so this test fakes it.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-08-20T13:00:00Z'));
    renderBoard();
    await screen.findByText(/open seats this month/i);
    expect(todayCell()).toHaveAccessibleName(/Thursday, August 20/);

    act(() => {
      vi.setSystemTime(new Date('2026-08-21T13:00:00Z'));
      vi.advanceTimersByTime(30_000);
    });

    expect(todayCell()).toHaveAccessibleName(/Friday, August 21/);
  });

  // The member's own shift, 10:00–22:00 UTC on the 26th.
  const MINE_TIMED = shift({ ...MINE, start_time: '2026-08-26T10:00:00Z', end_time: '2026-08-26T22:00:00Z' });

  it('does not offer a shift that has already ended as the next one', async () => {
    // At 23:30 UTC it is over, though it is still the 26th in New York.
    vi.setSystemTime(new Date('2026-08-26T23:30:00Z'));
    mockGetMonth.mockResolvedValue([SHORT_DAY, MINE_TIMED]);
    renderBoard();
    await screen.findByText(/open seats this month/i);
    expect(screen.queryByText('Your next shift')).not.toBeInTheDocument();
  });

  it('still offers a shift that has not ended yet', async () => {
    vi.setSystemTime(new Date('2026-08-26T15:00:00Z'));
    mockGetMonth.mockResolvedValue([SHORT_DAY, MINE_TIMED]);
    renderBoard();
    await screen.findByText(/open seats this month/i);
    expect(screen.getByText('Your next shift')).toBeInTheDocument();
  });

  it('does not call a shift "next" from a month that does not contain today', async () => {
    // Paged to September with today in August: the shift on screen is not
    // the member's next one, since August is not loaded.
    const september = shift({
      ...MINE,
      id: 'mine-sep',
      shift_date: '2026-09-03',
      start_time: '2026-09-03T10:00:00Z',
      end_time: '2026-09-03T22:00:00Z',
    });
    mockGetMonth.mockResolvedValue([september]);
    renderBoard({ visibleDate: new Date(2026, 8, 15) });
    await screen.findByText(/open seats this month/i);
    expect(screen.queryByText('Your next shift')).not.toBeInTheDocument();
  });

  const LATE_SHORT = shift({
    id: 'day-31',
    shift_date: '2026-08-31',
    start_time: '2026-08-31T20:00:00Z',
    end_time: '2026-09-01T08:00:00Z',
    attendee_count: 1,
  });

  it('does not count "this week" from a month that holds only part of it', async () => {
    // Monday the 31st: this week runs Aug 30 – Sep 5, and only two of its days
    // are in the August fetch.
    vi.setSystemTime(new Date('2026-08-31T13:00:00Z'));
    mockGetMonth.mockResolvedValue([LATE_SHORT]);
    renderBoard();
    await screen.findByText(/open seats this month/i);
    expect(screen.queryByText(/this week still need people/)).not.toBeInTheDocument();
  });

  it('counts this week in a week view that covers all of it', async () => {
    vi.setSystemTime(new Date('2026-08-31T13:00:00Z'));
    mockGetWeek.mockResolvedValue([LATE_SHORT]);
    renderBoard({ view: 'week', visibleDate: new Date(2026, 7, 31) });
    expect(await screen.findByText('1 day this week still need people')).toBeInTheDocument();
  });

  it('skips a cancelled shift when pointing an empty range at the next one', async () => {
    mockGetMonth.mockResolvedValue([]);
    mockGetShifts.mockResolvedValue({
      shifts: [
        shift({ id: 'gone', shift_date: '2026-09-02', status: 'cancelled' }),
        shift({ id: 'next', shift_date: '2026-09-07' }),
      ],
      total: 2,
      skip: 0,
      limit: 10,
    });
    renderBoard();
    expect(await screen.findByText(/The next shift on the schedule is on Mon, Sep 7/)).toBeInTheDocument();
  });
});
