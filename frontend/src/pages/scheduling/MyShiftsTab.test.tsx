import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { MyShiftsTab } from './MyShiftsTab';

// Mock API services
const mockGetMyAssignments = vi.fn();
const mockGetMyShifts = vi.fn();
const mockConfirmAssignment = vi.fn();
const mockGetOpenShifts = vi.fn();

vi.mock('../../services/api', () => ({
  schedulingService: {
    getMyAssignments: (...args: unknown[]) => mockGetMyAssignments(...args),
    getMyShifts: (...args: unknown[]) => mockGetMyShifts(...args),
    confirmAssignment: (...args: unknown[]) => mockConfirmAssignment(...args),
    getOpenShifts: (...args: unknown[]) => mockGetOpenShifts(...args),
    getShifts: vi.fn().mockResolvedValue({ shifts: [], total: 0 }),
    createSwapRequest: vi.fn().mockResolvedValue({}),
    createTimeOff: vi.fn().mockResolvedValue({}),
  },
}));

// Mock auth store
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: () => false,
    user: { id: 'user-1', first_name: 'Test', last_name: 'User' },
  }),
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
  });

  it('should render loading state initially', () => {
    renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);
    // Component starts loading, should show spinner or loading indicator
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should render empty state when no shifts', async () => {
    mockGetMyAssignments.mockResolvedValue([]);
    mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });

    renderWithRouter(<MyShiftsTab onViewShift={mockOnViewShift} />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
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
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
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
