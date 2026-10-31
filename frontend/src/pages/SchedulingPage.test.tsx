import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SchedulingPage from './SchedulingPage';
import { schedulingService } from '../modules/scheduling/services/api';
import { useSchedulingStore } from '../modules/scheduling/store/schedulingStore';

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
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [], source: 'default' }),
    getTemplates: vi.fn().mockResolvedValue([]),
    getWeekCalendar: vi.fn().mockResolvedValue([]),
    getMonthCalendar: vi.fn().mockResolvedValue([]),
    getMyAssignments: vi.fn().mockResolvedValue([]),
    getMyShifts: vi.fn().mockResolvedValue([]),
    getOpenShifts: vi.fn().mockResolvedValue([]),
    getShift: vi.fn(),
    createShift: vi.fn(),
    getMySwapRequests: vi.fn().mockResolvedValue([]),
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

// The built-in shift types read the department's default minimum staffing;
// the real accessor keys its cache on the auth store, mocked above as a hook.
vi.mock('../modules/scheduling/services/shiftSettingsApi', () => ({
  getCachedShiftSettings: () => ({ defaultMinStaffing: 4 }),
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

    it('closes an open Create Shift form if scheduling.manage is revoked', async () => {
      const user = userEvent.setup();
      mockCheckPermission.mockImplementation((perm: string) => perm === 'scheduling.manage');

      const { rerender } = renderWithRouter(<SchedulingPage />);
      await waitFor(() => expectTabVisible('Schedule'));

      await user.click(screen.getByRole('button', { name: /Create Shift/i }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();

      // The form only ever posts a scheduling.manage-gated create, so it must
      // not survive the permission going away and offer a Create that 403s.
      mockCheckPermission.mockReturnValue(false);
      rerender(<SchedulingPage />);

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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

  /**
   * Scheduling Administration's header offers Create Shift, and the dialog
   * lives here beside the board, so the header links to `?create=shift`.
   */
  describe('arriving with ?create=shift', () => {
    it('opens Create Shift for a scheduling manager, and spends the request', async () => {
      mockCheckPermission.mockImplementation((perm: string) => perm === 'scheduling.manage');
      window.history.replaceState({}, '', '/scheduling?create=shift');

      renderWithRouter(<SchedulingPage />);

      expect(await screen.findByRole('heading', { name: 'Create Shift' })).toBeInTheDocument();
      // Dropped once read, so a refresh or the back button does not reopen it.
      expect(new URLSearchParams(window.location.search).get('create')).toBeNull();
    });

    it('opens nothing for a viewer who could not create the shift', async () => {
      mockCheckPermission.mockReturnValue(false);
      window.history.replaceState({}, '', '/scheduling?create=shift');

      renderWithRouter(<SchedulingPage />);

      await waitFor(() => expect(new URLSearchParams(window.location.search).get('create')).toBeNull());
      expect(screen.queryByRole('heading', { name: 'Create Shift' })).not.toBeInTheDocument();
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

      const strip = await screen.findByRole('navigation', { name: 'Scheduling views' });
      await user.click(within(strip).getByRole('link', { name: /Shift Reports/i }));

      // Assert on the tab's body, not its label: the labels stay in the DOM
      // either way, which is what let the snap-back through before.
      expect(await screen.findByTestId('shift-reports-tab')).toBeInTheDocument();
      expect(within(strip).getByRole('link', { name: /Shift Reports/i })).toHaveAttribute('aria-current', 'page');
      expect(window.location.search).toContain('tab=shift-reports');
    });

    it('should return to the Schedule tab and drop the tab param', async () => {
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const strip = await screen.findByRole('navigation', { name: 'Scheduling views' });
      await user.click(within(strip).getByRole('link', { name: /Shift Reports/i }));
      await screen.findByTestId('shift-reports-tab');

      // The Schedule link is the bare /scheduling: a missing ?tab= has to
      // select Schedule, or the link would leave the last view on screen.
      await user.click(within(strip).getByRole('link', { name: 'Schedule' }));

      await waitFor(() => expect(screen.queryByTestId('shift-reports-tab')).not.toBeInTheDocument());
      expect(within(strip).getByRole('link', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
      expect(window.location.search).not.toContain('tab=');
    });

    it('keeps the calendar on the same date after visiting another view', async () => {
      window.history.replaceState({}, '', '/scheduling?view=month&date=2026-08-13');
      renderWithRouter(<SchedulingPage />);
      const user = userEvent.setup();

      const strip = await screen.findByRole('navigation', { name: 'Scheduling views' });
      await user.click(within(strip).getByRole('link', { name: 'My Shifts' }));
      await waitFor(() => expect(window.location.search).toContain('tab=my-shifts'));
      await user.click(within(strip).getByRole('link', { name: 'Schedule' }));

      expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
      expect(window.location.search).toContain('date=2026-08-13');
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

      const strip = await screen.findByRole('navigation', { name: 'Scheduling views' });
      expect(within(strip).getByRole('link', { name: 'Schedule' })).toHaveAttribute('aria-current', 'page');
      expect(within(strip).queryByRole('link', { name: /Equipment Checks/i })).not.toBeInTheDocument();
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

  /**
   * A `?shift=` link that will not resolve.
   *
   * This is where the close-out queue's "Open the shift to close it" sends an
   * officer, so the failure lands on somebody who came here to do one specific
   * thing. The handler used to catch it, strip the parameter and render
   * nothing — leaving them on the generic board with no error, no retry, and a
   * URL that no longer said what they had asked for.
   */
  describe('a deep link that fails', () => {
    const mockGetShift = vi.mocked(schedulingService.getShift);

    beforeEach(() => {
      mockGetShift.mockReset();
      mockCheckPermission.mockReturnValue(true);
    });

    it('says the shift could not be opened rather than showing a bare schedule', async () => {
      mockGetShift.mockRejectedValue(new Error('boom'));
      window.history.pushState({}, '', '/scheduling?shift=shift-1');

      renderWithRouter(<SchedulingPage />);

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not be opened/);
    });

    it('keeps the shift in the URL so a retry has something to retry', async () => {
      mockGetShift.mockRejectedValue(new Error('boom'));
      window.history.pushState({}, '', '/scheduling?shift=shift-1');

      renderWithRouter(<SchedulingPage />);
      await screen.findByRole('alert');

      // The parameter is the request. Dropping it on failure discarded what the
      // officer asked for and left the URL describing a page they never chose.
      expect(window.location.search).toContain('shift=shift-1');
    });

    it('retries the same shift, and clears the error when it works', async () => {
      // Driven by a flag rather than `mockRejectedValueOnce`: the effect can run
      // more than once for a single mount, which consumes a one-shot mock before
      // Retry is ever clicked and leaves the test asserting the happy path twice.
      let succeed = false;
      mockGetShift.mockImplementation((() =>
        succeed
          ? Promise.resolve({ id: 'shift-1', shift_date: '2099-01-01' })
          : Promise.reject(new Error('boom'))) as never);
      window.history.pushState({}, '', '/scheduling?shift=shift-1');
      const user = userEvent.setup();
      renderWithRouter(<SchedulingPage />);
      await screen.findByRole('alert');
      succeed = true;

      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('dialog', { name: 'Shift Details' })).toBeInTheDocument();
      expect(screen.queryByText(/could not be opened/)).not.toBeInTheDocument();
      // Stripped now that it resolved, which is the one point at which the
      // request has actually been served.
      expect(window.location.search).not.toContain('shift=shift-1');
    });

    it('lets the officer dismiss it and keep the schedule', async () => {
      mockGetShift.mockRejectedValue(new Error('boom'));
      window.history.pushState({}, '', '/scheduling?shift=shift-1');
      const user = userEvent.setup();
      renderWithRouter(<SchedulingPage />);
      await screen.findByRole('alert');

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));

      expect(screen.queryByText(/could not be opened/)).not.toBeInTheDocument();
      // Dismiss is the one deliberate way the parameter goes without success:
      // the officer has said they are done with it, so a re-render must not
      // reopen the same failure.
      expect(window.location.search).not.toContain('shift=shift-1');
    });
  });

  /**
   * Every control in the Create Shift dialog is reachable by its visible label.
   *
   * The whole modal shipped with no htmlFor/id pair at all, so a screen reader
   * announced nine unnamed fields and clicking a label focused nothing. This
   * asserts the entire set rather than one field: that is the assertion that
   * would have caught the original defect, and it fails loudly if a field is
   * added later without a label.
   */
  describe('form labelling', () => {
    beforeEach(() => {
      mockCheckPermission.mockReturnValue(true);
      // Templates reach the page through the shared store, and the template
      // search box only renders past five of them.
      useSchedulingStore.setState({
        templates: Array.from({ length: 6 }, (_, i) => ({
          id: `t${i}`,
          name: `Template ${i}`,
          is_active: true,
          start_time_of_day: '08:00',
          end_time_of_day: '16:00',
        })) as never,
        templatesLoaded: true,
        // The Apparatus field renders only when the department has apparatus,
        // and Shift Officer only alongside it.
        shiftApparatus: [
          { id: 'a1', unit_number: 'Engine 1', name: 'Engine 1', apparatus_type: 'engine', source: 'apparatus' },
        ],
        shiftApparatusLoaded: true,
        members: [{ id: 'm1', label: 'A Member' }] as never,
        membersLoaded: true,
      });
    });

    afterEach(() => {
      // The page is still mounted and subscribed to the store here, so this
      // reset re-renders it; unwrapped it emits React's act(...) warning, which
      // would sit in the output of every later run and mask a real one.
      act(() => {
        useSchedulingStore.setState({
          templates: [],
          templatesLoaded: false,
          shiftApparatus: [],
          shiftApparatusLoaded: false,
          members: [],
          membersLoaded: false,
        });
      });
    });

    it('moves the board to the date of the shift just created', async () => {
      const user = userEvent.setup();
      // Without apparatus the form asks for none, so a date and a template
      // are all it needs to submit.
      useSchedulingStore.setState({ shiftApparatus: [] });
      vi.mocked(schedulingService.createShift).mockReset();
      vi.mocked(schedulingService.createShift).mockResolvedValue({ id: 'new' } as never);
      renderWithRouter(<SchedulingPage />);

      await user.click(await screen.findByRole('button', { name: /Create Shift/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Create Shift' });
      await user.selectOptions(within(dialog).getByLabelText('Shift Template'), 't0');
      fireEvent.change(within(dialog).getByLabelText(/Start Date/), { target: { value: '2031-03-04' } });
      await user.click(within(dialog).getByRole('button', { name: 'Create Shift' }));

      await waitFor(() => expect(schedulingService.createShift).toHaveBeenCalled());
      await waitFor(() => expect(window.location.search).toContain('date=2031-03-04'));
    });

    it('offers "Create a shift" rather than "the first" once the department has shifts', async () => {
      renderWithRouter(<SchedulingPage />);
      expect(await screen.findByRole('button', { name: 'Create a shift' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Create the first shift' })).not.toBeInTheDocument();
    });

    it('still says "the first" to a department with none on record', async () => {
      vi.mocked(schedulingService.getSummary).mockResolvedValueOnce({
        shifts_scheduled: 0,
        shifts_scheduled_this_week: 0,
        shifts_scheduled_this_month: 0,
        hours_worked_this_month: 0,
      } as never);
      renderWithRouter(<SchedulingPage />);
      expect(await screen.findByRole('button', { name: 'Create the first shift' })).toBeInTheDocument();
    });

    it('names every field in the Create Shift dialog', async () => {
      const user = userEvent.setup();
      renderWithRouter(<SchedulingPage />);

      await user.click(await screen.findByRole('button', { name: /Create Shift/ }));
      await screen.findByRole('heading', { name: 'Create Shift' });

      expect(screen.getByLabelText('Shift Template')).toBeInTheDocument();
      expect(screen.getByLabelText('Search shift templates')).toBeInTheDocument();
      expect(screen.getByLabelText(/Start Date/)).toBeInTheDocument();
      expect(screen.getByLabelText('End Date')).toBeInTheDocument();

      // Apparatus, the times and Notes live behind the collapsible section.
      await user.click(screen.getByRole('button', { name: /Additional Options/ }));

      expect(screen.getByLabelText(/Apparatus/)).toBeInTheDocument();
      for (const field of ['Start Time', 'End Time']) {
        for (const part of ['hour', 'minute', 'AM/PM']) {
          expect(screen.getByRole('combobox', { name: `${field} ${part}` })).toBeInTheDocument();
        }
      }
      expect(screen.getByLabelText(/Shift Officer/)).toBeInTheDocument();
      expect(screen.getByLabelText('Notes')).toBeInTheDocument();

      // Custom Times heads a pair of fields rather than naming one, so it is a
      // group rather than a label.
      expect(screen.getByRole('group', { name: /Custom Times/ })).toBeInTheDocument();
    });
  });
  /**
   * A hand-created shift inherits its template's equipment checklists only
   * through `template_id`; without it the shift had no checklists at all.
   */
  describe('creating a shift from a template', () => {
    const mockCreateShift = vi.mocked(schedulingService.createShift);

    beforeEach(() => {
      mockCreateShift.mockReset();
      mockCreateShift.mockResolvedValue({ id: 'new-shift' } as never);
      mockCheckPermission.mockReturnValue(true);
    });

    afterEach(() => {
      act(() => {
        useSchedulingStore.setState({ templates: [], templatesLoaded: false });
      });
    });

    async function createFromForm() {
      const user = userEvent.setup();
      renderWithRouter(<SchedulingPage />);
      await user.click(await screen.findByRole('button', { name: /Create Shift/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Create Shift' });
      fireEvent.change(within(dialog).getByLabelText(/Start Date/), { target: { value: '2099-03-04' } });
      await user.click(within(dialog).getByRole('button', { name: 'Create Shift' }));
      await waitFor(() => expect(mockCreateShift).toHaveBeenCalledTimes(1));
      return mockCreateShift.mock.calls[0]?.[0];
    }

    it('sends the id of a template loaded from the backend', async () => {
      useSchedulingStore.setState({
        templates: [
          {
            id: 'tmpl-engine-day',
            name: 'Engine Day',
            is_active: true,
            is_default: true,
            start_time_of_day: '07:00',
            end_time_of_day: '19:00',
            duration_hours: 12,
          },
        ] as never,
        templatesLoaded: true,
      });

      const payload = await createFromForm();

      expect(payload).toMatchObject({ shift_date: '2099-03-04', template_id: 'tmpl-engine-day' });
    });

    it('sends no template id for a built-in fallback template', async () => {
      useSchedulingStore.setState({ templates: [], templatesLoaded: true });

      const payload = await createFromForm();

      expect(payload).toMatchObject({ shift_date: '2099-03-04' });
      expect(payload).not.toHaveProperty('template_id');
    });
  });
});
