import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { MyShiftsTab } from './MyShiftsTab';

// Mock API services
const mockGetMyAssignments = vi.fn();
const mockGetMyShifts = vi.fn();
const mockConfirmAssignment = vi.fn();
const mockGetOpenShifts = vi.fn();
const mockGetMyHoursHistory = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyAssignments: (...args: unknown[]) => mockGetMyAssignments(...args) as unknown,
    getMyShifts: (...args: unknown[]) => mockGetMyShifts(...args) as unknown,
    confirmAssignment: (...args: unknown[]) => mockConfirmAssignment(...args) as unknown,
    getOpenShifts: (...args: unknown[]) => mockGetOpenShifts(...args) as unknown,
    getMyHoursHistory: (...args: unknown[]) => mockGetMyHoursHistory(...args) as unknown,
    getShifts: vi.fn().mockResolvedValue({ shifts: [], total: 0 }),
    createSwapRequest: vi.fn().mockResolvedValue({}),
    createTimeOff: vi.fn().mockResolvedValue({}),
  },
}));

// Mock auth store
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      checkPermission: () => false,
      user: { id: 'user-1', first_name: 'Test', last_name: 'User', platoon: 'A' },
    };
    return selector ? selector(state) : state;
  },
}));

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
      current_month: { year: 2026, month: 2, shifts: 0, hours: 0, calls: 0, pending_shifts: 0, pending_hours: 0 },
      previous_month: { year: 2026, month: 1, shifts: 0, hours: 0, calls: 0, pending_shifts: 0, pending_hours: 0 },
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
});
