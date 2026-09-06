import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SchedulingPage from './SchedulingPage';
import { schedulingService } from '../modules/scheduling/services/api';

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
    getMyAssignments: vi.fn().mockResolvedValue([]),
    getMyShifts: vi.fn().mockResolvedValue([]),
    getOpenShifts: vi.fn().mockResolvedValue([]),
    getShift: vi.fn(),
  },
  // A pure helper the create form calls on the template list; the real one just
  // flattens seats, so an empty list is a faithful stand-in for no template.
  resolveTemplatePositions: () => [],
}));

vi.mock('./scheduling/ShiftDetailPanel', () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-modal="true" aria-label="Shift Details">
      <button onClick={onClose}>Dismiss detail</button>
    </div>
  ),
  ShiftDetailPanel: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-modal="true" aria-label="Shift Details">
      <button onClick={onClose}>Dismiss detail</button>
    </div>
  ),
}));

// The tab-switching tests below are about the tab bar, not about what any tab
// renders. ShiftReportsTab pulls in shiftCompletionService and a good deal
// more, so it is stubbed rather than mocking that whole surface here.
vi.mock('./scheduling/ShiftReportsTab', () => ({
  default: () => <div data-testid="shift-reports-tab">Shift reports</div>,
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

    /**
     * Administration is reached from the Administration section of the nav, at
     * /scheduling/admin, like Training Admin and Inventory Admin. It used to be
     * a strip of "Officer tools" here, which meant an administrator opened the
     * member-facing schedule to find the settings and the Administration
     * section had no scheduling entry at all.
     *
     * Asserted for a manager rather than only for a member: the strip was gated
     * on scheduling.manage, so a test that only checked a member would have
     * passed with it still on screen.
     */
    it('offers no administration strip, even to a scheduling manager', async () => {
      mockCheckPermission.mockImplementation((perm: string) => perm === 'scheduling.manage');

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expectTabVisible('Schedule');
      });

      expect(screen.queryByText('Officer tools')).not.toBeInTheDocument();
      // queryAll, not getAll: with the strip gone the page may render no links at
      // all, and getAllByRole throws on an empty result — which would pass this
      // test for the wrong reason on one render and fail it on another.
      const hrefs = screen.queryAllByRole('link').map((link) => link.getAttribute('href'));
      expect(hrefs.filter((href) => href?.startsWith('/scheduling/admin'))).toEqual([]);
    });

    it('should not render admin links for non-admin users', async () => {
      mockCheckPermission.mockReturnValue(false);

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => {
        expectTabVisible('Schedule');
      });

      expect(screen.queryByText('Officer tools')).not.toBeInTheDocument();
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
    it('should open a lazy tab on click and keep it open', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const tabBar = await screen.findByRole('tablist', { name: /Scheduling views/i });
      const reportsTab = within(tabBar).getByRole('tab', { name: /Shift Reports/i });
      await user.click(reportsTab);

      // Assert on the tab's body, not its label: the labels stay in the DOM
      // either way, which is what let the snap-back through before.
      expect(await screen.findByTestId('shift-reports-tab')).toBeInTheDocument();
      expect(reportsTab).toHaveAttribute('aria-selected', 'true');
      expect(window.location.search).toContain('tab=shift-reports');
    });

    it('should return to the Schedule tab and drop the tab param', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const tabBar = await screen.findByRole('tablist', { name: /Scheduling views/i });
      const reportsTab = within(tabBar).getByRole('tab', { name: /Shift Reports/i });
      await user.click(reportsTab);
      await screen.findByTestId('shift-reports-tab');

      const scheduleTab = within(tabBar).getByRole('tab', { name: 'Schedule' });
      await user.click(scheduleTab);

      await waitFor(() => expect(screen.queryByTestId('shift-reports-tab')).not.toBeInTheDocument());
      expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
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
      window.history.replaceState({}, '', '/scheduling?tab=shift-reports');

      renderWithRouter(<SchedulingPage />);

      expect(await screen.findByTestId('shift-reports-tab')).toBeInTheDocument();
    });

    it('falls back to Schedule when ?tab= names a tab that no longer exists', async () => {
      // Equipment checks moved to Inventory and the tab went with them, but
      // notifications sent before that carry ?tab=equipment-checks. It has to
      // land somewhere rather than rendering an empty body.
      window.history.replaceState({}, '', '/scheduling?tab=equipment-checks');

      renderWithRouter(<SchedulingPage />);

      const tabBar = await screen.findByRole('tablist', { name: /Scheduling views/i });
      expect(within(tabBar).getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
      expect(within(tabBar).queryByRole('tab', { name: /Equipment Checks/i })).not.toBeInTheDocument();
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

  /**
   * Create Shift and Shift Details are both body-level `aria-modal` dialogs and
   * neither opens the other: a `?shift=` deep link resolves on its own
   * schedule, which can land while the create form is open. Two modal roots
   * leave assistive technology to guess which is current.
   */
  describe('two dialogs at once', () => {
    const mockGetShift = vi.mocked(schedulingService.getShift);

    beforeEach(() => {
      mockGetShift.mockReset();
      // The Create Shift trigger is gated on scheduling.manage.
      mockCheckPermission.mockReturnValue(true);
    });

    it('withdraws Create Shift while the detail dialog is up, and gives it back intact', async () => {
      // Held open so the create form can be opened first, which is the order
      // that produces the collision.
      let resolveShift: (shift: unknown) => void = () => {};
      mockGetShift.mockReturnValue(
        new Promise((resolve) => {
          resolveShift = resolve;
        }) as never
      );

      window.history.pushState({}, '', '/scheduling?shift=shift-1');
      const user = userEvent.setup();
      renderWithRouter(<SchedulingPage />);

      await user.click(await screen.findByRole('button', { name: /Create Shift/ }));
      expect(await screen.findByRole('heading', { name: 'Create Shift' })).toBeInTheDocument();

      await act(async () => {
        resolveShift({ id: 'shift-1', shift_date: '2099-01-01' });
      });

      const detail = await screen.findByRole('dialog', { name: 'Shift Details' });
      expect(detail).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Create Shift' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);

      // Withdrawn, not closed: `showCreateShift` is untouched, so the form
      // comes back when the dialog above it goes away. Clearing the flag
      // instead would drop a half-filled form on an event the user did not
      // initiate.
      await user.click(screen.getByRole('button', { name: 'Dismiss detail' }));
      expect(await screen.findByRole('heading', { name: 'Create Shift' })).toBeInTheDocument();
    });
  });
});
