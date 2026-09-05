import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyHoursSummary } from './MyHoursSummary';
import type { MemberHoursHistory } from '../../modules/scheduling/services/api';

const mockGetMyHoursHistory = vi.fn();
const mockLoadSettings = vi.fn();
let mockCallTrackingMode = 'detailed';

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyHoursHistory: (...args: unknown[]) => mockGetMyHoursHistory(...args) as unknown,
  },
}));

vi.mock('../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (state: unknown) => unknown) => {
    const state = { callTrackingMode: mockCallTrackingMode, loadSettings: mockLoadSettings };
    return selector ? selector(state) : state;
  },
}));

const month = (m: number, over: Partial<MemberHoursHistory['months'][number]> = {}) => ({
  year: 2026,
  month: m,
  shifts: 0,
  hours: 0,
  calls: 0,
  pending_shifts: 0,
  pending_hours: 0,
  ...over,
});

const history = (over: Partial<MemberHoursHistory> = {}): MemberHoursHistory => ({
  year: 2026,
  earliest_year: 2024,
  timezone: 'America/New_York',
  months: [
    month(1, { shifts: 2, hours: 24, calls: 6 }),
    month(2, { shifts: 1, hours: 12, calls: 3 }),
    month(3),
    month(4),
    month(5),
    month(6),
    month(7),
    month(8),
    month(9),
    month(10),
    month(11),
    month(12),
  ],
  totals: { shifts: 3, hours: 36, calls: 9, pending_shifts: 0, pending_hours: 0 },
  // Deliberately larger than `totals`: it spans years the table never shows,
  // so a card reading it off the wrong field is visible in the assertions.
  all_time: { shifts: 8, hours: 96, calls: 20, pending_shifts: 0, pending_hours: 0 },
  current_month: month(2, { shifts: 1, hours: 12, calls: 3 }),
  previous_month: month(1, { shifts: 2, hours: 24, calls: 6 }),
  ...over,
});

/**
 * Each block installs the implementations it depends on: `vi.clearAllMocks`
 * leaves both implementations and queued one-shots in place, so a default set
 * in a neighbouring block would otherwise be what this one runs on.
 */
const useDefaultHistory = (payload: MemberHoursHistory = history()) => {
  mockGetMyHoursHistory.mockReset();
  mockGetMyHoursHistory.mockResolvedValue(payload);
  mockCallTrackingMode = 'detailed';
};

describe('MyHoursSummary', () => {
  beforeEach(() => {
    useDefaultHistory();
  });

  it('loads the current year without asking for one', async () => {
    render(<MyHoursSummary />);

    await waitFor(() => {
      expect(screen.getByText('My Hours')).toBeInTheDocument();
    });
    expect(mockGetMyHoursHistory).toHaveBeenCalledWith(undefined);
  });

  it('shows this month, this year and all time', async () => {
    render(<MyHoursSummary />);

    const monthCard = await screen.findByRole('group', { name: 'This month' });
    expect(within(monthCard).getByText('February 2026')).toBeInTheDocument();
    expect(within(monthCard).getByText('12')).toBeInTheDocument();
    expect(within(monthCard).getByText('1 shift · 3 calls')).toBeInTheDocument();

    const yearCard = screen.getByRole('group', { name: 'This year' });
    expect(within(yearCard).getByText('Year to date')).toBeInTheDocument();
    expect(within(yearCard).getByText('36')).toBeInTheDocument();
    expect(within(yearCard).getByText('3 shifts · 9 calls')).toBeInTheDocument();

    const allTimeCard = screen.getByRole('group', { name: 'All time' });
    expect(within(allTimeCard).getByText('Since 2024')).toBeInTheDocument();
    expect(within(allTimeCard).getByText('96')).toBeInTheDocument();
    expect(within(allTimeCard).getByText('8 shifts · 20 calls')).toBeInTheDocument();

    expect(screen.queryByRole('group', { name: 'Last month' })).not.toBeInTheDocument();
  });

  it('says so when the member has never worked a shift', async () => {
    const zero = { shifts: 0, hours: 0, calls: 0, pending_shifts: 0, pending_hours: 0 };
    useDefaultHistory(history({ earliest_year: null, totals: zero, all_time: zero }));

    render(<MyHoursSummary />);

    const allTimeCard = await screen.findByRole('group', { name: 'All time' });
    expect(within(allTimeCard).getByText('No shifts yet')).toBeInTheDocument();
  });

  it('labels the bar column instead of leaving it to be guessed at', async () => {
    render(<MyHoursSummary />);

    await screen.findByText('My Hours');
    expect(screen.getByRole('columnheader', { name: 'vs. busiest month' })).toBeInTheDocument();
  });

  it('lists every month of the year, including the quiet ones', async () => {
    render(<MyHoursSummary />);

    await screen.findByText('My Hours');
    const table = screen.getByRole('table');
    // Twelve month rows plus the totals row in the footer.
    expect(within(table).getAllByRole('row')).toHaveLength(14);
    expect(within(table).getByText('December')).toBeInTheDocument();
  });

  it('reports pending hours separately from credited ones', async () => {
    const months = history().months;
    months[2] = month(3, { pending_shifts: 1, pending_hours: 5 });
    useDefaultHistory(
      history({
        months,
        totals: { shifts: 3, hours: 36, calls: 9, pending_shifts: 1, pending_hours: 5 },
      })
    );

    render(<MyHoursSummary />);

    expect(await screen.findByText(/5 more hours are logged on shifts/)).toBeInTheDocument();
    expect(screen.getByText('(+5 pending)')).toBeInTheDocument();
  });

  describe('when the department does not track calls', () => {
    beforeEach(() => {
      useDefaultHistory();
      mockCallTrackingMode = 'off';
    });

    it('drops the calls column rather than showing a column of zeros', async () => {
      render(<MyHoursSummary />);

      await screen.findByText('My Hours');
      expect(screen.queryByRole('columnheader', { name: 'Calls' })).not.toBeInTheDocument();
      const yearCard = screen.getByRole('group', { name: 'This year' });
      expect(within(yearCard).getByText('3 shifts')).toBeInTheDocument();
      const allTimeCard = screen.getByRole('group', { name: 'All time' });
      expect(within(allTimeCard).getByText('8 shifts')).toBeInTheDocument();
    });
  });

  describe('year picker', () => {
    beforeEach(() => {
      useDefaultHistory();
    });

    it('offers every year back to the first the member worked', async () => {
      render(<MyHoursSummary />);

      const select = await screen.findByLabelText<HTMLSelectElement>('Year');
      expect([...select.options].map((o) => o.value)).toEqual(['2026', '2025', '2024']);
    });

    it('reloads on the chosen year', async () => {
      const user = userEvent.setup();
      render(<MyHoursSummary />);

      const select = await screen.findByLabelText('Year');
      mockGetMyHoursHistory.mockResolvedValue(
        history({ year: 2025, months: history().months.map((m) => ({ ...m, year: 2025 })) })
      );
      await user.selectOptions(select, '2025');

      await waitFor(() => {
        expect(mockGetMyHoursHistory).toHaveBeenCalledWith(2025);
      });

      // The middle card follows the picker, so it can never claim "this year"
      // over a table showing a different one.
      const yearCard = await screen.findByRole('group', { name: '2025' });
      expect(within(yearCard).getByText('Full year')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'This year' })).not.toBeInTheDocument();

      // A career total is not a view of the selected year.
      const allTimeCard = screen.getByRole('group', { name: 'All time' });
      expect(within(allTimeCard).getByText('96')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'This month' })).toBeInTheDocument();
    });

    it('still offers the current year while viewing an earlier one', async () => {
      // The response for an earlier year reports that year, but the picker's
      // top entry is the year the department is actually in.
      useDefaultHistory(history({ year: 2024, earliest_year: 2024 }));
      render(<MyHoursSummary />);

      const select = await screen.findByLabelText<HTMLSelectElement>('Year');
      expect([...select.options].map((o) => o.value)).toEqual(['2026', '2025', '2024']);
      expect(select.value).toBe('2024');
    });
  });

  describe('failures', () => {
    beforeEach(() => {
      mockGetMyHoursHistory.mockReset();
      mockGetMyHoursHistory.mockRejectedValue(new Error('boom'));
      mockCallTrackingMode = 'detailed';
    });

    it('surfaces the error with a retry', async () => {
      const user = userEvent.setup();
      render(<MyHoursSummary />);

      expect(await screen.findByRole('alert')).toHaveTextContent('boom');

      mockGetMyHoursHistory.mockResolvedValue(history());
      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('My Hours')).toBeInTheDocument();
    });
  });
});
