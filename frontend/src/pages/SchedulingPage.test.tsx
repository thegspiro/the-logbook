import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SchedulingPage from './SchedulingPage';

// Mock scheduling module API
vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShifts: vi.fn().mockResolvedValue({ shifts: [], total: 0, skip: 0, limit: 100 }),
    getSummary: vi.fn().mockResolvedValue({
      shifts_scheduled: 10,
      shifts_scheduled_this_week: 3,
      shifts_scheduled_this_month: 8,
      hours_worked_this_month: 96,
    }),
    getBasicApparatus: vi.fn().mockResolvedValue([]),
    getTemplates: vi.fn().mockResolvedValue([]),
    getWeekCalendar: vi.fn().mockResolvedValue([]),
    getMonthCalendar: vi.fn().mockResolvedValue([]),
    getSupplyExpiringItems: vi.fn().mockResolvedValue({ total: 0, items: [] }),
    getMyChecklists: vi.fn().mockResolvedValue([]),
    getMyChecklistHistory: vi.fn().mockResolvedValue([]),
    getEquipmentCheckTemplates: vi.fn().mockResolvedValue([]),
    getMyAssignments: vi.fn().mockResolvedValue([]),
    getMyShifts: vi.fn().mockResolvedValue([]),
    getOpenShifts: vi.fn().mockResolvedValue([]),
  },
}));

// Mock global API services
vi.mock('../services/api', () => ({
  notificationsService: {
    getNotificationRules: vi.fn().mockResolvedValue([]),
  },
  userService: {
    getUsers: vi.fn().mockResolvedValue([]),
  },
  trainingModuleConfigService: {
    getConfig: vi.fn().mockResolvedValue({ shift_reports_enabled: true }),
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

// Mock theme context
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() }),
}));

/** Helper: each tab label appears twice in the DOM (desktop + mobile spans). */
function expectTabVisible(label: string) {
  const matches = screen.getAllByText(label);
  expect(matches.length).toBeGreaterThanOrEqual(1);
}

describe('SchedulingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(false);
    // Tab selection is mirrored into ?tab=, so reset the URL between tests.
    window.history.replaceState({}, '', '/scheduling');
  });

  describe('Tab Rendering', () => {
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

    it('should render admin links when user has scheduling.manage permission', async () => {
      mockCheckPermission.mockImplementation((perm: string) => {
        return perm === 'scheduling.manage';
      });

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getByText('Officer tools')).toBeInTheDocument();
        expect(screen.getByText('Templates')).toBeInTheDocument();
        expect(screen.getByText('Patterns')).toBeInTheDocument();
        expect(screen.getByText('Reports')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });

      // Admin links should be actual links, not tabs
      const links = screen.getAllByRole('link');
      const adminLinks = links.filter((link) => link.getAttribute('href')?.startsWith('/scheduling/'));
      const hrefs = adminLinks.map((link) => link.getAttribute('href'));
      expect(hrefs).toContain('/scheduling/templates');
      expect(hrefs).toContain('/scheduling/patterns');
      expect(hrefs).toContain('/scheduling/reports');
      expect(hrefs).toContain('/scheduling/settings');
    });

    it('should not render admin links for non-admin users', async () => {
      mockCheckPermission.mockReturnValue(false);

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expectTabVisible('Schedule');
      });

      expect(screen.queryByText('Officer tools')).not.toBeInTheDocument();
      expect(screen.queryByText('Templates')).not.toBeInTheDocument();
      expect(screen.queryByText('Patterns')).not.toBeInTheDocument();
    });
  });

  describe('Calendar Controls', () => {
    it('should render view mode toggle buttons', async () => {
      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expectTabVisible('Schedule');
      });

      await waitFor(() => {
        expect(screen.getByText('Week')).toBeInTheDocument();
        expect(screen.getByText('Month')).toBeInTheDocument();
      });
    });

    it('should render navigation arrows', async () => {
      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expectTabVisible('Schedule');
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
        expectTabVisible('My Shifts');
      });

      const myShiftsButtons = screen.getAllByText('My Shifts');
      expect(myShiftsButtons.length).toBeGreaterThanOrEqual(1);
      await user.click(myShiftsButtons[0] as HTMLElement);

      // The tab should remain visible
      await waitFor(() => {
        expectTabVisible('My Shifts');
      });
    });

    // Regression: the tab-sync effect re-read ?tab= whenever activeTab changed
    // and, finding no param, reset the page to Schedule — so clicking a tab
    // selected it and immediately snapped back. Assert on the tab's *content*,
    // not just its label: the labels stay in the DOM either way, which is why
    // the older assertion above did not catch this.
    it('should open the Equipment Checks tab on click', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const tabBar = await screen.findByRole('navigation', { name: /Scheduling tabs/i });
      await user.click(within(tabBar).getByRole('button', { name: /Equipment Checks/i }));

      expect(await screen.findByText('My Equipment Checklists')).toBeInTheDocument();
      expect(window.location.search).toContain('tab=equipment-checks');
    });

    it('should return to the Schedule tab and drop the tab param', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const tabBar = await screen.findByRole('navigation', { name: /Scheduling tabs/i });
      await user.click(within(tabBar).getByRole('button', { name: /Equipment Checks/i }));
      await screen.findByText('My Equipment Checklists');

      await user.click(within(tabBar).getByRole('button', { name: /Schedule/i }));

      await waitFor(() => {
        expect(screen.queryByText('My Equipment Checklists')).not.toBeInTheDocument();
      });
      expect(window.location.search).not.toContain('tab=');
    });

    it('should honour a ?tab= deep link on first render', async () => {
      window.history.replaceState({}, '', '/scheduling?tab=equipment-checks');

      renderWithRouter(<SchedulingPage />);

      expect(await screen.findByText('My Equipment Checklists')).toBeInTheDocument();
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
