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

  it('shows last month, this month and the year total', async () => {
    render(<MyHoursSummary />);

    const lastCard = await screen.findByRole('group', { name: 'Last month' });
    expect(within(lastCard).getByText('January 2026')).toBeInTheDocument();
    expect(within(lastCard).getByText('24')).toBeInTheDocument();
    expect(within(lastCard).getByText('2 shifts · 6 calls')).toBeInTheDocument();

    const thisCard = screen.getByRole('group', { name: 'This month' });
    expect(within(thisCard).getByText('February 2026')).toBeInTheDocument();
    expect(within(thisCard).getByText('1 shift · 3 calls')).toBeInTheDocument();

    const totalCard = screen.getByRole('group', { name: '2026 total' });
    expect(within(totalCard).getByText('36')).toBeInTheDocument();
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
      expect(screen.getByText('2 shifts')).toBeInTheDocument();
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
      expect(await screen.findByText('2025 total')).toBeInTheDocument();
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
