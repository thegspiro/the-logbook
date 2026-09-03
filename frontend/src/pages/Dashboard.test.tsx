import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import Dashboard from './Dashboard';
import type { ShiftRecord } from '../modules/scheduling/services/api';
import { getTodayLocalDate, addCalendarDays } from '../utils/dateFormatting';

// Capture the pull-to-refresh handler the page registers, so a test can drive
// the gesture without mounting the layout provider.
let registeredPullToRefresh: (() => Promise<void>) | undefined;
vi.mock('../hooks/useRegisterPullToRefresh', () => ({
  useRegisterPullToRefresh: (onRefresh: () => Promise<void>) => {
    registeredPullToRefresh = onRefresh;
  },
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock API services
const {
  mockGetMyShifts,
  mockGetOpenShifts,
  mockSignupForShift,
  mockGetInbox,
  mockGetUnreadCount,
  mockGetMyNotifications,
  mockAcknowledge,
  mockGetMyTraining,
  mockGetEvents,
  mockCreateOrUpdateRSVP,
  mockCheckPermission,
  mockGetAdminSummary,
  mockGetSetupChecklist,
  mockGetUserInventory,
  mockGetInventorySummary,
  mockGetEligiblePositions,
  mockGetMyCompliance,
  mockGetSchedulingSummary,
  mockGetTrainingEnrollments,
  mockGetEnrollmentProgress,
  mockGetAdminHoursSummary,
  mockGetEnabledModules,
  mockMarkNotificationRead,
} = vi.hoisted(() => ({
  mockGetMyShifts: vi.fn(),
  mockGetOpenShifts: vi.fn(),
  mockSignupForShift: vi.fn(),
  mockGetInbox: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockGetMyNotifications: vi.fn(),
  mockAcknowledge: vi.fn(),
  mockGetMyTraining: vi.fn(),
  mockGetEvents: vi.fn(),
  mockCreateOrUpdateRSVP: vi.fn(),
  mockCheckPermission: vi.fn(),
  mockGetAdminSummary: vi.fn(),
  mockGetSetupChecklist: vi.fn(),
  mockGetUserInventory: vi.fn(),
  mockGetInventorySummary: vi.fn(),
  mockGetEligiblePositions: vi.fn(),
  mockGetMyCompliance: vi.fn(),
  mockGetSchedulingSummary: vi.fn(),
  mockGetTrainingEnrollments: vi.fn(),
  mockGetEnrollmentProgress: vi.fn(),
  mockMarkNotificationRead: vi.fn(),
  mockGetAdminHoursSummary: vi.fn(),
  mockGetEnabledModules: vi.fn(),
}));

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyShifts: mockGetMyShifts,
    getOpenShifts: mockGetOpenShifts,
    getSummary: mockGetSchedulingSummary,
    signupForShift: mockSignupForShift,
    getEligiblePositions: mockGetEligiblePositions,
  },
}));

vi.mock('../services/api', () => ({
  notificationsService: {
    getMyNotifications: mockGetMyNotifications,
    markMyNotificationRead: mockMarkNotificationRead,
  },
  messagesService: {
    getInbox: mockGetInbox,
    getUnreadCount: mockGetUnreadCount,
    markAsRead: vi.fn().mockResolvedValue(undefined),
    acknowledge: mockAcknowledge,
    updateMessage: vi.fn().mockResolvedValue({}),
  },
  trainingProgramService: {
    getMyEnrollments: mockGetTrainingEnrollments,
    getEnrollmentProgress: mockGetEnrollmentProgress,
  },
  trainingModuleConfigService: {
    getMyTraining: mockGetMyTraining,
  },
  organizationService: {
    getSetupChecklist: mockGetSetupChecklist,
    // Reached via DashboardOrientation -> useEnabledModules, which decides
    // which learning lessons count toward the orientation prompt.
    getEnabledModules: mockGetEnabledModules,
  },
  inventoryService: {
    getUserInventory: mockGetUserInventory,
    getSummary: mockGetInventorySummary,
    getLowStockItems: vi.fn().mockResolvedValue([]),
  },
  eventService: {
    getEvents: mockGetEvents,
    createOrUpdateRSVP: mockCreateOrUpdateRSVP,
  },
  medicalScreeningService: {
    getMyCompliance: mockGetMyCompliance,
  },
  dashboardService: {
    getStats: vi.fn().mockResolvedValue({}),
    getAdminSummary: mockGetAdminSummary,
    getActionItems: vi.fn().mockResolvedValue([]),
    getCommunityEngagement: vi.fn().mockResolvedValue({}),
    getBranding: vi.fn().mockResolvedValue({ name: 'Test FD' }),
  },
}));

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursEntryService: {
    getSummary: mockGetAdminHoursSummary,
  },
}));

// Mock auth store
// Selector-aware, as the real store is. A mock that ignores the selector hands
// every caller the whole state object, so a consumer selecting one primitive
// (`state.user?.id`) gets a fresh object each render and spins any effect keyed
// on it — which is exactly what DashboardOrientation does.
vi.mock('../stores/authStore', () => {
  const state = () => ({
    checkPermission: mockCheckPermission,
    user: { id: 'user-1', first_name: 'Test', last_name: 'User', organization_id: 'org-1' },
  });
  // The real store is callable *and* carries getState. A hook-only double
  // breaks every consumer that reads the store outside React — the scheduling
  // settings cache keys its org-scoped entries that way.
  return {
    useAuthStore: Object.assign(
      (selector?: (s: Record<string, unknown>) => unknown) => {
        const s = state();
        return selector ? selector(s) : s;
      },
      { getState: state }
    ),
  };
});

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

/** Inside the thirty-day window the timeline covers, whatever day the suite runs. */
const inWindow = (offsetDays: number) => addCalendarDays(getTodayLocalDate('America/New_York'), offsetDays);
/**
 * Past the display window but inside the open-shift fetch's lookahead, so it
 * counts only toward the "more open shifts" footer. It has to sit between the
 * two: inside thirty days it becomes an ordinary row, past sixty days the
 * fetch never returns it and the footer has nothing to count.
 */
const pastWindow = addCalendarDays(getTodayLocalDate('America/New_York'), 40);

const makeShift = (overrides: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 'shift-1',
  organization_id: 'org-1',
  shift_date: inWindow(1),
  start_time: '08:00',
  end_time: '16:00',
  attendee_count: 2,
  call_count: 0,
  is_finalized: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

// Every hoisted service mock, so beforeEach can reset them all rather than
// tracking which ones a given test happened to arm.
const ALL_SERVICE_MOCKS = [
  mockGetMyShifts,
  mockGetOpenShifts,
  mockSignupForShift,
  mockGetInbox,
  mockGetUnreadCount,
  mockGetMyNotifications,
  mockAcknowledge,
  mockGetMyTraining,
  mockGetEvents,
  mockCreateOrUpdateRSVP,
  mockCheckPermission,
  mockGetAdminSummary,
  mockGetSetupChecklist,
  mockGetUserInventory,
  mockGetInventorySummary,
  mockGetEligiblePositions,
  mockGetMyCompliance,
  mockGetSchedulingSummary,
  mockGetAdminHoursSummary,
  mockGetEnabledModules,
  mockGetTrainingEnrollments,
  mockGetEnrollmentProgress,
  mockMarkNotificationRead,
];

describe('Dashboard', () => {
  beforeEach(() => {
    registeredPullToRefresh = undefined;
    // mockReset, not just clearAllMocks: clearAllMocks wipes recorded calls but
    // leaves implementations AND any unconsumed mockRejectedValueOnce still
    // queued, so a test that arms a one-shot rejection and then returns early
    // hands it to whichever test calls that mock next. The failure-path tests
    // below arm those constantly, so the queue is never idle here.
    // (CLAUDE.md pitfall #28.)
    ALL_SERVICE_MOCKS.forEach((mock) => mock.mockReset());
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });
    mockGetOpenShifts.mockResolvedValue([]);
    mockSignupForShift.mockResolvedValue({});
    mockGetInbox.mockResolvedValue([]);
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
    mockGetMyNotifications.mockResolvedValue({ logs: [], total: 0 });
    mockMarkNotificationRead.mockResolvedValue(undefined);
    mockAcknowledge.mockResolvedValue(undefined);
    mockGetMyTraining.mockResolvedValue({ hours_summary: { total_hours: 0, hours_this_month: 0 }, certifications: [] });
    mockGetEvents.mockResolvedValue([]);
    mockGetEligiblePositions.mockResolvedValue({ positions: ['firefighter'], is_excluded: false });
    // Default: a department that tracks no screenings.
    mockGetMyCompliance.mockResolvedValue({
      total_requirements: 0,
      compliant_count: 0,
      non_compliant_count: 0,
      expiring_soon_count: 0,
      is_fully_compliant: true,
      days_until_next_expiration: null,
    });
    mockCheckPermission.mockImplementation((permission: string) =>
      ['scheduling.view', 'training.view', 'admin_hours.view'].includes(permission)
    );
    mockGetEnabledModules.mockResolvedValue({
      configured: true,
      enabled_modules: ['inventory', 'medical_screening', 'notifications', 'scheduling', 'training'],
    });
    mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 0 });
    mockGetTrainingEnrollments.mockResolvedValue([]);
    mockGetEnrollmentProgress.mockResolvedValue({});
    mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 0 });
    mockGetAdminSummary.mockResolvedValue({});
    mockGetSetupChecklist.mockResolvedValue({ completed_count: 0, total_count: 0 });
    mockGetUserInventory.mockResolvedValue({ permanent_assignments: [], active_checkouts: [], issued_items: [] });
    mockGetInventorySummary.mockResolvedValue({
      total_items: 0,
      total_value: 0,
      active_checkouts: 0,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
    });
  });

  describe('section errors', () => {
    it('shows explicit errors instead of successful-empty claims when initial personal data loads fail', async () => {
      mockGetMyShifts.mockRejectedValue(new Error('offline'));
      mockGetOpenShifts.mockRejectedValue(new Error('offline'));
      mockGetEvents.mockRejectedValue(new Error('offline'));
      mockGetInbox.mockRejectedValue(new Error('offline'));
      mockGetMyNotifications.mockRejectedValue(new Error('offline'));
      mockGetTrainingEnrollments.mockRejectedValue(new Error('offline'));
      mockGetUserInventory.mockRejectedValue(new Error('offline'));
      mockGetSchedulingSummary.mockRejectedValue(new Error('offline'));
      mockGetMyTraining.mockRejectedValue(new Error('offline'));
      mockGetAdminHoursSummary.mockRejectedValue(new Error('offline'));

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Some schedule information could not be verified.')).toBeInTheDocument();
      expect(await screen.findByText('Updates could not be fully verified.')).toBeInTheDocument();
      expect(await screen.findByText('Training progress could not be verified.')).toBeInTheDocument();
      expect(await screen.findByText('Issued gear could not be verified.')).toBeInTheDocument();
      expect(await screen.findByText('Hours could not be fully verified.')).toBeInTheDocument();
      expect(screen.getByText('Readiness could not be fully verified.')).toBeInTheDocument();
      expect(screen.queryByText(/Nothing scheduled through/)).not.toBeInTheDocument();
      expect(screen.queryByText('Nothing new')).not.toBeInTheDocument();
    });

    it('clears an updates error after a successful retry', async () => {
      mockGetInbox.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const updates = await screen.findByRole('region', { name: 'My Updates' });
      await within(updates).findByText('Updates could not be fully verified.');
      await user.click(within(updates).getByRole('button', { name: 'Retry updates' }));

      await waitFor(() => expect(within(updates).getByText('Nothing new')).toBeInTheDocument());
      expect(within(updates).queryByRole('alert')).not.toBeInTheDocument();
      expect(mockGetInbox).toHaveBeenCalledTimes(2);
    });

    it('keeps successful timeline sources when open shifts fail, then fills them in on retry', async () => {
      mockGetMyShifts.mockResolvedValue({
        shifts: [makeShift({ id: 'mine', apparatus_name: 'Engine 7' })],
        total: 1,
      });
      mockGetEvents.mockResolvedValue([
        {
          id: 'event-1',
          title: 'Live Fire Drill',
          event_type: 'training',
          start_datetime: `${inWindow(3)}T14:00:00Z`,
          end_datetime: `${inWindow(3)}T17:00:00Z`,
          requires_rsvp: false,
          is_mandatory: false,
          is_cancelled: false,
        },
      ]);
      mockGetOpenShifts
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce([makeShift({ id: 'open-after-retry', shift_date: inWindow(4) })]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const timeline = await screen.findByRole('region', { name: 'Next 30 Days' });
      expect(await within(timeline).findByText('Shift · Engine 7')).toBeInTheDocument();
      expect(await within(timeline).findByText('Live Fire Drill')).toBeInTheDocument();
      expect(within(timeline).queryByText(/Nothing scheduled/)).not.toBeInTheDocument();

      await user.click(within(timeline).getByRole('button', { name: 'Retry schedule' }));

      expect(await within(timeline).findByText('Open Shift')).toBeInTheDocument();
      await waitFor(() => expect(within(timeline).queryByRole('alert')).not.toBeInTheDocument());
      expect(within(timeline).getByText('Shift · Engine 7')).toBeInTheDocument();
      expect(within(timeline).getByText('Live Fire Drill')).toBeInTheDocument();
    });
  });

  describe('hours summary gates', () => {
    it('does not call summary endpoints owned by disabled modules', async () => {
      mockGetEnabledModules.mockResolvedValue({ configured: true, enabled_modules: [] });

      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      await waitFor(() => {
        expect(mockGetAdminHoursSummary).toHaveBeenCalledTimes(1);
      });
      expect(mockGetSchedulingSummary).not.toHaveBeenCalled();
      expect(mockGetMyTraining).not.toHaveBeenCalled();
      expect(within(card).getAllByText('Unavailable')).toHaveLength(2);
      expect(within(card).getAllByText('0')).toHaveLength(2);
    });

    it('loads authorized sources independently when another source fails', async () => {
      mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 3 });
      mockGetMyTraining.mockRejectedValue(new Error('training unavailable'));
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      // The rows that loaded still show their real figures.
      await waitFor(() => {
        expect(within(card).getByText('3')).toBeInTheDocument();
      });
      expect(within(card).getByText('2')).toBeInTheDocument();
      expect(within(card).getByText('Unavailable')).toBeInTheDocument();
    });

    it('does not present a partial sum as the month total', async () => {
      // 3 + 2 = 5 is arithmetic, not the member's month: training failed, so
      // its hours are missing from the sum. "5 total" is a precise wrong
      // number, and a precise number reads more trustworthy than a missing
      // one -- the error banner alongside it does not undo that.
      mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 3 });
      mockGetMyTraining.mockRejectedValue(new Error('training unavailable'));
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      expect(await within(card).findByText('Total unavailable')).toBeInTheDocument();
      expect(within(card).queryByText('5')).not.toBeInTheDocument();
    });

    it('still totals the month when a source is only gated off', async () => {
      // The counterpart: Training disabled is not a failure, so the sum over
      // the sources that do apply is the department's real month total.
      mockGetEnabledModules.mockResolvedValue({
        configured: true,
        enabled_modules: ['scheduling'],
      });
      mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 3 });
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      expect(await within(card).findByText('5')).toBeInTheDocument();
      expect(within(card).queryByText('Total unavailable')).not.toBeInTheDocument();
    });

    it('does not report an error for a source it never attempted', async () => {
      // A member without training.view is not looking at a broken card. If a
      // gated-off source counted as a failure the banner would be permanent
      // and its Retry would re-run the same gate, so this pins the direction:
      // only an attempted-and-rejected source raises the error.
      mockCheckPermission.mockImplementation((permission: string) => permission === 'admin_hours.view');
      mockGetEnabledModules.mockResolvedValue({ configured: true, enabled_modules: [] });
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      // Administrative hours is the only source that loads, so it is both the
      // row figure and the headline total.
      await waitFor(() => {
        expect(within(card).getAllByText('2')).toHaveLength(2);
      });
      expect(mockGetSchedulingSummary).not.toHaveBeenCalled();
      expect(mockGetMyTraining).not.toHaveBeenCalled();
      expect(screen.queryByText('Hours could not be fully verified.')).not.toBeInTheDocument();
    });

    it('does not call enabled sources without their view permissions', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'scheduling.view');
      mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 4 });

      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      await waitFor(() => {
        expect(within(card).getAllByText('4')).toHaveLength(2);
      });
      expect(mockGetSchedulingSummary).toHaveBeenCalledTimes(1);
      expect(mockGetMyTraining).not.toHaveBeenCalled();
      expect(mockGetAdminHoursSummary).not.toHaveBeenCalled();
      expect(mockCheckPermission).toHaveBeenCalledWith('admin_hours.view');
    });
  });

  describe('retry scope', () => {
    it('keeps the loaded timeline rows visible while a failed source retries', async () => {
      // timelineLoading is the OR of three flags, so a retry that raises its
      // own flag swaps the preserved rows for a skeleton -- and a hanging
      // retry then hides them for as long as it hangs.
      mockGetMyShifts.mockResolvedValue({
        shifts: [makeShift({ id: 'mine', apparatus_name: 'Engine 7' })],
        total: 1,
      });
      mockGetOpenShifts.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const timeline = await screen.findByRole('region', { name: 'Next 30 Days' });
      expect(await within(timeline).findByText('Shift · Engine 7')).toBeInTheDocument();

      await user.click(within(timeline).getByRole('button', { name: 'Retry schedule' }));

      // The retry never settles; the row must still be there.
      expect(within(timeline).getByText('Shift · Engine 7')).toBeInTheDocument();
    });

    it('does not claim zero open shifts when the open-shift load failed', async () => {
      // On desktop this quick action sits above the timeline warning, so "0
      // open" is the first thing read and reads as "no coverage needed".
      mockGetOpenShifts.mockRejectedValue(new Error('offline'));

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Open shifts unavailable')).toBeInTheDocument();
    });

    it('retries only the readiness sources that failed', async () => {
      mockGetMyCompliance.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
        total_requirements: 0,
        compliant_count: 0,
        non_compliant_count: 0,
        expiring_soon_count: 0,
        is_fully_compliant: true,
        days_until_next_expiration: null,
      });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await screen.findByText('Readiness could not be fully verified.');
      const hoursCallsBefore = mockGetAdminHoursSummary.mock.calls.length;
      await user.click(screen.getByRole('button', { name: 'Retry readiness' }));

      await waitFor(() => {
        expect(mockGetMyCompliance.mock.calls.length).toBeGreaterThan(1);
      });
      // Hours succeeded, so the readiness retry must leave it alone rather
      // than risk replacing good figures with an unavailable state.
      expect(mockGetAdminHoursSummary.mock.calls.length).toBe(hoursCallsBefore);
    });

    it('retries only the message subrequest that failed', async () => {
      mockGetUnreadCount.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ unread_count: 0 });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const updates = await screen.findByRole('region', { name: 'My Updates' });
      await within(updates).findByText('Updates could not be fully verified.');
      const inboxCallsBefore = mockGetInbox.mock.calls.length;

      await user.click(within(updates).getByRole('button', { name: 'Retry updates' }));

      await waitFor(() => {
        expect(mockGetUnreadCount.mock.calls.length).toBeGreaterThan(1);
      });
      // The inbox request succeeded; re-running it can only lose the rows.
      expect(mockGetInbox.mock.calls.length).toBe(inboxCallsBefore);
    });

    it('does not surface a failure from a training row it never renders', async () => {
      // The card shows two programs; asking about a third lets an invisible
      // row raise the error banner over two that loaded fine.
      mockGetTrainingEnrollments.mockResolvedValue([
        { id: 'e1', program_name: 'Program 1', status: 'active' },
        { id: 'e2', program_name: 'Program 2', status: 'active' },
        { id: 'e3', program_name: 'Program 3', status: 'active' },
      ]);

      renderWithRouter(<Dashboard />);

      await screen.findByRole('region', { name: 'Next 30 Days' });
      await waitFor(() => {
        expect(mockGetEnrollmentProgress).toHaveBeenCalled();
      });
      const requested = mockGetEnrollmentProgress.mock.calls.map((call) => call[0] as string);
      expect(requested).not.toContain('e3');
    });
  });

  describe('retry preserves what is already known', () => {
    it('keeps the open-shift failure showing while the retry is still in flight', async () => {
      // Clearing the error before the replacement arrives puts "0 open" back on
      // screen -- a confident wrong number -- for as long as the retry takes.
      mockGetOpenShifts.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Open shifts unavailable')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry schedule' }));

      // The retry never settles, so the failure state must still stand.
      expect(screen.getByText('Open shifts unavailable')).toBeInTheDocument();
    });

    it('keeps loaded messages visible while a notification retry is in flight', async () => {
      mockGetInbox.mockResolvedValue([
        { id: 'm1', title: 'Station meeting', body: 'Tuesday', is_read: false, requires_acknowledgment: false },
      ]);
      mockGetMyNotifications
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const updates = await screen.findByRole('region', { name: 'My Updates' });
      expect(await within(updates).findByText('Station meeting')).toBeInTheDocument();

      await user.click(within(updates).getByRole('button', { name: 'Retry notifications' }));

      expect(within(updates).getByText('Station meeting')).toBeInTheDocument();
    });

    it('keeps training progress that already loaded when a retry rejects it', async () => {
      mockGetTrainingEnrollments.mockResolvedValue([
        { id: 'e1', program: { name: 'Program 1' }, progress_percentage: 40, status: 'active' },
        { id: 'e2', program: { name: 'Program 2' }, progress_percentage: 10, status: 'active' },
      ]);
      // e1 loads, e2 fails. On the retry e1 now fails too -- its known answer
      // must survive rather than be replaced by the retry's results alone.
      mockGetEnrollmentProgress.mockImplementation((id: string) => {
        const call = mockGetEnrollmentProgress.mock.calls.filter((c) => c[0] === id).length;
        if (id === 'e1' && call === 1) {
          return Promise.resolve({
            requirement_progress: [{ status: 'in_progress', requirement: { name: 'Pump Ops' } }],
          });
        }
        return Promise.reject(new Error('offline'));
      });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      expect(await screen.findByText(/Next requirement: Pump Ops/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry training' }));

      await waitFor(() => {
        expect(mockGetEnrollmentProgress.mock.calls.length).toBeGreaterThan(2);
      });
      expect(screen.getByText(/Next requirement: Pump Ops/)).toBeInTheDocument();
    });

    it('names the partial Updates retry for the source that actually failed', async () => {
      // The feed still has a notification row, so the card takes its
      // non-empty branch -- which used to hard-code "notifications" even when
      // only the message request had failed.
      mockGetMyNotifications.mockResolvedValue({
        logs: [{ id: 'n1', subject: 'Drill reminder', message: 'Tuesday', sent_at: '2026-09-01T12:00:00Z' }],
        total: 1,
      });
      mockGetInbox.mockRejectedValue(new Error('offline'));

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('button', { name: 'Retry updates' })).toBeInTheDocument();
    });
  });

  describe('a successful retry clears the failure it was shown for', () => {
    // The counterpart to "retry preserves what is already known", and the half
    // that was missing when the preserve rule was first added: moving the
    // error clear off the eager pre-await path is only correct if the success
    // path picks it up. Skipping both leaves the banner on screen forever
    // after the data has actually arrived, which is worse than the bug it
    // replaced. Every retryable section is listed so a new one cannot be added
    // with only one half.
    const cases: {
      name: string;
      arm: () => void;
      region: string;
      retry: string;
      banner: string;
      recovered: () => Promise<HTMLElement>;
    }[] = [
      {
        name: 'schedule (events)',
        arm: () => {
          mockGetEvents.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([
            {
              id: 'ev1',
              title: 'Live Fire Drill',
              event_type: 'training',
              start_datetime: `${inWindow(3)}T14:00:00Z`,
              end_datetime: `${inWindow(3)}T17:00:00Z`,
              requires_rsvp: false,
              is_mandatory: false,
              is_cancelled: false,
            },
          ]);
        },
        region: 'Next 30 Days',
        retry: 'Retry schedule',
        banner: 'Some schedule information could not be verified.',
        recovered: () => screen.findByText('Live Fire Drill'),
      },
      {
        name: 'issued gear',
        arm: () => {
          mockGetUserInventory.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
            permanent_assignments: [{ id: 'a1' }],
            active_checkouts: [],
            issued_items: [],
          });
        },
        region: 'Next 30 Days',
        retry: 'Retry issued gear',
        banner: 'Issued gear could not be verified.',
        recovered: () => screen.findByText('1'),
      },
    ];

    cases.forEach(({ name, arm, retry, banner, recovered }) => {
      it(`clears the ${name} banner once the retry succeeds`, async () => {
        arm();
        const user = userEvent.setup();
        renderWithRouter(<Dashboard />);

        expect(await screen.findByText(banner)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: retry }));

        await recovered();
        await waitFor(() => {
          expect(screen.queryByText(banner)).not.toBeInTheDocument();
        });
      });
    });

    it('clears the hours banner and the stale header total once the retry succeeds', async () => {
      mockGetMyTraining
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ hours_summary: { total_hours: 4, hours_this_month: 4 }, certifications: [] });
      mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 3 });
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      expect(await within(card).findByText('Total unavailable')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Retry hours' }));

      // 3 + 2 + 4, now that every attempted source has answered.
      expect(await within(card).findByText('9')).toBeInTheDocument();
      expect(within(card).queryByText('Total unavailable')).not.toBeInTheDocument();
      expect(screen.queryByText('Hours could not be fully verified.')).not.toBeInTheDocument();
    });

    it('clears the readiness banner once the certification retry succeeds', async () => {
      // certificationsError is raised inside loadHours' training catch. A flag
      // that only a failure ever sets, and only the eager pre-await reset ever
      // clears, can never come down on a retry -- which skips that reset.
      mockGetMyTraining
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ hours_summary: { total_hours: 1, hours_this_month: 1 }, certifications: [] });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Readiness could not be fully verified.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry readiness' }));

      await waitFor(() => {
        expect(screen.queryByText('Readiness could not be fully verified.')).not.toBeInTheDocument();
      });
    });

    it('keeps the stale hours total off the header while the retry is in flight', async () => {
      // The header reads hoursError directly and never consults loadingHours,
      // so clearing the flag up front would put the partial sum back as an
      // exact figure for as long as the retry takes.
      mockGetMyTraining.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));
      mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 3 });
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      await within(card).findByText('Total unavailable');
      await user.click(screen.getByRole('button', { name: 'Retry hours' }));

      expect(within(card).getByText('Total unavailable')).toBeInTheDocument();
      expect(screen.queryByText(/5 hrs in/)).not.toBeInTheDocument();
    });
  });

  describe('a retry cannot make things worse', () => {
    it('keeps an hours figure that loaded when a later retry loses its source', async () => {
      // The three summaries are independent requests. Rewriting all three from
      // one call means a retry that recovers scheduling while training
      // transiently fails wipes training's known figure -- recovery from one
      // outage manufacturing a second.
      mockGetSchedulingSummary.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
        hours_worked_this_month: 3,
      });
      mockGetMyTraining
        .mockResolvedValueOnce({ hours_summary: { total_hours: 4, hours_this_month: 4 }, certifications: [] })
        .mockRejectedValue(new Error('offline'));
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      expect(await within(card).findByText('4')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Retry hours' }));

      // Scheduling recovered; training's 4 must survive its retry rejection.
      expect(await within(card).findByText('3')).toBeInTheDocument();
      expect(within(card).getByText('4')).toBeInTheDocument();
    });

    it('does not claim a program is on track when its progress never loaded', async () => {
      // No progressDetails entry means the request rejected. "All requirements
      // in progress" is an affirmative claim about that program, and the
      // section warning above it does not make the claim true.
      mockGetTrainingEnrollments.mockResolvedValue([
        { id: 'e1', program: { name: 'Program 1' }, progress_percentage: 40, status: 'active' },
      ]);
      mockGetEnrollmentProgress.mockRejectedValue(new Error('offline'));

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Progress unavailable.')).toBeInTheDocument();
      expect(screen.queryByText('All requirements in progress.')).not.toBeInTheDocument();
    });

    it('coalesces a second Retry click while the first is still running', async () => {
      // Without the guard the second request can settle first, leaving the
      // older failure to land last and put the warning back over recovered
      // data.
      mockGetOpenShifts.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await screen.findByText('Some schedule information could not be verified.');
      const retry = screen.getByRole('button', { name: 'Retry schedule' });
      await user.click(retry);

      expect(retry).toBeDisabled();
      const callsAfterFirst = mockGetOpenShifts.mock.calls.length;
      await user.click(retry);
      expect(mockGetOpenShifts.mock.calls.length).toBe(callsAfterFirst);
    });

    it('keeps notification rows visible when both message calls are retried', async () => {
      // Both message subrequests failed, notifications did not. Retrying both
      // must not read as an initial load: the Updates card's loading branch
      // covers the notification rows too, so it would skeleton over content
      // that is fine -- indefinitely if either retry hangs.
      mockGetInbox.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));
      mockGetUnreadCount.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));
      mockGetMyNotifications.mockResolvedValue({
        logs: [{ id: 'n1', subject: 'Drill reminder', message: 'Tuesday', sent_at: '2026-09-01T12:00:00Z' }],
        total: 1,
      });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const updates = await screen.findByRole('region', { name: 'My Updates' });
      expect(await within(updates).findByText('Drill reminder')).toBeInTheDocument();

      await user.click(within(updates).getByRole('button', { name: 'Retry updates' }));

      expect(within(updates).getByText('Drill reminder')).toBeInTheDocument();
    });

    it('shares the retry guard between the two controls over the same loader', async () => {
      // A training-summary failure renders a Retry on both the hours card and
      // the readiness card, and both call loadHours. A guard held per rendered
      // control lets those two start concurrent loads -- and if the later one
      // settles first, the earlier lands last and restores the error over data
      // that had just recovered.
      mockGetMyTraining.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await screen.findByText('Hours could not be fully verified.');
      await user.click(screen.getByRole('button', { name: 'Retry hours' }));

      // The readiness control sits over the same loader, so it is guarded too.
      expect(screen.getByRole('button', { name: 'Retry readiness' })).toBeDisabled();
      const callsAfterFirst = mockGetMyTraining.mock.calls.length;
      await user.click(screen.getByRole('button', { name: 'Retry readiness' }));
      expect(mockGetMyTraining.mock.calls.length).toBe(callsAfterFirst);
    });

    it('keeps the hours failure showing through a pull-to-refresh', async () => {
      // Pull-to-refresh runs with the page already on screen, so it is a
      // refresh, not a first load. The header ignores loadingHours, so an
      // eager clear here would revert "Total unavailable" to an exact stale
      // partial total for as long as the refresh takes.
      mockGetMyTraining.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));
      mockGetSchedulingSummary.mockResolvedValue({ hours_worked_this_month: 3 });
      mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 2 });

      renderWithRouter(<Dashboard />);

      const card = await screen.findByRole('region', { name: /My hours,/ });
      await within(card).findByText('Total unavailable');

      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });

      expect(within(card).getByText('Total unavailable')).toBeInTheDocument();
      expect(screen.queryByText(/5 hrs in/)).not.toBeInTheDocument();
    });

    it('drops stale certifications from the readiness verdict when a refresh fails', async () => {
      // The safety case. Certifications are an input to "Clear to respond",
      // not a figure on a card: keeping the last good snapshot means a
      // credential that expired or was revoked since then still clears the
      // member, with only a banner saying readiness was "not fully verified".
      mockGetMyTraining
        .mockResolvedValueOnce({
          hours_summary: { total_hours: 1, hours_this_month: 1 },
          certifications: [
            {
              id: 'c1',
              course_name: 'EMT-B',
              expiration_date: '2030-01-01',
              is_expired: false,
              days_until_expiry: 900,
            },
          ],
        })
        .mockRejectedValue(new Error('offline'));

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Clear to respond')).toBeInTheDocument();

      // The first load succeeded, so the failure has to arrive on a later
      // refresh -- which is exactly the case the verdict must not survive.
      await act(async () => {
        await registeredPullToRefresh?.();
      });

      await waitFor(() => {
        expect(screen.queryByText('Clear to respond')).not.toBeInTheDocument();
      });
    });

    it('does not disable the readiness Retry for a loader it would not call', async () => {
      // Readiness failed on seats only, so its handler retries seats only. A
      // busy predicate naming every possible source lets a slow hours retry
      // block recovery of a source this button owns.
      mockGetEligiblePositions.mockRejectedValue(new Error('offline'));
      mockGetSchedulingSummary
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await screen.findByText('Hours could not be fully verified.');
      await user.click(screen.getByRole('button', { name: 'Retry hours' }));

      // certificationsError is false -- training loaded -- so readiness never
      // calls loadHours and must stay live.
      expect(screen.getByRole('button', { name: 'Retry readiness' })).not.toBeDisabled();
    });

    it('joins a pull-to-refresh to a section retry already in flight', async () => {
      // The gesture is not blocked during a section retry, so calling the
      // loaders directly would start a second request for the same source.
      mockGetOpenShifts.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await screen.findByText('Some schedule information could not be verified.');
      await user.click(screen.getByRole('button', { name: 'Retry schedule' }));
      const callsAfterRetry = mockGetOpenShifts.mock.calls.length;

      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });

      expect(mockGetOpenShifts.mock.calls.length).toBe(callsAfterRetry);
    });

    it('honours module gates that landed after the first render on a pull-to-refresh', async () => {
      // useEnabledModules answers permissively until the configuration lands,
      // so a refresh closure frozen at first render calls gated endpoints for
      // modules the organisation has disabled -- taking a 403 and raising an
      // error the module-aware initial load correctly avoided.
      mockGetEnabledModules.mockResolvedValue({ configured: true, enabled_modules: ['scheduling'] });

      renderWithRouter(<Dashboard />);

      await screen.findByRole('region', { name: 'Next 30 Days' });
      // Wait for the config to have actually landed. The region renders on the
      // timeline's loading flag, which says nothing about modulesLoading -- so
      // this used to be able to run the whole assertion inside the permissive
      // window, where a zero count means "not settled yet", not "gated". It
      // failed on CI for exactly that reason and passed everywhere else.
      // Scheduling is enabled here, so its loader running is the signal.
      await waitFor(() => expect(mockGetMyShifts).toHaveBeenCalled());
      const screeningCallsBefore = mockGetMyCompliance.mock.calls.length;

      await act(async () => {
        await registeredPullToRefresh?.();
      });

      // Medical screening is disabled, so the refresh must not call it.
      expect(mockGetMyCompliance.mock.calls.length).toBe(screeningCallsBefore);
    });

    it('does not fire gated endpoints when refreshed before the module config lands', async () => {
      // isModuleOn answers permissively until the configuration arrives, so a
      // refresh inside that window calls every gated endpoint and takes a 403
      // per disabled module -- exactly what the mount effect's modulesLoading
      // guard exists to prevent. Making the refresh closure *current* rather
      // than frozen was necessary and not sufficient: current here is still
      // permissive.
      // Every call, not just the first: the hook's effect can run more than
      // once, and a single mockImplementationOnce leaves the next call falling
      // through to the resolved default -- which settles the config and defeats
      // the window this test is about.
      type ModuleConfig = { configured: boolean; enabled_modules: string[] };
      const releaseModules: Array<(value: ModuleConfig) => void> = [];
      mockGetEnabledModules.mockImplementation(
        () => new Promise<ModuleConfig>((resolve) => releaseModules.push(resolve))
      );

      renderWithRouter(<Dashboard />);
      await waitFor(() => expect(releaseModules.length).toBeGreaterThan(0), { timeout: 5000 });

      // The config has not landed, so no module-owned loader may run.
      await act(async () => {
        await registeredPullToRefresh?.();
      });
      expect(mockGetMyCompliance).not.toHaveBeenCalled();
      expect(mockGetMyShifts).not.toHaveBeenCalled();

      // Once it lands with medical screening off, the mount effect runs the
      // module-owned loaders and still honours the gate.
      await act(async () => {
        releaseModules.forEach((resolve) => resolve({ configured: true, enabled_modules: ['scheduling'] }));
        await Promise.resolve();
      });
      await waitFor(() => expect(mockGetMyShifts).toHaveBeenCalled());
      expect(mockGetMyCompliance).not.toHaveBeenCalled();
    });

    it('refreshes the unread count even when an inbox retry is already running', async () => {
      // One key for both message subrequests made the refresh return the
      // in-flight inbox promise and skip the unread half entirely, leaving the
      // badge stale.
      mockGetInbox.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const updates = await screen.findByRole('region', { name: 'My Updates' });
      await within(updates).findByText('Updates could not be fully verified.');
      await user.click(within(updates).getByRole('button', { name: 'Retry updates' }));
      const unreadCallsBefore = mockGetUnreadCount.mock.calls.length;

      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockGetUnreadCount.mock.calls.length).toBeGreaterThan(unreadCallsBefore);
      });
    });

    it('queues the post-signup read behind an older one rather than joining it', async () => {
      // Coalescing is right for idempotent refreshes and wrong after a
      // mutation: a read that started before the signup answers from before
      // it, so joining it can repopulate the shift the member just took -- and
      // nothing later corrects it, because the guard counts that refresh as
      // done. The post-signup read queues instead.
      let releaseOlder: ((value: ShiftRecord[]) => void) | undefined;
      mockGetOpenShifts
        .mockResolvedValueOnce([makeShift({ id: 'open-1' })])
        .mockImplementationOnce(() => new Promise<ShiftRecord[]>((resolve) => (releaseOlder = resolve)))
        .mockResolvedValue([]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /sign up/i }));

      // An older read is left in flight before the mutation.
      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });
      const callsBeforeSignup = mockGetOpenShifts.mock.calls.length;

      await user.click(await screen.findByRole('button', { name: /confirm/i }));
      await waitFor(() => {
        expect(mockSignupForShift).toHaveBeenCalledWith('open-1', { position: 'firefighter' });
      });

      // While the older read is still running, the fresh one has not started.
      expect(mockGetOpenShifts.mock.calls.length).toBe(callsBeforeSignup);

      await act(async () => {
        releaseOlder?.([makeShift({ id: 'open-1' })]);
        await Promise.resolve();
      });

      // Once it settles, the post-signup read runs -- so the stale row the
      // older response carried is corrected rather than left standing.
      await waitFor(() => {
        expect(mockGetOpenShifts.mock.calls.length).toBeGreaterThan(callsBeforeSignup);
      });
    });

    it('keeps a queued read registered when the one it waited on settles', async () => {
      // The predecessor's completion must not deregister its successor. If it
      // does, the key reads idle while the queued read is still running, and
      // the next mutation starts a competing request instead of queueing --
      // undoing the serialisation one step later.
      let releaseFirst: ((value: ShiftRecord[]) => void) | undefined;
      let releaseSecond: ((value: ShiftRecord[]) => void) | undefined;
      mockGetOpenShifts
        .mockResolvedValueOnce([makeShift({ id: 'open-1' })])
        .mockImplementationOnce(() => new Promise<ShiftRecord[]>((resolve) => (releaseFirst = resolve)))
        .mockImplementationOnce(() => new Promise<ShiftRecord[]>((resolve) => (releaseSecond = resolve)))
        .mockResolvedValue([]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /sign up/i }));
      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });

      await user.click(await screen.findByRole('button', { name: /confirm/i }));
      await waitFor(() => expect(mockSignupForShift).toHaveBeenCalled());

      // Release the older read; the queued post-signup read now starts and
      // hangs in turn.
      await act(async () => {
        releaseFirst?.([makeShift({ id: 'open-1' })]);
        await Promise.resolve();
      });
      await waitFor(() => expect(mockGetOpenShifts.mock.calls.length).toBe(3));

      // A second signup must queue behind that still-running read, not race it.
      await user.click(await screen.findByRole('button', { name: /sign up/i }));
      await user.click(await screen.findByRole('button', { name: /confirm/i }));
      await waitFor(() => expect(mockSignupForShift).toHaveBeenCalledTimes(2));

      expect(mockGetOpenShifts.mock.calls.length).toBe(3);
      expect(releaseSecond).toBeDefined();
    });

    it('re-enables the Retry control once its request settles', async () => {
      // The guard must not be a one-way door: a retry that fails has to be
      // retryable again.
      mockGetOpenShifts.mockRejectedValue(new Error('offline'));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await screen.findByText('Some schedule information could not be verified.');
      const retry = screen.getByRole('button', { name: 'Retry schedule' });
      await user.click(retry);

      await waitFor(() => expect(retry).not.toBeDisabled());
    });

    it('stays pressable while only one of the sources it covers is running', async () => {
      // A control covering more than one source was disabled the moment any
      // one of them was in flight, so a slow retry of one blocked recovery of
      // the other. Pressing it is safe: the busy half is joined, the idle half
      // is the only one that starts.
      let releaseShifts: ((value: { shifts: ShiftRecord[]; total: number }) => void) | undefined;
      mockGetMyShifts
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementationOnce(
          () => new Promise<{ shifts: ShiftRecord[]; total: number }>((resolve) => (releaseShifts = resolve))
        );
      mockGetOpenShifts.mockRejectedValue(new Error('offline'));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await screen.findByText('Some schedule information could not be verified.');
      const retry = screen.getByRole('button', { name: 'Retry schedule' });
      await user.click(retry);

      // myShifts is hanging; openShifts settled and failed again, so it is
      // idle and still broken. The control must remain usable for it.
      await waitFor(() => expect(retry).not.toBeDisabled());

      const openCallsBefore = mockGetOpenShifts.mock.calls.length;
      const myCallsBefore = mockGetMyShifts.mock.calls.length;
      await user.click(retry);

      await waitFor(() => {
        expect(mockGetOpenShifts.mock.calls.length).toBeGreaterThan(openCallsBefore);
      });
      // The hanging half is joined, not reissued.
      expect(mockGetMyShifts.mock.calls.length).toBe(myCallsBefore);
      expect(releaseShifts).toBeDefined();
    });

    it('queues the post-RSVP events read behind an older one', async () => {
      // handleEventRSVP writes the server-confirmed status into one row. An
      // events read that started before the mutation still replaces the whole
      // array when it lands, taking that status with it -- so the row offers
      // RSVP buttons again until something else refreshes. The post-mutation
      // read is queued behind it, like the signup path's.
      const rsvpEvent = {
        id: 'evt-1',
        title: 'Ladder Ops Drill',
        event_type: 'training',
        start_datetime: `${inWindow(3)}T14:00:00Z`,
        end_datetime: `${inWindow(3)}T17:00:00Z`,
        requires_rsvp: true,
        is_mandatory: false,
        is_cancelled: false,
      };
      mockGetEvents.mockResolvedValue([rsvpEvent]);
      mockCreateOrUpdateRSVP.mockResolvedValue({ status: 'going' });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);
      await screen.findByRole('button', { name: /^going$/i });

      // Leave an older events read in flight.
      let releaseOlder: ((value: unknown[]) => void) | undefined;
      mockGetEvents.mockImplementationOnce(() => new Promise<unknown[]>((resolve) => (releaseOlder = resolve)));
      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });
      await waitFor(() => expect(releaseOlder).toBeDefined(), { timeout: 5000 });
      const callsBefore = mockGetEvents.mock.calls.length;

      await user.click(screen.getByRole('button', { name: /^going$/i }));
      await waitFor(() => expect(mockCreateOrUpdateRSVP).toHaveBeenCalled());

      // Queued, not racing.
      expect(mockGetEvents.mock.calls.length).toBe(callsBefore);

      await act(async () => {
        releaseOlder?.([rsvpEvent]);
        await Promise.resolve();
      });

      // Once the older read settles, the post-RSVP read runs and lands last.
      await waitFor(() => {
        expect(mockGetEvents.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });

    it('queues a read after marking a notification read', async () => {
      // The row is removed locally. A notifications read that started before
      // the mutation still carries it, so it puts the row back -- and the
      // unread count with it -- when it lands. Same shape as the RSVP and
      // signup paths, so it queues behind whatever is running.
      const log = { id: 'n1', subject: 'Drill reminder', message: 'Tuesday', sent_at: '2026-09-01T12:00:00Z' };
      mockGetMyNotifications.mockResolvedValue({ logs: [log], total: 1 });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);
      const updates = await screen.findByRole('region', { name: 'My Updates' });
      await within(updates).findByText('Drill reminder');

      // Leave an older notifications read in flight.
      let releaseOlder: ((value: { logs: unknown[]; total: number }) => void) | undefined;
      mockGetMyNotifications.mockImplementationOnce(
        () => new Promise<{ logs: unknown[]; total: number }>((resolve) => (releaseOlder = resolve))
      );
      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });
      await waitFor(() => expect(releaseOlder).toBeDefined(), { timeout: 5000 });
      const callsBefore = mockGetMyNotifications.mock.calls.length;

      await user.click(within(updates).getByText('Drill reminder'));
      await waitFor(() => expect(mockMarkNotificationRead).toHaveBeenCalledWith('n1'));

      // Queued, not racing.
      expect(mockGetMyNotifications.mock.calls.length).toBe(callsBefore);

      await act(async () => {
        releaseOlder?.({ logs: [log], total: 1 });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockGetMyNotifications.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });

    it('keeps an acknowledgement when a pre-mutation inbox read lands after it', async () => {
      // The Updates card deliberately keeps rows mounted during an inbox
      // retry, so a member can acknowledge while getInbox is in flight. That
      // read captured the pre-mutation row, so assigning its result whole puts
      // the unacknowledged row back -- asking the member to acknowledge again
      // something the server has already recorded. A refetch is not the fix
      // here: getInbox asks for include_read: false, so it would drop the row
      // the design keeps. The local edit is re-applied to whatever lands.
      const pending = {
        id: 'msg-ack',
        title: 'Hydrant flow testing Saturday',
        body: 'Crews report to Station 2.',
        priority: 'normal',
        target_type: 'all',
        is_pinned: false,
        is_persistent: false,
        requires_acknowledgment: true,
        posted_by: 'officer-1',
        author_name: 'Chief Test',
        created_at: '2026-08-01T12:00:00Z',
        expires_at: null,
        is_read: false,
        read_at: null,
        is_acknowledged: false,
        acknowledged_at: null,
      };
      mockGetInbox.mockResolvedValue([pending]);
      mockGetUnreadCount.mockResolvedValue({ unread_count: 1 });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);
      await screen.findByRole('button', { name: 'Acknowledge' });

      // An inbox read carrying the pre-mutation row is left in flight.
      let releaseStale: ((value: unknown[]) => void) | undefined;
      mockGetInbox.mockImplementationOnce(() => new Promise<unknown[]>((resolve) => (releaseStale = resolve)));
      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });
      await waitFor(() => expect(releaseStale).toBeDefined(), { timeout: 5000 });

      await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
      await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledWith('msg-ack'));

      // The stale read lands, still carrying the unacknowledged row.
      await act(async () => {
        releaseStale?.([pending]);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
      });
    });

    it('joins a pull-to-refresh to a first load still in flight', async () => {
      // Unregistered, the first load let a gesture start a second request for
      // the same source; if the older one settled last it restored its result
      // over the newer one.
      let releaseInitial: ((value: ShiftRecord[]) => void) | undefined;
      mockGetOpenShifts
        .mockImplementationOnce(() => new Promise<ShiftRecord[]>((resolve) => (releaseInitial = resolve)))
        .mockResolvedValue([]);

      renderWithRouter(<Dashboard />);
      await waitFor(() => expect(releaseInitial).toBeDefined(), { timeout: 5000 });
      const callsBefore = mockGetOpenShifts.mock.calls.length;

      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });

      expect(mockGetOpenShifts.mock.calls.length).toBe(callsBefore);
    });

    it('retries a message half that failed after an earlier press', async () => {
      // The Updates retry must read the error state current at the press. An
      // outer key over both halves coalesced on the first press's snapshot, so
      // a second press returned that promise and the half which had failed
      // since was never retried.
      mockGetInbox.mockRejectedValueOnce(new Error('offline')).mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const updates = await screen.findByRole('region', { name: 'My Updates' });
      await within(updates).findByText('Updates could not be fully verified.');
      await user.click(within(updates).getByRole('button', { name: 'Retry updates' }));

      // The unread count breaks while that inbox retry is still hanging.
      mockGetUnreadCount.mockRejectedValue(new Error('offline'));
      await act(async () => {
        void registeredPullToRefresh?.();
        await Promise.resolve();
      });
      await waitFor(() => expect(mockGetUnreadCount).toHaveBeenCalledTimes(2));
      const unreadCallsBefore = mockGetUnreadCount.mock.calls.length;

      await user.click(within(updates).getByRole('button', { name: 'Retry updates' }));

      await waitFor(() => {
        expect(mockGetUnreadCount.mock.calls.length).toBeGreaterThan(unreadCallsBefore);
      });
    });
  });

  it('names each Retry control by the source it retries', async () => {
    // Several of these render together when the dashboard is half-broken, and
    // a screen reader reads only the button's own name.
    mockGetOpenShifts.mockRejectedValue(new Error('offline'));
    mockGetInbox.mockRejectedValue(new Error('offline'));

    renderWithRouter(<Dashboard />);

    expect(await screen.findByRole('button', { name: 'Retry schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry updates' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  describe('Next 30 Days', () => {
    it('merges my shifts, open shifts and events into one list', async () => {
      mockGetMyShifts.mockResolvedValue({
        shifts: [makeShift({ id: 'my-1', shift_date: inWindow(1), apparatus_name: 'Engine 1' })],
        total: 1,
      });
      mockGetOpenShifts.mockResolvedValue([
        makeShift({ id: 'open-1', shift_date: inWindow(2), min_staffing: 4, attendee_count: 1 }),
      ]);
      mockGetEvents.mockResolvedValue([
        {
          id: 'evt-1',
          title: 'Ladder Ops Drill',
          event_type: 'training',
          start_datetime: `${inWindow(3)}T14:00:00Z`,
          end_datetime: `${inWindow(3)}T17:00:00Z`,
          requires_rsvp: true,
          is_mandatory: false,
          is_cancelled: false,
        },
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('heading', { name: 'Next 30 Days' })).toBeInTheDocument();
      // The heading renders above the timeline's own skeleton, so it is no
      // evidence the three sources have merged yet.
      expect(await screen.findByText('Shift · Engine 1')).toBeInTheDocument();
      expect(await screen.findByText('Open Shift')).toBeInTheDocument();
      expect(await screen.findByText('Ladder Ops Drill')).toBeInTheDocument();
    });

    // The window used to be seven days, and the fetches behind it were capped
    // at five records applied *before* the window filter. Widening the window
    // without lifting those caps would have made the card worse, not better:
    // it would promise thirty days and keep showing a handful.
    describe('the reach of the window', () => {
      beforeEach(() => {
        mockGetEvents.mockReset();
        mockGetEvents.mockResolvedValue([]);
        mockGetMyShifts.mockReset();
        mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });
      });

      it('keeps a drill three weeks out, which the seven-day window hid', async () => {
        mockGetEvents.mockResolvedValue([
          {
            id: 'evt-far',
            title: 'Ladder Ops Drill',
            event_type: 'training',
            start_datetime: `${inWindow(20)}T14:00:00Z`,
            end_datetime: `${inWindow(20)}T17:00:00Z`,
            requires_rsvp: true,
            is_mandatory: false,
            is_cancelled: false,
          },
        ]);

        renderWithRouter(<Dashboard />);

        expect(await screen.findByText('Ladder Ops Drill')).toBeInTheDocument();
      });

      // The sixty-day reach is the footer's alone. Letting it into the
      // "Take a Shift" count would quote the member a number matching nothing
      // the card shows, and send them to a schedule not displaying those
      // shifts either.
      it('keeps lookahead shifts out of the quick action, but counts them in the footer', async () => {
        mockGetOpenShifts.mockResolvedValue([
          makeShift({ id: 'open-near', shift_date: inWindow(2), min_staffing: 4, attendee_count: 1 }),
          makeShift({ id: 'open-far', shift_date: pastWindow, min_staffing: 4, attendee_count: 1 }),
        ]);

        renderWithRouter(<Dashboard />);

        const takeAShift = await screen.findByRole('button', { name: /take a shift/i });
        // One open shift inside the window, not the two the fetch returned.
        await waitFor(() => expect(takeAShift).toHaveTextContent('1 open'));
        expect(takeAShift).not.toHaveTextContent('2 open');
        // The far one is still disclosed, as the reach exists to allow.
        expect(await screen.findByRole('button', { name: /1 more open shift/ })).toBeInTheDocument();
      });

      it('asks for the whole window rather than the five soonest events', async () => {
        renderWithRouter(<Dashboard />);

        await waitFor(() => expect(mockGetEvents).toHaveBeenCalled());
        const params = mockGetEvents.mock.calls[0]?.[0] as {
          start_before?: string;
          limit?: number;
        };
        // Asserted as a floor rather than an exact instant: the bound is
        // computed from Date.now() and deliberately overshoots the window, so
        // pinning it exactly would fail on the arithmetic rather than on the
        // behaviour. What matters is that it reaches at least the whole window.
        const reach = new Date(params.start_before ?? 0).getTime() - Date.now();
        expect(reach).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
        expect(params.limit).toBe(500);
      });

      it('asks for more than five of the member’s own shifts', async () => {
        renderWithRouter(<Dashboard />);

        await waitFor(() => expect(mockGetMyShifts).toHaveBeenCalled());
        const params = mockGetMyShifts.mock.calls[0]?.[0] as { end_date?: string; limit?: number };
        expect(params.end_date).toBe(inWindow(30));
        expect(params.limit).toBe(200);
      });

      // The footer can only count open shifts the fetch actually returned, so
      // its reach has to exceed the window the list renders.
      it('reaches past the window for the open shifts the footer counts', async () => {
        renderWithRouter(<Dashboard />);

        await waitFor(() => expect(mockGetOpenShifts).toHaveBeenCalled());
        const params = mockGetOpenShifts.mock.calls[0]?.[0] as { end_date?: string };
        expect(params.end_date).toBe(inWindow(60));
      });
    });

    it('marks the member’s own shifts as theirs', async () => {
      mockGetMyShifts.mockResolvedValue({ shifts: [makeShift({ id: 'my-1' })], total: 1 });

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Yours')).toBeInTheDocument();
    });

    // formatTime() parses an instant; a shift's "08:00" is a time of day and
    // comes back Invalid Date, so every row read "N/A – N/A".
    it('renders shift times rather than N/A', async () => {
      mockGetMyShifts.mockResolvedValue({
        shifts: [makeShift({ id: 'my-1', start_time: '18:00', end_time: '06:00' })],
        total: 1,
      });

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText(/6:00 PM–6:00 AM/)).toBeInTheDocument();
    });

    it('says nothing is scheduled when the week is empty', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText(/Nothing scheduled through/)).toBeInTheDocument();
      });
    });

    it('counts open shifts that fall beyond the window instead of listing them', async () => {
      mockGetOpenShifts.mockResolvedValue([
        makeShift({ id: 'open-late-1', shift_date: pastWindow }),
        makeShift({ id: 'open-late-2', shift_date: pastWindow }),
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('button', { name: /2 more open shifts/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Sign Up$/ })).not.toBeInTheDocument();
    });

    it('caps the list at six rows', async () => {
      mockGetOpenShifts.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => makeShift({ id: `open-${i}`, shift_date: inWindow(i) }))
      );

      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /sign up/i })).toHaveLength(6);
      });
      expect(screen.getByText(/1 more through/)).toBeInTheDocument();
    });

    // On a phone the three quick actions sit below this list, where a thumb
    // reaches. Six rows of shift detail push them off the first screen, so the
    // week collapses to two rows and one line naming the rest.
    it('shows two rows on a phone and names the rest on one line', async () => {
      mockGetOpenShifts.mockResolvedValue(
        Array.from({ length: 4 }, (_, i) => makeShift({ id: `open-${i}`, shift_date: inWindow(i) }))
      );

      renderWithRouter(<Dashboard />);

      await screen.findByRole('button', { name: /Open Shift, and 1 more/ });
      const shiftRows = screen.getAllByRole('listitem').filter((row) => row.textContent?.includes('Open Shift'));
      expect(shiftRows[0]).not.toHaveClass('hidden');
      expect(shiftRows[1]).not.toHaveClass('hidden');
      expect(shiftRows[2]).toHaveClass('hidden', 'sm:list-item');
      expect(shiftRows[3]).toHaveClass('hidden', 'sm:list-item');
      expect(screen.getByRole('button', { name: /Open Shift, and 1 more/ })).toBeInTheDocument();
      // The footer would otherwise read "Nothing else through …" directly under
      // a line promising another row.
      expect(screen.getByTestId('timeline-footer')).toHaveClass('hidden', 'sm:block');
    });

    it('reveals the rest of the week, with its sign-up buttons, when the line is tapped', async () => {
      mockGetOpenShifts.mockResolvedValue(
        Array.from({ length: 4 }, (_, i) => makeShift({ id: `open-${i}`, shift_date: inWindow(i) }))
      );

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /Open Shift, and 1 more/ }));

      const shiftRows = screen.getAllByRole('listitem').filter((row) => row.textContent?.includes('Open Shift'));
      shiftRows.forEach((row) => expect(row).not.toHaveClass('hidden'));
      expect(screen.getAllByRole('button', { name: /^Sign Up$/ })).toHaveLength(4);
    });

    // The footer is the only thing that discloses entries past the six-row
    // desktop cap, and it is held back while the week is collapsed — so this
    // line has to count the whole week, not the rows the list renders.
    it('counts the whole week on the line, including rows past the six-row cap', async () => {
      mockGetOpenShifts.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => makeShift({ id: `open-${i}`, shift_date: inWindow(i) }))
      );

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('button', { name: /Open Shift, and 4 more/ })).toBeInTheDocument();
    });

    it('moves focus onto the first revealed row rather than dropping it', async () => {
      mockGetOpenShifts.mockResolvedValue(
        Array.from({ length: 4 }, (_, i) => makeShift({ id: `open-${i}`, shift_date: inWindow(i) }))
      );

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /Open Shift, and 1 more/ }));

      const shiftRows = screen.getAllByRole('listitem').filter((row) => row.textContent?.includes('Open Shift'));
      await waitFor(() => expect(shiftRows[2]).toHaveFocus());
    });

    it('leaves a short week alone', async () => {
      mockGetOpenShifts.mockResolvedValue([makeShift({ id: 'open-0', shift_date: inWindow(1) })]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('button', { name: /^Sign Up$/ })).toBeInTheDocument();
      expect(screen.getByText(/Nothing else through/)).toBeInTheDocument();
    });

    it('signs the member up for an open shift', async () => {
      mockGetOpenShifts.mockResolvedValue([makeShift({ id: 'open-1' })]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /sign up/i }));
      await user.click(await screen.findByRole('button', { name: /confirm/i }));

      await waitFor(() => {
        expect(mockSignupForShift).toHaveBeenCalledWith('open-1', { position: 'firefighter' });
      });
    });

    it('refreshes both shift lists after a successful signup', async () => {
      mockGetOpenShifts.mockResolvedValue([makeShift({ id: 'open-1' })]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /sign up/i }));
      await screen.findByRole('button', { name: /confirm/i });

      mockGetMyShifts.mockClear();
      mockGetOpenShifts.mockClear();

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() => {
        expect(mockGetMyShifts).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
        expect(mockGetOpenShifts).toHaveBeenCalledWith(
          expect.objectContaining({
            start_date: expect.any(String) as string,
            end_date: expect.any(String) as string,
          })
        );
      });
    });

    it('loads shifts from the member-scoped endpoint', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetMyShifts).toHaveBeenCalledTimes(1);
        expect(mockGetOpenShifts).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Inline event RSVP', () => {
    // Pitfall #28: this block states the mocks it depends on rather than
    // inheriting whatever the block above configured.
    beforeEach(() => {
      mockCreateOrUpdateRSVP.mockReset();
      mockCreateOrUpdateRSVP.mockResolvedValue({ status: 'going' });
      mockGetEvents.mockReset();
      mockGetEvents.mockResolvedValue([
        {
          id: 'evt-1',
          title: 'Ladder Ops Drill',
          event_type: 'training',
          start_datetime: `${inWindow(3)}T14:00:00Z`,
          end_datetime: `${inWindow(3)}T17:00:00Z`,
          requires_rsvp: false,
          is_mandatory: false,
          is_cancelled: false,
        },
      ]);
    });

    it('responds from the timeline without leaving the page', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /going/i }));

      expect(mockCreateOrUpdateRSVP).toHaveBeenCalledWith('evt-1', {
        status: 'going',
        guest_count: 0,
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('offers the controls even when the event requires no RSVP', async () => {
      // The whole point: requires_rsvp is false on the fixture above, and the
      // row previously offered only an "Open" link that navigated away.
      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('button', { name: /going/i })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /can.t/i })).toBeInTheDocument();
    });

    it('falls back to a link once the RSVP deadline has passed', async () => {
      // The API rejects these outright, and a prominent dashboard button that
      // can never succeed is worse than a link to the event.
      mockGetEvents.mockResolvedValue([
        {
          id: 'evt-1',
          title: 'Ladder Ops Drill',
          event_type: 'training',
          start_datetime: `${inWindow(3)}T14:00:00Z`,
          end_datetime: `${inWindow(3)}T17:00:00Z`,
          requires_rsvp: true,
          rsvp_deadline: '2020-01-01T00:00:00Z',
          is_mandatory: false,
          is_cancelled: false,
        },
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('button', { name: /^open$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^going$/i })).not.toBeInTheDocument();
    });

    it('falls back to a link when the event does not accept "going"', async () => {
      // The row only submits `going`; on a maybe-only event the API rejects it
      // deterministically, so the member is better served by the link.
      mockGetEvents.mockResolvedValue([
        {
          id: 'evt-1',
          title: 'Ladder Ops Drill',
          event_type: 'training',
          start_datetime: `${inWindow(3)}T14:00:00Z`,
          end_datetime: `${inWindow(3)}T17:00:00Z`,
          requires_rsvp: true,
          allowed_rsvp_statuses: ['maybe'],
          is_mandatory: false,
          is_cancelled: false,
        },
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('button', { name: /^open$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^going$/i })).not.toBeInTheDocument();
    });

    it("shows the server's status, not the one that was asked for", async () => {
      // A full event answers a "going" request with "waitlisted". Echoing the
      // request back would tell the member they have a seat they did not get.
      const user = userEvent.setup();
      mockCreateOrUpdateRSVP.mockResolvedValue({ status: 'waitlisted' });

      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /going/i }));

      expect(await screen.findByText(/waitlisted/i)).toBeInTheDocument();
    });

    it('leaves the row alone when the response is refused', async () => {
      const user = userEvent.setup();
      mockCreateOrUpdateRSVP.mockRejectedValue(new Error('nope'));

      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: /going/i }));

      await waitFor(() => {
        expect(mockCreateOrUpdateRSVP).toHaveBeenCalled();
      });
      expect(await screen.findByRole('button', { name: /going/i })).toBeInTheDocument();
    });
  });

  describe('Readiness verdict', () => {
    const withCerts = (certs: unknown[]) =>
      mockGetMyTraining.mockResolvedValue({
        hours_summary: { total_hours: 0, hours_this_month: 0 },
        certifications: certs,
      });

    it('stays absent when the member has no tracked certifications', async () => {
      renderWithRouter(<Dashboard />);

      // Wait for the page to settle rather than for the call, so the absence
      // below is a rendered absence and not a race.
      await waitFor(() => {
        expect(screen.getByText(/Nothing scheduled through/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/clear to respond/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Certifications only/)).not.toBeInTheDocument();
    });

    it('reports a clear member', async () => {
      withCerts([
        {
          id: 'c1',
          course_name: 'Firefighter I',
          expiration_date: '2028-01-01',
          is_expired: false,
          days_until_expiry: 500,
        },
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Clear to respond')).toBeInTheDocument();
    });

    it('names the seats the member can hold', async () => {
      withCerts([
        { id: 'c1', course_name: 'Firefighter I', expiration_date: null, is_expired: false, days_until_expiry: null },
      ]);
      mockGetEligiblePositions.mockResolvedValue({ positions: ['firefighter', 'driver'], is_excluded: false });

      renderWithRouter(<Dashboard />);

      const seats = await screen.findByLabelText('Seats you can hold');
      expect(within(seats).getByText('Firefighter')).toBeInTheDocument();
      expect(within(seats).getByText('Driver/Operator')).toBeInTheDocument();
    });

    // A member the department excludes from shift signup — a social or
    // administrative member — has no seats to report. "No seats" is not a
    // readiness finding about them, so the verdict says nothing on the subject
    // rather than implying they failed something.
    it('says nothing about seats for a member excluded from shift signup', async () => {
      withCerts([
        { id: 'c1', course_name: 'Firefighter I', expiration_date: null, is_expired: false, days_until_expiry: null },
      ]);
      mockGetEligiblePositions.mockResolvedValue({ positions: [], is_excluded: true });

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Clear to respond')).toBeInTheDocument();
      expect(screen.queryByLabelText('Seats you can hold')).not.toBeInTheDocument();
      expect(screen.getByText(/Certifications only/)).toBeInTheDocument();
    });

    it('grounds a member whose medical screening is overdue', async () => {
      withCerts([
        { id: 'c1', course_name: 'Firefighter I', expiration_date: null, is_expired: false, days_until_expiry: null },
      ]);
      mockGetMyCompliance.mockResolvedValue({
        total_requirements: 2,
        compliant_count: 1,
        non_compliant_count: 1,
        expiring_soon_count: 0,
        is_fully_compliant: false,
        days_until_next_expiration: null,
      });

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Not clear to respond')).toBeInTheDocument();
      expect(screen.getByText(/1 screening overdue/)).toBeInTheDocument();
    });

    // The dashboard renders on tablets left at stations. The screening figures
    // arrive as counts precisely so a passer-by cannot read which screening a
    // member is behind on, or what it found.
    it('never names a screening', async () => {
      withCerts([]);
      mockGetMyCompliance.mockResolvedValue({
        total_requirements: 1,
        compliant_count: 0,
        non_compliant_count: 1,
        expiring_soon_count: 0,
        is_fully_compliant: false,
        days_until_next_expiration: null,
      });

      renderWithRouter(<Dashboard />);

      await screen.findByText('Not clear to respond');
      for (const term of [/psychological/i, /drug/i, /physical exam/i, /failed/i]) {
        expect(screen.queryByText(term)).not.toBeInTheDocument();
      }
    });

    // A failed read is not a pass. The scope note narrows instead.
    it('does not claim screenings when the read failed', async () => {
      withCerts([
        { id: 'c1', course_name: 'Firefighter I', expiration_date: null, is_expired: false, days_until_expiry: null },
      ]);
      mockGetMyCompliance.mockRejectedValue(new Error('offline'));

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Clear to respond')).toBeInTheDocument();
      expect(screen.getByText(/Certifications and seats/)).toBeInTheDocument();
      expect(screen.queryByText(/screening/i)).not.toBeInTheDocument();
    });

    // A renewed certification keeps its lapsed row in the my-training history.
    // The verdict and the panel read the same deduped list, so neither names an
    // expiry the other has discounted.
    it('does not ground a member who renewed a certification', async () => {
      withCerts([
        {
          id: 'old',
          course_name: 'EMT-B Recertification',
          expiration_date: '2024-09-05',
          is_expired: true,
          days_until_expiry: -700,
        },
        {
          id: 'new',
          course_name: 'EMT-B Recertification',
          expiration_date: '2028-09-05',
          is_expired: false,
          days_until_expiry: 700,
        },
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Clear to respond')).toBeInTheDocument();
      expect(screen.queryByText(/is expired/)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Needs you' })).not.toBeInTheDocument();
    });

    // The general eligibility call takes no shift id; the per-shift one used by
    // a signup row does. Passing an id here would narrow the seats to whatever
    // shift happened to be expanded.
    it('asks for general eligibility, not a shift’s', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetEligiblePositions).toHaveBeenCalledWith();
      });
    });

    it('sits above the panel it summarises', async () => {
      withCerts([
        {
          id: 'c1',
          course_name: 'EMT-B Recertification',
          expiration_date: '2026-09-05',
          is_expired: false,
          days_until_expiry: 24,
        },
      ]);

      renderWithRouter(<Dashboard />);

      const verdict = await screen.findByText('Clear, with conditions');
      const panel = screen.getByRole('heading', { name: 'Needs you' });
      const panelFollowsVerdict = Boolean(verdict.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(panelFollowsVerdict).toBe(true);
    });

    // The verdict and the rows beneath it read the same list, so an expiry can
    // never be urgent in one and fine in the other — but they must not say the
    // same sentence. The verdict counts; the row names it and carries the
    // button.
    it('summarises without restating the row beneath it', async () => {
      withCerts([
        {
          id: 'c1',
          course_name: 'EMT-B Recertification',
          expiration_date: '2026-09-05',
          is_expired: true,
          days_until_expiry: -2,
        },
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Not clear to respond')).toBeInTheDocument();
      // The verdict counts…
      expect(screen.getByText(/1 certification expired/)).toBeInTheDocument();
      // …the row names it, once, and carries the action.
      expect(screen.getAllByText(/EMT-B Recertification/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Start Renewal' })).toBeInTheDocument();
    });
  });

  describe('Needs you', () => {
    const makeMessage = (overrides: Record<string, unknown> = {}) => ({
      id: 'msg-1',
      title: 'Station 2 Bay Doors Out of Service',
      body: 'Use the rear bay until further notice.',
      priority: 'normal',
      target_type: 'all',
      is_pinned: false,
      is_persistent: false,
      requires_acknowledgment: false,
      posted_by: 'officer-1',
      author_name: 'Chief Test',
      created_at: '2026-08-01T12:00:00Z',
      expires_at: null,
      is_read: false,
      read_at: null,
      is_acknowledged: false,
      acknowledged_at: null,
      ...overrides,
    });

    it('stays hidden when nothing needs the member', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetInbox).toHaveBeenCalledWith({ include_read: false, limit: 10 });
      });
      expect(screen.queryByRole('heading', { name: 'Needs you' })).not.toBeInTheDocument();
    });

    it('lists an expiring certification with a renewal action', async () => {
      mockGetMyTraining.mockResolvedValue({
        hours_summary: { total_hours: 0, hours_this_month: 0 },
        certifications: [
          {
            id: 'cert-1',
            course_name: 'EMT-B Recertification',
            expiration_date: '2026-09-05',
            is_expired: false,
            days_until_expiry: 24,
          },
        ],
      });

      renderWithRouter(<Dashboard />);

      const panel = await screen.findByRole('region', { name: 'Needs you' });
      expect(within(panel).getByText('EMT-B Recertification expires in 24 days')).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Start Renewal' })).toBeInTheDocument();
    });

    it('acknowledges a message that requires it', async () => {
      mockGetInbox.mockResolvedValue([
        makeMessage({ id: 'msg-ack', title: 'Hydrant flow testing Saturday', requires_acknowledgment: true }),
      ]);
      mockGetUnreadCount.mockResolvedValue({ unread_count: 1 });

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));

      await waitFor(() => {
        expect(mockAcknowledge).toHaveBeenCalledWith('msg-ack');
      });
    });

    // The old dashboard stated the same message twice — once as a card to
    // acknowledge, once as an activity row. Anything with a button here is
    // deliberately kept out of the feed.
    it('does not repeat an acknowledgement-pending message in the feed', async () => {
      mockGetInbox.mockResolvedValue([
        makeMessage({ id: 'msg-ack', title: 'Hydrant flow testing Saturday', requires_acknowledgment: true }),
      ]);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByText('Hydrant flow testing Saturday')).toBeInTheDocument();
      expect(screen.getAllByText('Hydrant flow testing Saturday')).toHaveLength(1);
    });
  });

  describe('My Updates', () => {
    const makeMessage = (overrides: Record<string, unknown> = {}) => ({
      id: 'msg-1',
      title: 'Station 2 Bay Doors Out of Service',
      body: 'Use the rear bay until further notice.',
      priority: 'normal',
      target_type: 'all',
      is_pinned: false,
      is_persistent: false,
      requires_acknowledgment: false,
      author_name: 'Chief Test',
      created_at: '2026-08-01T12:00:00Z',
      is_read: false,
      is_acknowledged: false,
      ...overrides,
    });

    // MSG2-6: the feed must request only pending + persistent messages —
    // include_read: true would let already-read messages page a persistent
    // standing notice out of the 10-item window.
    it('requests only pending and persistent messages', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetInbox).toHaveBeenCalledWith({ include_read: false, limit: 10 });
      });
    });

    it('renders pending messages, with the badge on persistent ones', async () => {
      mockGetInbox.mockResolvedValue([
        makeMessage(),
        makeMessage({
          id: 'msg-2',
          title: 'SCBA annual inspection mandatory by March 31',
          is_persistent: true,
          is_read: true,
        }),
      ]);

      renderWithRouter(<Dashboard />);

      const feed = await screen.findByRole('region', { name: 'My Updates' });
      // findByText, not getByText: the region renders as soon as the card
      // mounts, with a skeleton inside it, so its presence is no evidence the
      // feed has loaded. The panel waits on both the message and the
      // notification fetch, and those do not settle in a fixed order.
      expect(await within(feed).findByText('Station 2 Bay Doors Out of Service')).toBeInTheDocument();
      expect(await within(feed).findByText('SCBA annual inspection mandatory by March 31')).toBeInTheDocument();
      expect(await within(feed).findByText('Persistent')).toBeInTheDocument();
    });

    // The inbox arrives ordered pinned -> persistent -> newest, and the feed
    // merges it with notifications. Sorting the merged list by recency alone
    // discarded both, so a pinned urgent notice sank below routine
    // notifications -- and only five rows render, so it left the board while
    // still showing its pin icon.
    it('keeps pinned and persistent messages above newer items', async () => {
      mockGetInbox.mockResolvedValue([
        makeMessage({
          id: 'msg-pinned',
          title: 'Station 2 bay doors out of service',
          is_pinned: true,
          created_at: '2026-08-01T12:00:00Z',
        }),
        makeMessage({
          id: 'msg-standing',
          title: 'Spotter required when backing',
          is_persistent: true,
          created_at: '2026-07-01T12:00:00Z',
        }),
        makeMessage({
          id: 'msg-ordinary',
          title: 'Uniform order window closes Friday',
          created_at: '2026-08-20T12:00:00Z',
        }),
      ]);
      mockGetMyNotifications.mockResolvedValue({
        logs: [
          {
            id: 'notif-newest',
            subject: 'Shift reminder for tomorrow',
            message: 'Your shift starts at 07:00.',
            // `sent_at`, not `created_at`: the feed sorts notifications on
            // the send time (the column the backend defaults to now()), and
            // reads created_at only for the relative-time line.
            sent_at: '2026-08-24T12:00:00Z',
            created_at: '2026-08-24T12:00:00Z',
            read: false,
          },
        ],
        total: 1,
      });

      renderWithRouter(<Dashboard />);

      const feed = await screen.findByRole('region', { name: 'My Updates' });
      await within(feed).findByText('Station 2 bay doors out of service');
      const titles = within(feed)
        .getAllByText(
          /Station 2 bay doors out of service|Spotter required when backing|Uniform order window closes Friday|Shift reminder for tomorrow/
        )
        .map((node) => node.textContent);

      expect(titles).toEqual([
        // Pinned, though it is the second-oldest of the four.
        'Station 2 bay doors out of service',
        // Persistent, and the oldest of all.
        'Spotter required when backing',
        // Then recency: the notification, then the ordinary message.
        'Shift reminder for tomorrow',
        'Uniform order window closes Friday',
      ]);
    });

    it('shows an empty state rather than a card full of nothing', async () => {
      renderWithRouter(<Dashboard />);

      const feed = await screen.findByRole('region', { name: 'My Updates' });
      await waitFor(() => {
        expect(within(feed).getByText('Nothing new')).toBeInTheDocument();
      });
    });

    // Message bodies are linkified; an <a> inside a <button> is invalid HTML
    // and the parser splits the row apart, so message rows render as
    // div[role=button]. Following a link must not also fire the row's
    // navigation to the message and yank the current tab away.
    it('lets a body link be followed without triggering the row navigation', async () => {
      mockGetInbox.mockResolvedValue([
        makeMessage({
          id: 'msg-link',
          title: 'Fill the duty survey',
          body: 'Sign up at https://example.com/form today',
          is_read: true,
          is_persistent: true,
        }),
      ]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const feed = await screen.findByRole('region', { name: 'My Updates' });
      const link = await within(feed).findByRole('link', { name: 'https://example.com/form' });
      // jsdom can't navigate; keep the click from hitting the default handler.
      link.addEventListener('click', (e) => e.preventDefault());
      await user.click(link);

      expect(mockNavigate).not.toHaveBeenCalledWith('/messages/msg-link');

      // Clicking the row outside the link still opens that message, whose
      // breadcrumb leads on to the full inbox.
      await user.click(within(feed).getByText('Fill the duty survey'));
      expect(mockNavigate).toHaveBeenCalledWith('/messages/msg-link');
    });

    // Enter on a focused body link bubbles to the row's keydown handler; the
    // anchor's propagation guard covers clicks only, so without a target
    // check the row would swallow the keypress and navigate instead.
    it('lets a body link be activated by keyboard without the row hijacking it', async () => {
      mockGetInbox.mockResolvedValue([
        makeMessage({
          id: 'msg-link-kbd',
          title: 'Fill the duty survey',
          body: 'Sign up at https://example.com/form today',
          is_read: true,
          is_persistent: true,
        }),
      ]);

      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const feed = await screen.findByRole('region', { name: 'My Updates' });
      const link = await within(feed).findByRole('link', { name: 'https://example.com/form' });
      link.addEventListener('click', (e) => e.preventDefault());

      link.focus();
      await user.keyboard('{Enter}');

      expect(mockNavigate).not.toHaveBeenCalledWith('/messages/msg-link-kbd');

      // The row itself still responds to keyboard activation.
      const row = within(feed).getByRole('button', { name: /Fill the duty survey/ });
      row.focus();
      await user.keyboard('{Enter}');
      expect(mockNavigate).toHaveBeenCalledWith('/messages/msg-link-kbd');
    });
  });

  describe('Organization tab', () => {
    it('keeps a leader’s personal equipment totals separate from organization inventory', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      mockGetUserInventory.mockResolvedValue({
        permanent_assignments: [{ item_id: 'item-1', quantity: 1 }],
        active_checkouts: [],
        issued_items: [],
      });
      mockGetInventorySummary.mockResolvedValue({
        total_items: 99,
        total_value: 1000,
        active_checkouts: 12,
        overdue_checkouts: 3,
        maintenance_due_count: 4,
      });

      renderWithRouter(<Dashboard />);

      const equipment = await screen.findByRole('region', { name: 'My Issued Gear' });
      expect(within(equipment).getByText('1')).toBeInTheDocument();
      expect(within(equipment).queryByText('99')).not.toBeInTheDocument();
      expect(mockGetInventorySummary).not.toHaveBeenCalled();
    });

    // Each permanent assignment is one physical unit. The response's quantity
    // field historically carried the catalog's on-hand stock, so a single
    // assignment of an item with 50 units in stock displayed as 50.
    it('counts assignment rows, not any stock quantity the response carries', async () => {
      mockGetUserInventory.mockResolvedValue({
        permanent_assignments: [
          { item_id: 'item-1', quantity: 50 },
          { item_id: 'item-2', quantity: 1 },
        ],
        active_checkouts: [],
        issued_items: [],
      });

      renderWithRouter(<Dashboard />);

      const equipment = await screen.findByRole('region', { name: 'My Issued Gear' });
      expect(within(equipment).getByText('2')).toBeInTheDocument();
      expect(within(equipment).queryByText('51')).not.toBeInTheDocument();
    });

    // Every permission here is granted to DEFAULT_POSITIONS["member"], so gating
    // the tab on any of them put department-wide reporting in front of every
    // firefighter in the department.
    it.each(['inventory.view', 'apparatus.view', 'facilities.view', 'scheduling.view'])(
      'stays hidden from a member holding only the baseline grant %s',
      async (grant) => {
        mockCheckPermission.mockImplementation((permission: string) => permission === grant);

        renderWithRouter(<Dashboard />);

        await waitFor(() => {
          expect(mockGetMyShifts).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByRole('tab', { name: 'My Department' })).not.toBeInTheDocument();
        expect(screen.queryByText('Scheduling Operations')).not.toBeInTheDocument();
      }
    );

    it('is hidden from members without settings.manage', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetMyShifts).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByRole('tab', { name: 'My Department' })).not.toBeInTheDocument();
      expect(
        screen.queryByText('Department-wide staffing, compliance, events, action items, and operations.')
      ).not.toBeInTheDocument();
      expect(mockGetAdminSummary).not.toHaveBeenCalled();
      expect(mockGetSetupChecklist).not.toHaveBeenCalled();
      expect(mockGetInventorySummary).not.toHaveBeenCalled();
    });

    it('separates department-wide reporting from the personal dashboard for leaders', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const personalTab = await screen.findByRole('tab', { name: 'Personal' });
      const departmentTab = screen.getByRole('tab', { name: 'My Department' });
      expect(personalTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Next 30 Days')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Department overview' })).not.toBeInTheDocument();
      expect(mockGetAdminSummary).not.toHaveBeenCalled();
      expect(mockGetSetupChecklist).not.toHaveBeenCalled();
      expect(mockGetInventorySummary).not.toHaveBeenCalled();

      await user.click(departmentTab);

      expect(departmentTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('region', { name: 'Department overview' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Admin Hours:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'My Updates' })).not.toBeInTheDocument();
      expect(screen.queryByText('Next 30 Days')).not.toBeInTheDocument();
      expect(window.location.search).toBe('?tab=department');
      await waitFor(() => {
        expect(mockGetAdminSummary).toHaveBeenCalledTimes(1);
        expect(mockGetSetupChecklist).toHaveBeenCalledTimes(1);
        // The legacy inventory summary no longer owns My Department-tab UI;
        // asset widgets are permission-scoped independently.
        expect(mockGetInventorySummary).not.toHaveBeenCalled();
      });
    });

    it.each(['overview', 'organization'])('keeps legacy %s bookmarks working', async (legacyTab) => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      window.history.replaceState({}, '', `/dashboard?tab=${legacyTab}`);

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('tab', { name: 'My Department' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('region', { name: 'Department overview' })).toBeInTheDocument();
    });

    it('supports keyboard navigation between leadership views', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const personalTab = await screen.findByRole('tab', { name: 'Personal' });
      const departmentTab = screen.getByRole('tab', { name: 'My Department' });
      expect(personalTab).toHaveAttribute('tabindex', '0');
      expect(departmentTab).toHaveAttribute('tabindex', '-1');

      personalTab.focus();
      await user.keyboard('{ArrowRight}');

      expect(departmentTab).toHaveAttribute('aria-selected', 'true');
      expect(departmentTab).toHaveAttribute('tabindex', '0');
      expect(personalTab).toHaveAttribute('tabindex', '-1');
      await waitFor(() => expect(departmentTab).toHaveFocus());
    });

    it('shows a retry state instead of false zero metrics when the department summary fails', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      mockGetAdminSummary.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({});
      window.history.replaceState({}, '', '/dashboard?tab=department');
      const user = userEvent.setup();

      renderWithRouter(<Dashboard />);

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText('Department summary is unavailable')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Department overview' })).not.toBeInTheDocument();

      await user.click(within(alert).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(mockGetAdminSummary).toHaveBeenCalledTimes(2));
    });
  });
});
