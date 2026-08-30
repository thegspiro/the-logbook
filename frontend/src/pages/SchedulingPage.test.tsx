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

// The Equipment Checks tab follows the Inventory module switch, so this page
// now reads the module gate. Default everything on; the tests that care about
// a module being off set it themselves.
const mockIsModuleOn = vi.fn((_key: string) => true);
vi.mock('../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    isModuleOn: (key: string) => mockIsModuleOn(key),
    enabledModules: null,
    isLoading: false,
  }),
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
    // mockReset, not clearAllMocks: an implementation set by one test survives
    // clearAllMocks and would decide the next block's module gate for it
    // (CLAUDE.md pitfall #28). The default is restated here so a per-test
    // override has something to return to.
    mockIsModuleOn.mockReset();
    mockIsModuleOn.mockImplementation(() => true);
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

    it('should render the Equipment Checks tab when Inventory is enabled', async () => {
      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Equipment Checks').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('should hide the Equipment Checks tab when the Inventory module is off', async () => {
      // Equipment checks are gated on Inventory now, API included. Leaving the
      // tab up would load a page that 403s against its own API.
      mockIsModuleOn.mockImplementation((key: string) => key !== 'inventory');

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(screen.getAllByText('Schedule').length).toBeGreaterThanOrEqual(1);
      });
      expect(screen.queryByText('Equipment Checks')).not.toBeInTheDocument();
    });

    it('should fall back to Schedule when ?tab= names a tab the org cannot see', async () => {
      // Notification emails deep-link ?tab=equipment-checks. A department that
      // later switches Inventory off must land somewhere, not on a blank body.
      mockIsModuleOn.mockImplementation((key: string) => key !== 'inventory');
      window.history.replaceState({}, '', '/scheduling?tab=equipment-checks');

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expect(new URLSearchParams(window.location.search).get('tab')).toBeNull();
      });
      expect(screen.queryByText('Equipment Checks')).not.toBeInTheDocument();
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

      const tabBar = await screen.findByRole('tablist', { name: /Scheduling views/i });
      await user.click(within(tabBar).getByRole('tab', { name: /Equipment Checks/i }));

      expect(await screen.findByText('My Equipment Checklists')).toBeInTheDocument();
      expect(window.location.search).toContain('tab=equipment-checks');
    });

    it('should return to the Schedule tab and drop the tab param', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const tabBar = await screen.findByRole('tablist', { name: /Scheduling views/i });
      await user.click(within(tabBar).getByRole('tab', { name: /Equipment Checks/i }));
      await screen.findByText('My Equipment Checklists');

      await user.click(within(tabBar).getByRole('tab', { name: /Schedule/i }));

      await waitFor(() => {
        expect(screen.queryByText('My Equipment Checklists')).not.toBeInTheDocument();
      });
      expect(window.location.search).not.toContain('tab=');
    });

    it('supports arrow-key navigation between scheduling views', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const tabBar = await screen.findByRole('tablist', { name: /Scheduling views/i });
      const scheduleTab = within(tabBar).getByRole('tab', { name: 'Schedule' });
      scheduleTab.focus();
      await user.keyboard('{ArrowRight}');

      const myShiftsTab = within(tabBar).getByRole('tab', { name: 'My Shifts' });
      expect(myShiftsTab).toHaveAttribute('aria-selected', 'true');
      expect(window.location.search).toContain('tab=my-shifts');
    });

    it('should honour a ?tab= deep link on first render', async () => {
      window.history.replaceState({}, '', '/scheduling?tab=equipment-checks');

      renderWithRouter(<SchedulingPage />);

      expect(await screen.findByText('My Equipment Checklists')).toBeInTheDocument();
    });

    it('restores and preserves the selected calendar view and date in the URL', async () => {
      window.history.replaceState({}, '', '/scheduling?view=month&date=2026-08-13');

      renderWithRouter(<SchedulingPage />);

      const viewPicker = await screen.findByRole('tablist', { name: 'Calendar view mode' });
      expect(within(viewPicker).getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true');
      expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
      expect(window.location.search).toContain('view=month');
      expect(window.location.search).toContain('date=2026-08-13');
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
