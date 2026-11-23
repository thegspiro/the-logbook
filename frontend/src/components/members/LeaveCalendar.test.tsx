/**
 * The department's leave calendar and the leave records export.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const getCalendar = vi.fn();
const exportRecords = vi.fn();
const saveBlob = vi.fn();

vi.mock('../../services/leaveRequestService', () => ({
  leaveRequestService: {
    getCalendar: (...a: unknown[]) => getCalendar(...a) as unknown,
    exportRecords: (...a: unknown[]) => exportRecords(...a) as unknown,
  },
}));
vi.mock('../../utils/saveBlob', () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) as unknown }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../utils/dateFormatting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dateFormatting')>();
  // The calendar opens on the department's current month; pin it.
  return { ...actual, getTodayLocalDate: () => '2027-03-15' };
});

import LeaveCalendar from './LeaveCalendar';

const march = (overrides: Record<string, unknown> = {}) => ({
  month_start: '2027-03-01',
  month_end: '2027-03-31',
  today: '2027-03-15',
  entries: [],
  covers: [],
  ...overrides,
});

const onLeave = {
  id: 'l1',
  kind: 'leave',
  member_id: 'm1',
  member_name: 'Morgan Member',
  leave_type: 'medical',
  start_date: '2027-02-25',
  end_date: '2027-03-02',
};
const waiting = {
  id: 'r1',
  kind: 'request',
  member_id: 'm2',
  member_name: 'Avery Asker',
  leave_type: 'personal',
  start_date: '2027-03-02',
  end_date: null,
};
const cover = {
  id: 'c1',
  approver_id: 'b1',
  approver_name: 'Blake Board',
  stand_in_id: 'o1',
  stand_in_name: 'Olive Officer',
  start_date: '2027-03-02',
  end_date: '2027-03-02',
};

describe('LeaveCalendar', () => {
  beforeEach(() => {
    for (const mock of [getCalendar, exportRecords, saveBlob]) mock.mockReset();
    getCalendar.mockResolvedValue(march());
    exportRecords.mockResolvedValue(new Blob(['Member\n']));
  });

  it('opens on the current month and says when nobody is away', async () => {
    renderWithRouter(<LeaveCalendar />);

    expect(await screen.findByText('Nobody is on leave or covering this month.')).toBeInTheDocument();
    expect(getCalendar).toHaveBeenCalledWith('2027-03');
    expect(screen.getByRole('heading', { name: 'March 2027' })).toBeInTheDocument();
  });

  it('lists each day with who is away, waiting or covering', async () => {
    getCalendar.mockResolvedValue(march({ entries: [onLeave, waiting], covers: [cover] }));
    renderWithRouter(<LeaveCalendar />);

    const byDay = await screen.findByRole('list', { name: 'Leave in March 2027, by day' });
    const days = within(byDay).getAllByRole('heading', { level: 3 });
    // Leave runs through the 2nd; the open-ended request from the 2nd on.
    expect(days[0]).toHaveTextContent('Monday, March 1');
    expect(days).toHaveLength(31);
    const second = within(byDay).getByRole('list', { name: 'Away on March 2' });
    expect(within(second).getByText('Morgan Member')).toBeInTheDocument();
    expect(within(second).getByText('Avery Asker (requested)')).toBeInTheDocument();
    expect(within(second).getByText('Olive Officer covers Blake Board')).toBeInTheDocument();
    const third = within(byDay).getByRole('list', { name: 'Away on March 3' });
    expect(within(third).queryByText('Morgan Member')).not.toBeInTheDocument();
    expect(within(third).getByText('Avery Asker (requested)')).toBeInTheDocument();
  });

  it('starts the grid on the right weekday and names each day for a screen reader', async () => {
    getCalendar.mockResolvedValue(march({ entries: [onLeave] }));
    renderWithRouter(<LeaveCalendar />);

    const grid = await screen.findByRole('grid', { name: 'Leave in March 2027', hidden: true });
    const cells = within(grid).getAllByRole('gridcell', { hidden: true });
    expect(cells).toHaveLength(31);
    expect(cells[0]).toHaveAccessibleName('Monday, March 1: Morgan Member');
    expect(cells[2]).toHaveAccessibleName('Wednesday, March 3: nothing');
  });

  it('moves a month at a time', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LeaveCalendar />);
    await screen.findByText('Nobody is on leave or covering this month.');

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(getCalendar).toHaveBeenLastCalledWith('2027-04');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(getCalendar).toHaveBeenLastCalledWith('2027-02');
  });

  it('exports the month on screen unless other dates are chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LeaveCalendar />);
    await screen.findByText('Nobody is on leave or covering this month.');
    const download = screen.getByRole('button', { name: 'Download CSV' });
    expect(screen.getByLabelText('From')).toHaveValue('2027-03-01');
    expect(screen.getByLabelText('To')).toHaveValue('2027-03-31');

    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2027-06-30');
    await user.click(download);

    expect(exportRecords).toHaveBeenCalledWith('2027-03-01', '2027-06-30');
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'leave-records-2027-03-01-to-2027-06-30.csv');
  });
});
