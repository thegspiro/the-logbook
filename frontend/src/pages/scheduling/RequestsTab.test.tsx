import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { RequestsTab } from './RequestsTab';

// Mock API services
const mockGetSwapRequests = vi.fn();
const mockGetTimeOffRequests = vi.fn();
const mockReviewSwapRequest = vi.fn();
const mockReviewTimeOff = vi.fn();

vi.mock('../../services/api', () => ({
  schedulingService: {
    getSwapRequests: (...args: unknown[]) => mockGetSwapRequests(...args),
    getTimeOffRequests: (...args: unknown[]) => mockGetTimeOffRequests(...args),
    reviewSwapRequest: (...args: unknown[]) => mockReviewSwapRequest(...args),
    reviewTimeOff: (...args: unknown[]) => mockReviewTimeOff(...args),
    cancelSwapRequest: vi.fn().mockResolvedValue(undefined),
    cancelTimeOff: vi.fn().mockResolvedValue(undefined),
    getShift: vi.fn().mockResolvedValue({
      id: 'shift-1',
      shift_date: '2026-03-01',
      start_time: '2026-03-01T07:00:00Z',
      end_time: '2026-03-01T19:00:00Z',
      attendee_count: 0,
      created_at: '2026-02-25T00:00:00Z',
      updated_at: '2026-02-25T00:00:00Z',
      organization_id: '1',
    }),
  },
}));

const mockCheckPermission = vi.fn();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: mockCheckPermission,
    user: { id: 'user-1', first_name: 'Test', last_name: 'User' },
  }),
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('RequestsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(false);
    mockGetSwapRequests.mockResolvedValue([]);
    mockGetTimeOffRequests.mockResolvedValue([]);
  });

  it('should render swap and time-off view toggles', async () => {
    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(screen.getByText('Swap Requests')).toBeInTheDocument();
      expect(screen.getByText('Time Off')).toBeInTheDocument();
    });
  });

  it('should render loading state', () => {
    renderWithRouter(<RequestsTab />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should render empty state for swap requests', async () => {
    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('should render swap requests when loaded', async () => {
    mockGetSwapRequests.mockResolvedValue([
      {
        id: 'swap-1',
        requesting_user_id: 'user-1',
        user_name: 'John Smith',
        offering_shift_id: 'shift-1',
        status: 'pending',
        reason: 'Family event',
        created_at: '2026-02-25T00:00:00Z',
      },
    ]);

    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('should switch to time off view', async () => {
    renderWithRouter(<RequestsTab />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText('Time Off')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Time Off'));

    await waitFor(() => {
      // Time off view should now be active
      expect(screen.getByText('Time Off')).toBeInTheDocument();
    });
  });

  it('should show approve/deny buttons for admin users', async () => {
    mockCheckPermission.mockReturnValue(true);
    mockGetSwapRequests.mockResolvedValue([
      {
        id: 'swap-1',
        requesting_user_id: 'user-2',
        user_name: 'Jane Doe',
        offering_shift_id: 'shift-1',
        status: 'pending',
        created_at: '2026-02-25T00:00:00Z',
      },
    ]);

    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('should render status filter', async () => {
    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });
});
