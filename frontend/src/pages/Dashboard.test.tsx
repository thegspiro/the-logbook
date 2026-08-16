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
  mockAcknowledge,
  mockGetMyTraining,
  mockGetEvents,
  mockCheckPermission,
  mockGetAdminSummary,
  mockGetSetupChecklist,
  mockGetUserInventory,
  mockGetInventorySummary,
} = vi.hoisted(() => ({
  mockGetMyShifts: vi.fn(),
  mockGetOpenShifts: vi.fn(),
  mockSignupForShift: vi.fn(),
  mockGetInbox: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockAcknowledge: vi.fn(),
  mockGetMyTraining: vi.fn(),
  mockGetEvents: vi.fn(),
  mockCheckPermission: vi.fn(),
  mockGetAdminSummary: vi.fn(),
  mockGetSetupChecklist: vi.fn(),
  mockGetUserInventory: vi.fn(),
  mockGetInventorySummary: vi.fn(),
}));

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyShifts: mockGetMyShifts,
    getOpenShifts: mockGetOpenShifts,
    getSummary: vi
      .fn()
      .mockResolvedValue({ total_shifts: 0, shifts_this_week: 0, shifts_this_month: 0, total_hours_this_month: 0 }),
    signupForShift: mockSignupForShift,
    getEligiblePositions: vi.fn().mockResolvedValue({ positions: ['firefighter'] }),
  },
}));

vi.mock('../services/api', () => ({
  notificationsService: {
    getMyNotifications: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
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
    getMyEnrollments: vi.fn().mockResolvedValue([]),
    getEnrollmentProgress: vi.fn().mockResolvedValue({}),
  },
  trainingModuleConfigService: {
    getMyTraining: mockGetMyTraining,
  },
  organizationService: {
    getSetupChecklist: mockGetSetupChecklist,
  },
  inventoryService: {
    getUserInventory: mockGetUserInventory,
    getSummary: mockGetInventorySummary,
    getLowStockItems: vi.fn().mockResolvedValue([]),
  },
  eventService: {
    getEvents: mockGetEvents,
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
    getSummary: vi.fn().mockResolvedValue({ totalHours: 0 }),
  },
}));

// Mock auth store
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: mockCheckPermission,
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

/** Inside the seven-day window the timeline covers, whatever day the suite runs. */
const inWindow = (offsetDays: number) => addCalendarDays(getTodayLocalDate('America/New_York'), offsetDays);
/** Past the window, so it only counts toward the "more open shifts" footer. */
const pastWindow = addCalendarDays(getTodayLocalDate('America/New_York'), 20);

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
    mockAcknowledge.mockResolvedValue(undefined);
    mockGetMyTraining.mockResolvedValue({ hours_summary: { total_hours: 0, hours_this_month: 0 }, certifications: [] });
    mockGetEvents.mockResolvedValue([]);
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

  describe('Next 7 Days', () => {
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

      expect(await screen.findByRole('heading', { name: 'Next 7 Days' })).toBeInTheDocument();
      expect(screen.getByText('Shift · Engine 1')).toBeInTheDocument();
      expect(screen.getByText('Open Shift')).toBeInTheDocument();
      expect(screen.getByText('Ladder Ops Drill')).toBeInTheDocument();
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
        expect(mockGetMyShifts).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
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

  describe('Department Feed', () => {
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
      expect(within(feed).getByText('Station 2 Bay Doors Out of Service')).toBeInTheDocument();
      expect(within(feed).getByText('SCBA annual inspection mandatory by March 31')).toBeInTheDocument();
      expect(within(feed).getByText('Persistent')).toBeInTheDocument();
    });

    it('shows an empty state rather than a card full of nothing', async () => {
      renderWithRouter(<Dashboard />);

      const feed = await screen.findByRole('region', { name: 'My Updates' });
      await waitFor(() => {
        expect(within(feed).getByText('Nothing new')).toBeInTheDocument();
      });
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

    it('is hidden from members without settings.manage', async () => {
      renderWithRouter(<Dashboard />);

      await waitFor(() => {
        expect(mockGetMyShifts).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByRole('tab', { name: 'Organization' })).not.toBeInTheDocument();
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

      const personalTab = await screen.findByRole('tab', { name: 'My Department' });
      const organizationTab = screen.getByRole('tab', { name: 'Organization' });
      expect(personalTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Next 7 Days')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Department overview' })).not.toBeInTheDocument();
      expect(mockGetAdminSummary).not.toHaveBeenCalled();
      expect(mockGetSetupChecklist).not.toHaveBeenCalled();
      expect(mockGetInventorySummary).not.toHaveBeenCalled();

      await user.click(organizationTab);

      expect(organizationTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('region', { name: 'Department overview' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Admin Hours:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'My Updates' })).not.toBeInTheDocument();
      expect(screen.queryByText('Next 7 Days')).not.toBeInTheDocument();
      expect(window.location.search).toBe('?tab=organization');
      await waitFor(() => {
        expect(mockGetAdminSummary).toHaveBeenCalledTimes(1);
        expect(mockGetSetupChecklist).toHaveBeenCalledTimes(1);
        expect(mockGetInventorySummary).toHaveBeenCalledTimes(1);
      });
    });

    it('keeps legacy overview bookmarks working', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      window.history.replaceState({}, '', '/dashboard?tab=overview');

      renderWithRouter(<Dashboard />);

      expect(await screen.findByRole('tab', { name: 'Organization' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('region', { name: 'Department overview' })).toBeInTheDocument();
    });

    it('supports keyboard navigation between leadership views', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      const user = userEvent.setup();
      renderWithRouter(<Dashboard />);

      const personalTab = await screen.findByRole('tab', { name: 'My Department' });
      const organizationTab = screen.getByRole('tab', { name: 'Organization' });
      expect(personalTab).toHaveAttribute('tabindex', '0');
      expect(organizationTab).toHaveAttribute('tabindex', '-1');

      personalTab.focus();
      await user.keyboard('{ArrowRight}');

      expect(organizationTab).toHaveAttribute('aria-selected', 'true');
      expect(organizationTab).toHaveAttribute('tabindex', '0');
      expect(personalTab).toHaveAttribute('tabindex', '-1');
      await waitFor(() => expect(organizationTab).toHaveFocus());
    });

    it('shows a retry state instead of false zero metrics when the organization summary fails', async () => {
      mockCheckPermission.mockImplementation((permission: string) => permission === 'settings.manage');
      mockGetAdminSummary.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({});
      window.history.replaceState({}, '', '/dashboard?tab=organization');
      const user = userEvent.setup();

      renderWithRouter(<Dashboard />);

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText('Organization summary is unavailable')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Department overview' })).not.toBeInTheDocument();

      await user.click(within(alert).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(mockGetAdminSummary).toHaveBeenCalledTimes(2));
    });
  });
});
