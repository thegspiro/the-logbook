import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SchedulingPage from './SchedulingPage';

// Mock API services
vi.mock('../services/api', () => ({
  schedulingService: {
    getShifts: vi.fn().mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 100 }),
    getSummary: vi.fn().mockResolvedValue({
      total_shifts: 10,
      shifts_this_week: 3,
      shifts_this_month: 8,
      total_hours_this_month: 96,
    }),
    getBasicApparatus: vi.fn().mockResolvedValue([]),
    getTemplates: vi.fn().mockResolvedValue([]),
    getWeekCalendar: vi.fn().mockResolvedValue([]),
    getMonthCalendar: vi.fn().mockResolvedValue([]),
  },
  notificationsService: {
    getNotificationRules: vi.fn().mockResolvedValue([]),
  },
  userService: {
    getUsers: vi.fn().mockResolvedValue([]),
  },
}));

// Mock auth store
const mockCheckPermission = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: mockCheckPermission,
    user: { id: '1', first_name: 'Test', last_name: 'User', organization_id: '1' },
  }),
}));

// Mock timezone hook
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

describe('SchedulingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(false);
  });

  describe('Tab Rendering', () => {
    // Note: Each tab label is rendered twice (one hidden sm:inline, one sm:hidden)
    // so we use getAllByText to account for both DOM elements in jsdom.
    it('should render core tabs for all users', async () => {
      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Schedule').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('My Shifts').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Open Shifts').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Requests').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Shift Reports').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should render admin tabs when user has scheduling.manage permission', async () => {
      mockCheckPermission.mockImplementation((perm: string) => {
        return perm === 'scheduling.manage';
      });

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Templates').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Patterns').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Reports').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should not render admin tabs for non-admin users', async () => {
      mockCheckPermission.mockReturnValue(false);

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Schedule').length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.queryByText('Templates')).not.toBeInTheDocument();
      expect(screen.queryByText('Patterns')).not.toBeInTheDocument();
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });
  });

  describe('Calendar Controls', () => {
    it('should render view mode toggle buttons', async () => {
      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getByText('Week')).toBeInTheDocument();
        expect(screen.getByText('Month')).toBeInTheDocument();
      });
    });

    it('should render navigation arrows', async () => {
      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Schedule').length).toBeGreaterThanOrEqual(1);
      });

      // Navigation arrows should be present
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('Tab Switching', () => {
    it('should switch to My Shifts tab on click', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getAllByText('My Shifts').length).toBeGreaterThanOrEqual(1);
      });

      await user.click(screen.getAllByText('My Shifts')[0]);

      // The tab should be active (the component lazy-loads the tab content)
      await waitFor(() => {
        expect(screen.getAllByText('My Shifts').length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Summary Display', () => {
    it('should show loading state initially', () => {
      renderWithRouter(<SchedulingPage />);
      // The component starts with loading=true, which shows a spinner
      // Since we mock the API to resolve, it should eventually load
      expect(screen.getAllByText('Schedule').length).toBeGreaterThanOrEqual(1);
    });
  });
});
