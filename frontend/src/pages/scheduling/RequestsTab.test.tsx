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

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getSwapRequests: (...args: unknown[]) => mockGetSwapRequests(...args) as unknown,
    getTimeOffRequests: (...args: unknown[]) => mockGetTimeOffRequests(...args) as unknown,
    reviewSwapRequest: (...args: unknown[]) => mockReviewSwapRequest(...args) as unknown,
    reviewTimeOff: (...args: unknown[]) => mockReviewTimeOff(...args) as unknown,
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
    // Clear queued pages as well as call history without resetting unrelated
    // module mocks owned by the shared test environment.
    mockGetSwapRequests.mockReset();
    mockGetTimeOffRequests.mockReset();
    mockReviewSwapRequest.mockReset();
    mockReviewTimeOff.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockGetSwapRequests.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
    mockGetTimeOffRequests.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
  });

  it('should render swap and time-off view toggles', async () => {
    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(screen.getByText(/Swap Requests/)).toBeInTheDocument();
      expect(screen.getByText(/Time Off/)).toBeInTheDocument();
    });
  });

  it('should render the view toggles before data loads', () => {
    renderWithRouter(<RequestsTab />);
    expect(screen.getByText(/Swap Requests/)).toBeInTheDocument();
    expect(screen.getByText(/Time Off/)).toBeInTheDocument();
  });

  it('should render empty state for swap requests after loading', async () => {
    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(screen.getByText('No swap requests')).toBeInTheDocument();
    });
  });

  it('should render swap requests when loaded', async () => {
    mockGetSwapRequests.mockResolvedValue({
      items: [
        {
          id: 'swap-1',
          requesting_user_id: 'user-1',
          user_name: 'John Smith',
          offering_shift_id: 'shift-1',
          status: 'pending',
          reason: 'Family event',
          created_at: '2026-02-25T00:00:00Z',
        },
      ],
      total: 1,
      skip: 0,
      limit: 20,
    });

    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(screen.getByText(/pending/i)).toBeInTheDocument();
    });
  });

  it('should switch to time off view', async () => {
    renderWithRouter(<RequestsTab />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText(/Time Off/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Time Off/));

    await waitFor(() => {
      // Time off view should now be active
      expect(screen.getByText(/Time Off/)).toBeInTheDocument();
    });
  });

  it('should show swap requests for admin users after loading', async () => {
    mockCheckPermission.mockReturnValue(true);
    mockGetSwapRequests.mockResolvedValue({
      items: [
        {
          id: 'swap-1',
          requesting_user_id: 'user-2',
          user_name: 'Jane Doe',
          offering_shift_id: 'shift-1',
          status: 'pending',
          created_at: '2026-02-25T00:00:00Z',
        },
      ],
      total: 1,
      skip: 0,
      limit: 20,
    });

    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(screen.getByText(/pending/i)).toBeInTheDocument();
    });
  });

  it('should render status filter', async () => {
    renderWithRouter(<RequestsTab />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });

  it('gives the status filter an explicit desktop width', async () => {
    // Same defect as the Open Shifts date filter: `form-input` is w-full, so
    // under `sm:flex-none` the control overflowed its row by the width of the
    // filter icon beside it and spilled past the page's right edge.
    renderWithRouter(<RequestsTab />);
    const select = await screen.findByLabelText('Filter requests by status');
    expect(select.className).toMatch(/sm:w-\S+/);
  });

  it('displays server totals and loads a second page', async () => {
    mockGetSwapRequests
      .mockResolvedValueOnce({
        items: [{ id: 'swap-1', offering_shift_id: 'shift-1', status: 'pending', created_at: '2026-02-25' }],
        total: 2,
        skip: 0,
        limit: 20,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'swap-2', offering_shift_id: 'shift-2', status: 'pending', created_at: '2026-02-24' }],
        total: 2,
        skip: 1,
        limit: 20,
      });
    const user = userEvent.setup();
    renderWithRouter(<RequestsTab />);

    expect((await screen.findByText(/Swap Requests/)).closest('button')).toHaveTextContent('(2)');
    await user.click(await screen.findByRole('button', { name: /load more swap requests/i }));
    await waitFor(() =>
      expect(mockGetSwapRequests).toHaveBeenLastCalledWith({ status: 'pending', skip: 1, limit: 20 })
    );
    expect(screen.getAllByText(/Offering shift \(details unavailable\)/i)).toHaveLength(2);
  });

  it('resets pagination when the status filter changes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RequestsTab />);
    await waitFor(() => expect(mockGetSwapRequests).toHaveBeenCalled());

    await user.selectOptions(screen.getByLabelText('Filter requests by status'), 'approved');

    await waitFor(() =>
      expect(mockGetSwapRequests).toHaveBeenLastCalledWith({ status: 'approved', skip: 0, limit: 20 })
    );
  });

  it('resets pagination when the request type changes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RequestsTab />);
    await waitFor(() => expect(mockGetTimeOffRequests).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /time off/i }));

    await waitFor(() => {
      expect(mockGetTimeOffRequests).toHaveBeenCalledTimes(2);
      expect(mockGetTimeOffRequests).toHaveBeenLastCalledWith({ status: 'pending', skip: 0, limit: 20 });
    });
  });
});
