import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyHoursSummary } from './MyHoursSummary';
import type { MemberHoursHistory } from '../../modules/scheduling/services/api';

const mockGetMyHoursHistory = vi.fn();
const mockGetMemberHoursHistory = vi.fn();
const mockLoadSettings = vi.fn();
let mockCallTrackingMode = 'detailed';

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyHoursHistory: (...args: unknown[]) => mockGetMyHoursHistory(...args) as unknown,
    getMemberHoursHistory: (...args: unknown[]) => mockGetMemberHoursHistory(...args) as unknown,
  },
}));

// The shift list has its own suite; here a stub records what it was handed
// and keeps these tests off its service calls.
const mockShiftList = vi.fn();
vi.mock('./MemberShiftHistory', () => ({
  MemberShiftHistory: (props: Record<string, unknown>) => {
    mockShiftList(props);
    return <div data-testid="member-shift-history" />;
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
  department_label: 'FCVFD',
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
  mockShiftList.mockReset();
  mockCallTrackingMode = 'detailed';
};

/** The month table sits behind a toggle under the chart. */
const openTable = async () => {
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Show as table' }));
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

    await openTable();
    expect(screen.getByRole('columnheader', { name: 'vs. busiest month' })).toBeInTheDocument();
  });

  it('lists every month of the year, including the quiet ones', async () => {
    render(<MyHoursSummary />);

    await openTable();
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
    await openTable();
    expect(screen.getByText('(+5 pending)')).toBeInTheDocument();
  });

  it('heads each card with every shift hour, and splits it by department beneath', async () => {
    // Owner decision 2026-11-16: the headline is all shift hours, the
    // department's own and those with other departments together.
    const months = history().months;
    months[1] = month(2, { shifts: 1, hours: 12, calls: 3, external_shifts: 1, external_hours: 10 });
    useDefaultHistory(
      history({
        months,
        totals: {
          shifts: 3,
          hours: 36,
          calls: 9,
          pending_shifts: 0,
          pending_hours: 0,
          external_shifts: 1,
          external_hours: 10,
        },
      })
    );

    render(<MyHoursSummary />);

    const yearCard = await screen.findByRole('group', { name: 'This year' });
    expect(within(yearCard).getByText('46')).toBeInTheDocument();
    expect(within(yearCard).getByText('36 FCVFD')).toBeInTheDocument();
    expect(within(yearCard).getByText('+10 with other departments')).toBeInTheDocument();
    expect(within(yearCard).getByText('4 shifts · 9 calls')).toBeInTheDocument();
    // The table keeps the two apart, as the payload does.
    await openTable();
    expect(screen.getAllByText('(+10 outside)')).toHaveLength(2);
  });

  it('draws a bar per month that names both figures, and marks the month chosen in the list', async () => {
    const months = history().months;
    months[1] = month(2, { shifts: 1, hours: 12, calls: 3, external_shifts: 1, external_hours: 10 });
    useDefaultHistory(history({ months }));
    const user = userEvent.setup();
    render(<MyHoursSummary />);

    const feb = await screen.findByRole('button', {
      name: 'February: 12 hours FCVFD, 10 hours with other departments, 3 calls',
    });
    // Quiet months have no bar to press.
    expect(screen.queryByRole('button', { name: /^March:/ })).not.toBeInTheDocument();

    await user.hover(feb);
    expect(screen.getByRole('tooltip')).toHaveTextContent('February 2026');

    await user.click(feb);
    expect(feb).toHaveAttribute('aria-pressed', 'true');
    expect(mockShiftList).toHaveBeenLastCalledWith(expect.objectContaining({ highlightMonth: 2, selectedYear: 2026 }));
  });

  it('summarises the year under the chart', async () => {
    render(<MyHoursSummary />);

    await screen.findByText('Busiest month');
    const list = screen.getByRole('group', { name: '2026 summary' });
    expect(within(list).getByText('January · 24 hrs')).toBeInTheDocument();
    expect(within(list).getByText('2 of 12')).toBeInTheDocument();
    expect(within(list).getByText('18 hrs')).toBeInTheDocument();
    expect(within(list).getByText('3')).toBeInTheDocument();
  });

  it("shows the year's hours by the seat held", async () => {
    useDefaultHistory(
      history({
        positions: [
          { position: 'driver', shifts: 2, hours: 24, calls: 3 },
          { position: null, shifts: 1, hours: 4, calls: 0 },
        ],
        all_time_positions: [{ position: 'driver', shifts: 9, hours: 108, calls: 12 }],
      })
    );
    render(<MyHoursSummary />);

    const section = await screen.findByRole('region', { name: 'Hours by position' });
    expect(within(section).getAllByRole('listitem')[0]).toHaveTextContent('24 hrs · 2 shifts · 3 calls');
    expect(section).toHaveTextContent('No position recorded');
  });

  it('hands the shift list every year on record and the department label', async () => {
    const years = [{ year: 2026, totals: history().totals, months: history().months }];
    useDefaultHistory(history({ years }));
    render(<MyHoursSummary />);

    await screen.findByTestId('member-shift-history');
    expect(mockShiftList).toHaveBeenLastCalledWith(
      expect.objectContaining({ years, departmentLabel: 'FCVFD', memberId: undefined })
    );
  });

  describe('when the department does not track calls', () => {
    beforeEach(() => {
      useDefaultHistory();
      mockCallTrackingMode = 'off';
    });

    it('drops the calls column rather than showing a column of zeros', async () => {
      render(<MyHoursSummary />);

      await openTable();
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

    it('steps to the previous year, and has no next year past the current one', async () => {
      const user = userEvent.setup();
      render(<MyHoursSummary />);

      expect(await screen.findByRole('button', { name: 'Next year' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Previous year' }));
      await waitFor(() => expect(mockGetMyHoursHistory).toHaveBeenCalledWith(2025));
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

describe('MyHoursSummary on a member profile', () => {
  beforeEach(() => {
    mockGetMyHoursHistory.mockReset();
    mockShiftList.mockReset();
    mockGetMemberHoursHistory.mockReset();
    mockCallTrackingMode = 'detailed';
    mockGetMemberHoursHistory.mockResolvedValue(
      history({
        totals: {
          shifts: 3,
          hours: 36,
          calls: 9,
          pending_shifts: 0,
          pending_hours: 0,
          on_call_shifts: 1,
          on_call_hours: 12,
          external_shifts: 1,
          external_hours: 4,
          external_calls: 2,
        },
      })
    );
  });

  it("reads the member's history, not the viewer's own", async () => {
    render(<MyHoursSummary memberId="u-77" />);

    expect(await screen.findByRole('heading', { name: 'Shift & Call History' })).toBeInTheDocument();
    expect(mockGetMemberHoursHistory).toHaveBeenCalledWith('u-77', undefined);
    expect(mockGetMyHoursHistory).not.toHaveBeenCalled();
    // The list is shown read-only for the member being viewed.
    expect(mockShiftList).toHaveBeenLastCalledWith(expect.objectContaining({ memberId: 'u-77' }));
  });

  it('shows on-call hours as part of the total and outside calls beside it', async () => {
    render(<MyHoursSummary memberId="u-77" />);

    const year = await screen.findByRole('group', { name: 'This year' });
    expect(within(year).getByText('of which 12 hrs on call')).toBeInTheDocument();
    expect(within(year).getByText('40')).toBeInTheDocument();
    expect(within(year).getByText('+4 with other departments')).toBeInTheDocument();
    expect(within(year).getByText('4 shifts · 11 calls')).toBeInTheDocument();
  });

  it('asks for the chosen year of that member', async () => {
    const user = userEvent.setup();
    render(<MyHoursSummary memberId="u-77" />);
    await screen.findByRole('heading', { name: 'Shift & Call History' });
    await user.selectOptions(screen.getByLabelText('Year'), '2025');

    await waitFor(() => expect(mockGetMemberHoursHistory).toHaveBeenLastCalledWith('u-77', 2025));
  });
});
