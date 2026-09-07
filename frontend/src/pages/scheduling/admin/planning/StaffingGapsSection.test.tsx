/**
 * The gaps workspace: what it lists, and what it does when an officer fills one.
 *
 * `staffingGaps.test.ts` covers which shifts count as short. This is about the
 * screen — that a failed fetch says so rather than showing an empty list, that
 * the assignment reaches the server with the seat that was picked, and that the
 * advisory warnings the server returns are not dropped on the way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';

const mockGetShifts = vi.fn();
const mockCreateAssignment = vi.fn();
vi.mock('../../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShifts: (...args: unknown[]) => mockGetShifts(...args) as unknown,
    createAssignment: (...args: unknown[]) => mockCreateAssignment(...args) as unknown,
  },
}));

const mockToast = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: Object.assign(
    (...args: unknown[]): void => {
      mockToast(...args);
    },
    {
      success: (...args: unknown[]): void => {
        mockToastSuccess(...args);
      },
      error: (...args: unknown[]): void => {
        mockToastError(...args);
      },
    }
  ),
}));

let departmentTimezone = 'UTC';
vi.mock('../../../../hooks/useTimezone', () => ({
  useTimezone: () => departmentTimezone,
}));

const storeState = {
  members: [
    { id: 'user-1', label: 'Alex Kim' },
    { id: 'user-2', label: 'Dana Reyes' },
  ],
  membersLoaded: true,
  loadMembers: vi.fn(),
};
vi.mock('../../../../modules/scheduling/store/schedulingStore', () => ({
  useSchedulingStore: (selector?: (s: typeof storeState) => unknown) => (selector ? selector(storeState) : storeState),
}));

import StaffingGapsSection from './StaffingGapsSection';

const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const shortShift = {
  id: 'shift-1',
  organization_id: 'org-1',
  shift_date: TOMORROW,
  start_time: `${TOMORROW}T08:00:00Z`,
  end_time: `${TOMORROW}T20:00:00Z`,
  apparatus_unit_number: 'Engine 1',
  positions: [{ position: 'officer' }, { position: 'driver' }],
  roster: [{ user_id: 'user-9', user_name: 'On Duty', position: 'officer', status: 'confirmed' }],
  attendee_count: 1,
  call_count: 0,
  is_finalized: false,
  created_at: `${TOMORROW}T00:00:00Z`,
};

describe('StaffingGapsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetShifts.mockResolvedValue({ shifts: [shortShift], total: 1, skip: 0, limit: 200 });
    mockCreateAssignment.mockResolvedValue({ id: 'assignment-1' });
    departmentTimezone = 'UTC';
  });

  it('lists a short shift with the seats that are empty on it', async () => {
    renderWithRouter(<StaffingGapsSection />);

    expect(await screen.findByText(/1 of 2 open/)).toBeInTheDocument();
    expect(screen.getByText(/Engine 1/)).toBeInTheDocument();
    expect(screen.getByText(/1 shift short · 1 seat open/)).toBeInTheDocument();
  });

  it('assigns the member into the seat that was picked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingGapsSection />);
    await screen.findByText(/1 of 2 open/);

    await user.selectOptions(screen.getByLabelText('Assign a member'), 'user-2');
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(mockCreateAssignment).toHaveBeenCalledWith('shift-1', { user_id: 'user-2', position: 'driver' })
    );
  });

  // The advisory warnings are not refusals, and the shift drawer surfaces them
  // from the same response fields. Losing them here would make this the one
  // screen that seats somebody over an overtime limit silently.
  it('surfaces the advisories the server returns with the assignment', async () => {
    mockCreateAssignment.mockResolvedValue({
      id: 'assignment-1',
      evoc_warnings: [{ message: 'No current EVOC on file.' }],
      overtime_warnings: ['Over 48 hours this week.'],
    });
    const user = userEvent.setup();
    renderWithRouter(<StaffingGapsSection />);
    await screen.findByText(/1 of 2 open/);

    await user.selectOptions(screen.getByLabelText('Assign a member'), 'user-1');
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('No current EVOC on file. Over 48 hours this week.', { icon: '⚠️' })
    );
  });

  // An empty list and "nothing is short" are the same picture, and one of them
  // is a claim an officer would act on.
  it('says the range did not load rather than showing an empty list', async () => {
    mockGetShifts.mockRejectedValue(new Error('nope'));
    renderWithRouter(<StaffingGapsSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/);
    expect(screen.queryByText(/has the crew it asks for/)).not.toBeInTheDocument();
  });

  // The browser's calendar day and the department's are not the same day around
  // midnight. Deriving the default range from the browser's put a UTC viewer of
  // an America/Los_Angeles department on tomorrow, and the opposite offset drops
  // the department's own current day — hiding a shift that is short *today*,
  // which is the one this page exists to surface.
  it('opens on the department\u2019s calendar day, not the browser\u2019s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 04:00 UTC on the 6th is 21:00 on the 5th in Los Angeles: the browser has
    // rolled over to a day the department has not reached.
    vi.setSystemTime(new Date('2026-09-06T04:00:00Z'));
    departmentTimezone = 'America/Los_Angeles';

    renderWithRouter(<StaffingGapsSection />);

    await waitFor(() => expect(mockGetShifts).toHaveBeenCalled());
    expect(mockGetShifts).toHaveBeenCalledWith(
      expect.objectContaining({ start_date: '2026-09-05', end_date: '2026-09-19' })
    );
    vi.useRealTimers();
  });

  // A reversed range is not an empty range. The endpoint applies both bounds and
  // returns nothing, which this screen would present as a staffing assurance.
  it('refuses to read a reversed range rather than calling the range staffed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingGapsSection />);
    await screen.findByText(/Engine 1/);
    mockGetShifts.mockClear();

    await user.clear(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), '2099-12-31');

    expect(await screen.findByRole('alert')).toHaveTextContent(/earlier than/);
    expect(screen.queryByText(/has the crew it asks for/)).not.toBeInTheDocument();
    expect(mockGetShifts).not.toHaveBeenCalledWith(expect.objectContaining({ start_date: '2099-12-31' }));
  });

  // One page is the cap. Left unsaid it reads as the whole answer — and here the
  // whole answer is an assurance that every shift has the crew it asks for.
  it('says the range was cut short rather than calling the rest staffed', async () => {
    mockGetShifts.mockResolvedValue({ shifts: [shortShift], total: 412, skip: 0, limit: 200 });

    renderWithRouter(<StaffingGapsSection />);

    expect(await screen.findByText(/more shifts than one screen reads/)).toBeInTheDocument();
  });

  it('does not claim the range is staffed when it was cut short', async () => {
    mockGetShifts.mockResolvedValue({ shifts: [], total: 412, skip: 0, limit: 200 });

    renderWithRouter(<StaffingGapsSection />);

    await screen.findByText(/more shifts than one screen reads/);
    expect(screen.queryByText(/has the crew it asks for/)).not.toBeInTheDocument();
  });

  // Two ranges in flight and the slower, older one lands last: the date controls
  // then describe one range while the list describes another, and nothing on
  // screen says so.
  it('ignores a response that a newer range has already superseded', async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    mockGetShifts.mockReset();
    mockGetShifts
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        })
      )
      .mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 200 });

    const user = userEvent.setup();
    renderWithRouter(<StaffingGapsSection />);
    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2099-01-01');

    // The first range finally answers, with a shift the newer range excludes.
    await act(async () => {
      releaseFirst({ shifts: [shortShift], total: 1, skip: 0, limit: 200 });
    });

    expect(await screen.findByText(/has the crew it asks for/)).toBeInTheDocument();
    expect(screen.queryByText(/Engine 1/)).not.toBeInTheDocument();
  });

  it('says so plainly when every shift in the range is staffed', async () => {
    mockGetShifts.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 200 });
    renderWithRouter(<StaffingGapsSection />);

    expect(await screen.findByText(/has the crew it asks for/)).toBeInTheDocument();
  });
});
