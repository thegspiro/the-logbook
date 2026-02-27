import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import Dashboard from './Dashboard';
import type { ShiftRecord } from '../services/api';

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock API services
const { mockGetMyShifts, mockGetOpenShifts, mockSignupForShift } = vi.hoisted(() => ({
  mockGetMyShifts: vi.fn(),
  mockGetOpenShifts: vi.fn(),
  mockSignupForShift: vi.fn(),
}));

vi.mock('../services/api', () => ({
  schedulingService: {
    getMyShifts: mockGetMyShifts,
    getOpenShifts: mockGetOpenShifts,
    getSummary: vi.fn().mockResolvedValue({ total_shifts: 0, shifts_this_week: 0, shifts_this_month: 0, total_hours_this_month: 0 }),
    signupForShift: mockSignupForShift,
  },
  notificationsService: {
    getLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
  },
  messagesService: {
    getInbox: vi.fn().mockResolvedValue([]),
  },
  trainingProgramService: {
    getMyEnrollments: vi.fn().mockResolvedValue({ items: [] }),
  },
  trainingModuleConfigService: {
    getMyTraining: vi.fn().mockResolvedValue({ hours_summary: { total_hours: 0 } }),
  },
  organizationService: {
    getSetupChecklist: vi.fn().mockResolvedValue({ completed_count: 0, total_count: 0 }),
  },
  inventoryService: {
    getSummary: vi.fn().mockResolvedValue({ total_items: 0, total_value: 0, active_checkouts: 0, overdue_checkouts: 0, maintenance_due_count: 0 }),
    getLowStockItems: vi.fn().mockResolvedValue([]),
  },
  dashboardService: {
    getStats: vi.fn().mockResolvedValue({}),
    getAdminSummary: vi.fn().mockResolvedValue({}),
    getActionItems: vi.fn().mockResolvedValue([]),
    getCommunityEngagement: vi.fn().mockResolvedValue({}),
    getBranding: vi.fn().mockResolvedValue({ name: 'Test FD' }),
  },
}));

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursEntryService: {
    getSummary: vi.fn().mockResolvedValue({ totalHours: 0 }),
  },
}));

// Mock auth store
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: vi.fn().mockReturnValue(false),
    user: { id: 'user-1', first_name: 'Test', last_name: 'User', organization_id: 'org-1' },
  }),
}));

// Mock timezone hook
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Mock PWA install hook
vi.mock('../hooks/usePWAInstall', () => ({
  usePWAInstall: () => ({ canInstall: false, install: vi.fn() }),
}));

// Mock relative time hook
vi.mock('../hooks/useRelativeTime', () => ({
  formatRelativeTime: (date: string) => date,
}));

const makeShift = (overrides: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 'shift-1',
  organization_id: 'org-1',
  shift_date: '2026-03-15',
  start_time: '08:00',
  end_time: '16:00',
  attendee_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });
    mockGetOpenShifts.mockResolvedValue([]);
    mockSignupForShift.mockResolvedValue({});
  });

  describe('My Upcoming Shifts', () => {
    it('should display "My Upcoming Shifts" heading', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('My Upcoming Shifts')).toBeInTheDocument();
      });
    });

    it('should show empty state when no shifts are assigned', async () => {
      mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });

      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('No upcoming shifts scheduled')).toBeInTheDocument();
      });
    });

    it('should render user\'s assigned shifts', async () => {
      mockGetMyShifts.mockResolvedValue({
        shifts: [
          makeShift({ id: 'my-1', shift_date: '2026-03-15', start_time: '08:00', end_time: '16:00', shift_officer_name: 'Capt. Smith' }),
        ],
        total: 1,
      });

      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('Officer: Capt. Smith')).toBeInTheDocument();
      });
    });

    it('should call getMyShifts, not getShifts', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetMyShifts).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Open Shifts', () => {
    it('should display "Open Shifts" heading', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('Open Shifts')).toBeInTheDocument();
      });
    });

    it('should show empty state when no open shifts are available', async () => {
      mockGetOpenShifts.mockResolvedValue([]);

      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('No open shifts available')).toBeInTheDocument();
      });
    });

    it('should render open shifts with sign up buttons', async () => {
      mockGetOpenShifts.mockResolvedValue([
        makeShift({ id: 'open-1', shift_date: '2026-03-20', min_staffing: 4, attendee_count: 1 }),
      ]);

      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText('1/4 filled')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
      });
    });

    it('should call signupForShift when sign up button is clicked', async () => {
      mockGetOpenShifts.mockResolvedValue([
        makeShift({ id: 'open-1', shift_date: '2026-03-20' }),
      ]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /sign up/i }));

      await waitFor(() => {
        expect(mockSignupForShift).toHaveBeenCalledWith('open-1', { position: 'general' });
      });
    });

    it('should refresh both lists after successful signup', async () => {
      mockGetOpenShifts.mockResolvedValue([
        makeShift({ id: 'open-1', shift_date: '2026-03-20' }),
      ]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
      });

      // Clear initial load call counts
      mockGetMyShifts.mockClear();
      mockGetOpenShifts.mockClear();

      await user.click(screen.getByRole('button', { name: /sign up/i }));

      await waitFor(() => {
        expect(mockGetMyShifts).toHaveBeenCalled();
        expect(mockGetOpenShifts).toHaveBeenCalled();
      });
    });

    it('should call getOpenShifts on mount', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetOpenShifts).toHaveBeenCalledTimes(1);
      });
    });
  });
});
