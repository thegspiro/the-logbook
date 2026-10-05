import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { MyShiftsTab } from './MyShiftsTab';

// Mock API services
const mockGetMyAssignments = vi.fn();
const mockGetMyShifts = vi.fn();
const mockConfirmAssignment = vi.fn();
const mockDeclineAssignment = vi.fn();
const mockUpdateAssignment = vi.fn();
const mockGetOpenShifts = vi.fn();
const mockGetMyHoursHistory = vi.fn();
const mockGetExchangeCandidates = vi.fn();
const mockCreateSwapRequest = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyAssignments: (...args: unknown[]) => mockGetMyAssignments(...args) as unknown,
    getMyShifts: (...args: unknown[]) => mockGetMyShifts(...args) as unknown,
    confirmAssignment: (...args: unknown[]) => mockConfirmAssignment(...args) as unknown,
    declineAssignment: (...args: unknown[]) => mockDeclineAssignment(...args) as unknown,
    updateAssignment: (...args: unknown[]) => mockUpdateAssignment(...args) as unknown,
    getOpenShifts: (...args: unknown[]) => mockGetOpenShifts(...args) as unknown,
    getMyHoursHistory: (...args: unknown[]) => mockGetMyHoursHistory(...args) as unknown,
    // loadData awaits this alongside getMyAssignments; without it the call
    // throws and the whole load falls into its catch, leaving an empty list.
    getMyAttendanceHistory: vi.fn().mockResolvedValue([]),
    getShifts: vi.fn().mockResolvedValue({ shifts: [], total: 0 }),
    createSwapRequest: (...args: unknown[]) => mockCreateSwapRequest(...args) as unknown,
    getExchangeCandidates: (...args: unknown[]) => mockGetExchangeCandidates(...args) as unknown,
    createTimeOff: vi.fn().mockResolvedValue({}),
  },
}));

// Mock auth store
vi.mock('../../stores/authStore', () => {
  // A member with no scheduling grants at all — the viewer whose Decline used
  // to 403.
  const state = {
    checkPermission: () => false,
    user: { id: 'user-1', first_name: 'Test', last_name: 'User', platoon: 'A' },
  };
  const useAuthStore = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  // Rendering an assignment row reaches the store outside React via
  // getState(); without it the row throws and the list silently renders empty.
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('MyShiftsTab', () => {
  const mockOnViewShift = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMyAssignments.mockResolvedValue([]);
    mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });
    mockGetMyHoursHistory.mockReset();
    mockGetMyHoursHistory.mockResolvedValue({
      year: 2026,
      earliest_year: 2026,
      timezone: 'America/New_York',
      months: Array.from({ length: 12 }, (_, i) => ({
        year: 2026,
        month: i + 1,
        shifts: 0,
        hours: 0,
        calls: 0,
        pending_shifts: 0,
        pending_hours: 0,
      })),
      totals: { shifts: 0, hours: 0, calls: 0, pending_shifts: 0, pending_hours: 0 },
      all_time: { shifts: 0, hours: 0, calls: 0, pending_shifts: 0, pending_hours: 0 },
      current_month: { year: 2026, month: 2, shifts: 0, hours: 0, calls: 0, pending_shifts: 0, pending_hours: 0 },
      previous_month: { year: 2026, month: 1, shifts: 0, hours: 0, calls: 0, pending_shifts: 0, pending_hours: 0 },
    });
  });

  describe('declining your own assignment', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // This block runs on a member with no scheduling grants at all
    // (checkPermission is mocked false above), which is the whole point:
    // Decline used to go through updateAssignment, whose route requires
    // scheduling.assign or being the shift's officer, so it answered 403 for
    // exactly this viewer while Confirm beside it worked.
    const assignment = {
      id: 'assign-1',
      user_id: 'user-1',
      shift_id: 'shift-1',
      position: 'firefighter',
      assignment_status: 'assigned',
      status: 'assigned',
      shift: {
        id: 'shift-1',
        // Relative to now: the tab lists Upcoming, so a fixed date would
        // quietly stop rendering the row the day it went past and the test
        // would pass against an empty list.
        shift_date: futureDate.slice(0, 10),
        start_time: `${futureDate.slice(0, 10)}T07:00:00Z`,
        end_time: `${futureDate.slice(0, 10)}T19:00:00Z`,
        attendee_count: 4,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        organization_id: '1',
      },
    };

    beforeEach(() => {
      mockDeclineAssignment.mockReset();
      mockDeclineAssignment.mockResolvedValue({ ...assignment, assignment_status: 'declined' });
      mockUpdateAssignment.mockReset();
      mockGetMyAssignments.mockResolvedValue([assignment]);
    });

    it('calls the self-scoped decline endpoint, not the officer update path', async () => {
      const user = userEvent.setup();
      renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

      await waitFor(() => {
        expect(screen.getByText(/^Upcoming/)).toBeInTheDocument();
      });

      // Two steps: the row's Decline arms the confirmation, "Yes" commits it.
      await user.click(await screen.findByRole('button', { name: /^Decline shift on / }));
      await user.click(await screen.findByRole('button', { name: 'Confirm decline' }));

      await waitFor(() => {
        expect(mockDeclineAssignment).toHaveBeenCalledWith('assign-1');
      });
      expect(mockUpdateAssignment).not.toHaveBeenCalled();
    });
  });

  it('should render and resolve loading state', async () => {
    renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);
    // Mocked API resolves immediately, so the component transitions
    // from loading to the loaded view within the same tick.
    await waitFor(() => {
      expect(screen.getByText(/^Upcoming/)).toBeInTheDocument();
    });
  });

  it('should render empty state when no shifts', async () => {
    mockGetMyAssignments.mockResolvedValue([]);
    mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });

    renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(screen.getByText(/^Upcoming/)).toBeInTheDocument();
    });
  });

  it('should render shift assignments when loaded', async () => {
    mockGetMyAssignments.mockResolvedValue([
      {
        id: 'assign-1',
        user_id: 'user-1',
        shift_id: 'shift-1',
        position: 'firefighter',
        assignment_status: 'assigned',
        status: 'assigned',
        shift: {
          id: 'shift-1',
          shift_date: '2026-03-01',
          start_time: '2026-03-01T07:00:00Z',
          end_time: '2026-03-01T19:00:00Z',
          attendee_count: 4,
          created_at: '2026-02-25T00:00:00Z',
          updated_at: '2026-02-25T00:00:00Z',
          organization_id: '1',
        },
      },
    ]);

    renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(screen.getByText(/^Upcoming/)).toBeInTheDocument();
    });
  });

  it('swaps the shift list for the hours summary on the Hours view', async () => {
    const user = userEvent.setup();
    mockGetMyAssignments.mockResolvedValue([]);

    renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(screen.getByText('No upcoming shifts')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Hours' }));

    expect(await screen.findByText('My Hours')).toBeInTheDocument();
    expect(screen.queryByText('No upcoming shifts')).not.toBeInTheDocument();
  });

  it('should show view toggle for upcoming and past shifts', async () => {
    mockGetMyAssignments.mockResolvedValue([]);

    renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(screen.getByText(/^Upcoming/)).toBeInTheDocument();
      expect(screen.getByText(/^Past/)).toBeInTheDocument();
    });
  });

  describe('row actions', () => {
    const day = (offset: number) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row = (id: string, date: string) => ({
      id,
      user_id: 'user-1',
      shift_id: `shift-${id}`,
      position: 'firefighter',
      assignment_status: 'assigned',
      status: 'assigned',
      shift: {
        id: `shift-${id}`,
        shift_date: date,
        start_time: `${date}T12:00:00Z`,
        end_time: `${date}T23:00:00Z`,
        attendee_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        organization_id: '1',
      },
    });

    beforeEach(() => {
      mockGetMyAssignments.mockReset();
      mockGetMyAssignments.mockResolvedValue([row('a', day(5)), row('b', day(8))]);
    });

    it('names every action after its own shift', async () => {
      renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

      for (const verb of ['Confirm', 'Decline', 'Swap', 'Details for']) {
        const buttons = await screen.findAllByRole('button', { name: new RegExp(`^${verb} shift on `) });
        expect(buttons).toHaveLength(2);
        expect(buttons[0]?.getAttribute('aria-label')).not.toBe(buttons[1]?.getAttribute('aria-label'));
      }
    });

    it('says which swap type is chosen, and does not promise another member will take it', async () => {
      const user = userEvent.setup();
      renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

      const [swap] = await screen.findAllByRole('button', { name: /^Swap shift on / });
      await user.click(swap as HTMLElement);

      const group = await screen.findByRole('group', { name: 'Swap Type' });
      const open = within(group).getByRole('button', { name: /Open Swap/ });
      const specific = within(group).getByRole('button', { name: /Specific Shift/ });
      expect(open).toHaveAttribute('aria-pressed', 'true');
      expect(specific).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByText(/Any member can pick it up/)).not.toBeInTheDocument();

      await user.click(specific);
      expect(specific).toHaveAttribute('aria-pressed', 'true');
      expect(open).toHaveAttribute('aria-pressed', 'false');
    });

    describe('exchanging with a member', () => {
      beforeEach(() => {
        mockCreateSwapRequest.mockReset();
        mockCreateSwapRequest.mockResolvedValue({});
        mockGetExchangeCandidates.mockReset();
        mockGetExchangeCandidates.mockResolvedValue([
          {
            shift_id: 'shift-z',
            shift_date: day(12),
            start_time: `${day(12)}T12:00:00Z`,
            user_id: 'user-9',
            user_name: 'Sam Ortiz',
            position: 'firefighter',
          },
        ]);
      });

      it('lists only what the server offers and sends a two-way exchange', async () => {
        const user = userEvent.setup();
        renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

        const [swap] = await screen.findAllByRole('button', { name: /^Swap shift on / });
        await user.click(swap as HTMLElement);
        await user.click(await screen.findByRole('button', { name: /Exchange With a Member/ }));

        const picker = await screen.findByLabelText('Exchange With');
        expect(within(picker).getAllByRole('option')).toHaveLength(1);
        expect(within(picker).getByRole('option', { name: /Sam Ortiz/ })).toBeInTheDocument();
        expect(mockGetExchangeCandidates).toHaveBeenCalledWith('shift-a');

        await user.click(screen.getByRole('button', { name: 'Submit Request' }));

        await waitFor(() => {
          expect(mockCreateSwapRequest).toHaveBeenCalledWith({
            offering_shift_id: 'shift-a',
            requesting_shift_id: 'shift-z',
            target_user_id: 'user-9',
            reason: undefined,
          });
        });
      });

      it('says so when nobody qualifies, and will not submit', async () => {
        mockGetExchangeCandidates.mockResolvedValue([]);
        const user = userEvent.setup();
        renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

        const [swap] = await screen.findAllByRole('button', { name: /^Swap shift on / });
        await user.click(swap as HTMLElement);
        await user.click(await screen.findByRole('button', { name: /Exchange With a Member/ }));

        expect(await screen.findByText(/No upcoming seat you could exchange for/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Submit Request' })).toBeDisabled();
      });
    });
  });
});
