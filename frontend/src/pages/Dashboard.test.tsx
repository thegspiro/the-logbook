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
  mockGetEligiblePositions,
  mockGetMyCompliance,
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
  mockGetEligiblePositions: vi.fn(),
  mockGetMyCompliance: vi.fn(),
}));

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getMyShifts: mockGetMyShifts,
    getOpenShifts: mockGetOpenShifts,
    getSummary: vi
      .fn()
      .mockResolvedValue({ total_shifts: 0, shifts_this_week: 0, shifts_this_month: 0, total_hours_this_month: 0 }),
    signupForShift: mockSignupForShift,
    getEligiblePositions: mockGetEligiblePositions,
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

    // Message bodies are linkified; an <a> inside a <button> is invalid HTML
    // and the parser splits the row apart, so message rows render as
    // div[role=button]. Following a link must not also fire the row's
    // navigation to /messages and yank the current tab away.
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
      const link = within(feed).getByRole('link', { name: 'https://example.com/form' });
      // jsdom can't navigate; keep the click from hitting the default handler.
      link.addEventListener('click', (e) => e.preventDefault());
      await user.click(link);

      expect(mockNavigate).not.toHaveBeenCalledWith('/messages');

      // Clicking the row outside the link still opens the messages page.
      await user.click(within(feed).getByText('Fill the duty survey'));
      expect(mockNavigate).toHaveBeenCalledWith('/messages');
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

      const equipment = await screen.findByRole('region', { name: 'My Equipment' });
      expect(within(equipment).getByText('2')).toBeInTheDocument();
      expect(within(equipment).queryByText('51')).not.toBeInTheDocument();
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
