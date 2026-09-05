/**
 * The gaps workspace: what it lists, and what it does when an officer fills one.
 *
 * `staffingGaps.test.ts` covers which shifts count as short. This is about the
 * screen — that a failed fetch says so rather than showing an empty list, that
 * the assignment reaches the server with the seat that was picked, and that the
 * advisory warnings the server returns are not dropped on the way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

  it('says so plainly when every shift in the range is staffed', async () => {
    mockGetShifts.mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 200 });
    renderWithRouter(<StaffingGapsSection />);

    expect(await screen.findByText(/has the crew it asks for/)).toBeInTheDocument();
  });
});
