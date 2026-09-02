import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import Dashboard from './Dashboard';
import type { ShiftRecord } from '../modules/scheduling/services/api';
import { getTodayLocalDate, addCalendarDays } from '../utils/dateFormatting';

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
  mockGetAdminHoursSummary,
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
  mockGetAdminHoursSummary: vi.fn(),
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
    markMyNotificationRead: vi.fn().mockResolvedValue(undefined),
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
    getEnrollmentProgress: vi.fn().mockResolvedValue({}),
  },
  trainingModuleConfigService: {
    getMyTraining: mockGetMyTraining,
  },
  organizationService: {
    getSetupChecklist: mockGetSetupChecklist,
    // Reached via DashboardOrientation -> useEnabledModules, which decides
    // which learning lessons count toward the orientation prompt.
    getEnabledModules: vi.fn().mockResolvedValue({ enabled_modules: [] }),
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

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mockGetMyShifts.mockResolvedValue({ shifts: [], total: 0 });
    mockGetOpenShifts.mockResolvedValue([]);
    mockSignupForShift.mockResolvedValue({});
    mockGetInbox.mockResolvedValue([]);
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
    mockGetMyNotifications.mockResolvedValue({ logs: [], total: 0 });
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
    mockGetSchedulingSummary.mockResolvedValue({
      total_shifts: 0,
      shifts_this_week: 0,
      shifts_this_month: 0,
      total_hours_this_month: 0,
    });
    mockGetTrainingEnrollments.mockResolvedValue([]);
    mockGetAdminHoursSummary.mockResolvedValue({ totalHours: 0 });
    mockCheckPermission.mockReturnValue(false);
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
      await user.click(within(updates).getByRole('button', { name: 'Retry' }));

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

      await user.click(within(timeline).getByRole('button', { name: 'Retry' }));

      expect(await within(timeline).findByText('Open Shift')).toBeInTheDocument();
      await waitFor(() => expect(within(timeline).queryByRole('alert')).not.toBeInTheDocument());
      expect(within(timeline).getByText('Shift · Engine 7')).toBeInTheDocument();
      expect(within(timeline).getByText('Live Fire Drill')).toBeInTheDocument();
    });
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
