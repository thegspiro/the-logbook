import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import EventEditPage from './EventEditPage';
import * as apiModule from '../services/api';
import type { Event, EventCategoryConfig } from '../types/event';
import type { TrainingSessionResponse } from '../services/api';
import { ATTENDANCE_LOCKED_EVENT_FIELDS } from '../utils/eventAttendanceLock';

/** Create a mock API error object (not a Promise) */
function makeApiError(message: string, status = 400) {
  const error = new Error(message) as Error & {
    response: { data: { detail: string }; status: number };
  };
  error.response = { data: { detail: message }, status };
  return error;
}

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getEvent: vi.fn(),
    updateEvent: vi.fn(),
    updateFutureEvents: vi.fn(),
    getEvents: vi.fn().mockResolvedValue([]),
    getVisibleEventTypes: vi.fn().mockResolvedValue([]),
    // Installed per test in the top-level beforeEach, so a block that adds
    // categories cannot leave them behind for the next one (pitfall #28).
    getVisibleEventTypesWithCategories: vi.fn(),
  },
  roleService: {
    getRoles: vi.fn().mockResolvedValue([]),
  },
  locationsService: {
    getLocations: vi.fn().mockResolvedValue([]),
  },
  // The training form's: a Training event's session, the Course Library and
  // the lead instructor list. Installed per test in the top-level beforeEach.
  trainingSessionService: { getSessionByEvent: vi.fn(), getMandatoryTiers: vi.fn() },
  trainingService: { getCourses: vi.fn() },
  userService: { getUsers: vi.fn() },
}));

const linkageRequirements = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('../hooks/useTrainingLinkageData', () => ({
  useTrainingLinkageData: () => ({ categories: [], requirements: linkageRequirements.value, programs: [], phases: [] }),
}));

vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

// The page reads events.manage itself now that the route also admits
// training.manage. Every block but the training-manager one is an events
// manager, which is what the route guard alone used to guarantee.
const mockPermissions = new Set<string>();
const mockAuthState = {
  user: { id: 'user-1' },
  checkPermission: (permission: string) => mockPermissions.has(permission),
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: typeof mockAuthState) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

// Mock the useTimezone hook used by EventForm
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Mock react-router
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'evt-1' }),
  };
});

const mockEvent: Event = {
  id: 'evt-1',
  organization_id: 'org-1',
  title: 'Existing Event',
  description: 'An event that already exists.',
  event_type: 'business_meeting',
  location: 'Conference Room',
  start_datetime: '2026-03-15T18:00',
  end_datetime: '2026-03-15T20:00',
  requires_rsvp: true,
  is_mandatory: false,
  allow_guests: false,
  send_reminders: true,
  reminder_target: 'all',
  reminder_schedule: [24],
  is_cancelled: false,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-20T10:00:00Z',
};

/** The org's event settings, with whatever custom categories a test needs. */
function visibleTypesWith(categories: EventCategoryConfig[] = []) {
  return {
    visible_event_types: [],
    custom_event_categories: categories,
    visible_custom_categories: categories.map((c) => c.value),
    // Empty: the form keeps its built-in fallback list, as when none is served.
    membership_types: [],
  };
}

describe('EventEditPage', () => {
  const { eventService, trainingSessionService, trainingService, userService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.clear();
    mockPermissions.add('events.manage');
    // ?step= is read from the URL; a test that sets it must not leave it.
    window.history.replaceState({}, '', '/events/evt-1/edit');
    linkageRequirements.value = [];
    vi.mocked(eventService.getVisibleEventTypesWithCategories).mockReset();
    vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue(visibleTypesWith());
    vi.mocked(trainingSessionService.getSessionByEvent).mockReset();
    vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue(null);
    vi.mocked(trainingSessionService.getMandatoryTiers).mockReset();
    vi.mocked(trainingSessionService.getMandatoryTiers).mockResolvedValue({
      everyone: false,
      tier_ids: [],
      unmapped: [],
    });
    vi.mocked(trainingService.getCourses).mockReset();
    vi.mocked(trainingService.getCourses).mockResolvedValue([]);
    vi.mocked(userService.getUsers).mockReset();
    vi.mocked(userService.getUsers).mockResolvedValue([]);
    vi.mocked(eventService.getEvents).mockReset();
    vi.mocked(eventService.getEvents).mockResolvedValue([]);
  });

  describe('Loading State', () => {
    it('should display loading spinner while fetching event', () => {
      vi.mocked(eventService.getEvent).mockImplementation(() => new Promise(() => {}));

      renderWithRouter(<EventEditPage />);

      expect(screen.getByText('Loading event...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error when event fails to load', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(makeApiError('Event not found', 404));

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByText('Event not found')).toBeInTheDocument();
      });
    });

    it('should show back to events link on error', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(makeApiError('Event not found', 404));

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        const backButton = screen.getByRole('button', { name: /back to events/i });
        expect(backButton).toBeInTheDocument();
      });
    });
  });

  describe('Loaded State', () => {
    it('should display Edit Event heading', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit Event');
      });
    });

    it('should trail back to the event and name it in the description', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      // The trail starts from the section the URL sits under.
      window.history.replaceState({}, '', '/events/evt-1/edit');

      renderWithRouter(<EventEditPage />);

      // Waits for the loaded page: the loading state's trail cannot name the event yet.
      const eventCrumb = await screen.findByRole('link', { name: 'Existing Event' });
      expect(eventCrumb).toHaveAttribute('href', '/events/evt-1');
      expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toContainElement(eventCrumb);
      expect(screen.getByText(/Update the details for/)).toBeInTheDocument();
    });

    it('should pre-fill form with event data', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event');
      });
      expect(screen.getByLabelText(/who should receive reminders/i)).toHaveValue('all');
    });

    it("hydrates the event's attendee-visibility override", async () => {
      // initialData is built field by field, and omitting this left the select
      // showing "Use organization default" for an event that actually
      // overrode it. Worse, because that option was already displayed,
      // choosing it fired no change event — so the override could not be
      // cleared either, on the one screen that edits it.
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, attendee_visibility: 'members' });

      renderWithRouter(<EventEditPage />);

      expect(await screen.findByLabelText(/who can see who's going/i)).toHaveValue('members');
    });

    it('shows the inherit state when the event sets no override', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, attendee_visibility: null });

      renderWithRouter(<EventEditPage />);

      expect(await screen.findByLabelText(/who can see who's going/i)).toHaveValue('');
    });

    it('should show Save Changes as submit button label', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should navigate to event detail on successful update', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.updateEvent).mockResolvedValue({} as unknown as Event);

      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event');
      });

      // Change title
      const titleInput = screen.getByLabelText(/title/i);
      await user.clear(titleInput);
      await user.type(titleInput, 'Updated Event Title');

      // Submit
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(eventService.updateEvent).toHaveBeenCalledWith(
          'evt-1',
          expect.objectContaining({
            title: 'Updated Event Title',
          })
        );
        expect(mockNavigate).toHaveBeenCalledWith('/events/evt-1');
      });
    });

    // The update path reads an omitted key as "leave alone": an emptied
    // description or location used to come back after a successful save.
    it('sends emptied fields as null so the clear is saved', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, max_attendees: 40 });
      vi.mocked(eventService.updateEvent).mockResolvedValue({} as unknown as Event);

      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.clear(await screen.findByLabelText(/description/i));
      await user.clear(screen.getByPlaceholderText(/station 1 conference room/i));
      await user.clear(screen.getByLabelText(/max attendees/i));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(eventService.updateEvent).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({ description: null, location: null, location_id: null, max_attendees: null })
      );
    });

    it('should display error on failed update', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.updateEvent).mockRejectedValue(makeApiError('Location conflict', 409));

      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event');
      });

      // Submit
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        // Error appears in both EventEditPage and EventForm error displays
        const errors = screen.getAllByText('Location conflict');
        expect(errors.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Values the form must load before it saves (Events edit-form gaps)', () => {
    async function saveUnchanged() {
      renderWithRouter(<EventEditPage />);
      await waitFor(() => expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event'));
      await userEvent.setup().click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      return vi.mocked(eventService.updateEvent).mock.calls[0]?.[1] as Record<string, unknown>;
    }

    // The key absent, as the API omits it, rather than present and undefined.
    const { check_in_minutes_before: _stored, ...withoutLeadTime } = mockEvent;

    beforeEach(() => {
      vi.mocked(eventService.updateEvent).mockReset();
      vi.mocked(eventService.updateEvent).mockResolvedValue({} as unknown as Event);
    });

    it('saving a draft keeps it a draft', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, is_draft: true });

      expect((await saveUnchanged()).is_draft).toBe(true);
    });

    it('a window-type event with no stored lead time keeps the 15 minutes the server uses', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...withoutLeadTime, check_in_window_type: 'window' });

      expect((await saveUnchanged()).check_in_minutes_before).toBe(15);
    });

    it('a flexible event with no stored lead time keeps 60', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...withoutLeadTime, check_in_window_type: 'flexible' });

      expect((await saveUnchanged()).check_in_minutes_before).toBe(60);
    });
  });

  // The single-page form's lock. A Training event's, which also locks its
  // training details, is under "A Training event" below.
  describe('Finalized attendance', () => {
    const finalizedEvent: Event = {
      ...mockEvent,
      event_type: 'business_meeting',
      start_datetime: '2026-03-15T18:00:00Z',
      end_datetime: '2026-03-15T20:00:00Z',
      check_in_window_type: 'flexible',
      check_in_minutes_before: 60,
      check_in_minutes_after: 15,
      require_checkout: false,
      attendance_finalized_at: '2026-03-15T21:00:00Z',
    };

    beforeEach(() => {
      vi.mocked(eventService.getEvent).mockReset();
      vi.mocked(eventService.updateEvent).mockReset();
      vi.mocked(eventService.updateFutureEvents).mockReset();
      vi.mocked(eventService.updateEvent).mockResolvedValue(finalizedEvent);
      vi.mocked(eventService.updateFutureEvents).mockResolvedValue({ updated_count: 3 });
    });

    const retitle = async (user: ReturnType<typeof userEvent.setup>) => {
      const title = await screen.findByLabelText(/^title/i);
      await user.clear(title);
      await user.type(title, 'Existing Event (corrected)');
      await user.click(screen.getByRole('button', { name: /save changes/i }));
    };

    it('shows the lock notice', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(finalizedEvent);

      renderWithRouter(<EventEditPage />);

      expect(await screen.findByText(/attendance for this event is finalized/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/event type/i)).toBeDisabled();
    });

    it('saves a title fix without the locked fields', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(finalizedEvent);
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await retitle(user);

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      const [eventId, payload] = vi.mocked(eventService.updateEvent).mock.calls[0] ?? [];
      expect(eventId).toBe('evt-1');
      expect(payload).toEqual(expect.objectContaining({ title: 'Existing Event (corrected)' }));
      for (const field of ATTENDANCE_LOCKED_EVENT_FIELDS) {
        expect(payload).not.toHaveProperty(field);
      }
      expect(mockNavigate).toHaveBeenCalledWith('/events/evt-1');
    });

    it('saves this and all future events without the locked fields', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...finalizedEvent, recurrence_parent_id: 'series-1' });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.click(await screen.findByLabelText(/this and all future events/i));
      await retitle(user);

      await waitFor(() => expect(eventService.updateFutureEvents).toHaveBeenCalledTimes(1));
      const [, payload] = vi.mocked(eventService.updateFutureEvents).mock.calls[0] ?? [];
      expect(payload).toEqual(expect.objectContaining({ title: 'Existing Event (corrected)' }));
      for (const field of ATTENDANCE_LOCKED_EVENT_FIELDS) {
        expect(payload).not.toHaveProperty(field);
      }
      expect(eventService.updateEvent).not.toHaveBeenCalled();
    });

    it('still sends them for an event whose attendance is open', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...finalizedEvent, attendance_finalized_at: null });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await retitle(user);

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(eventService.updateEvent).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({
          title: 'Existing Event (corrected)',
          event_type: 'business_meeting',
          start_datetime: '2026-03-15T18:00:00.000Z',
          end_datetime: '2026-03-15T20:00:00.000Z',
          check_in_window_type: 'flexible',
          check_in_minutes_before: 60,
          require_checkout: false,
        })
      );
      expect(screen.queryByText(/attendance for this event is finalized/i)).not.toBeInTheDocument();
    });
  });

  describe('Loads every field it saves', () => {
    beforeEach(() => {
      vi.mocked(eventService.getEvent).mockReset();
      vi.mocked(eventService.updateEvent).mockReset();
      vi.mocked(eventService.updateEvent).mockResolvedValue(mockEvent);
    });

    it('saves a mandatory event with the member types it already has', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        is_mandatory: true,
        mandatory_membership_types: ['active'],
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.click(await screen.findByRole('button', { name: /save changes/i }));

      await waitFor(() =>
        expect(eventService.updateEvent).toHaveBeenCalledWith(
          'evt-1',
          expect.objectContaining({ is_mandatory: true, mandatory_membership_types: ['active'] })
        )
      );
      expect(screen.queryByText(/select at least one member type/i)).not.toBeInTheDocument();
    });

    it('saves a mandatory event stored with no member types as mandatory for every member', async () => {
      // How every course-cohort class is stored. The API reads no member types
      // as everyone; the form used to refuse each save, title fixes on a
      // finalized class included, until somebody narrowed it. A class is a
      // Training event, which the training form edits (its case is under "A
      // Training event"); this is the single-page form's.
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        event_type: 'business_meeting',
        is_mandatory: true,
        attendance_finalized_at: '2026-03-15T21:00:00Z',
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      expect(await screen.findByRole('radio', { name: 'All members' })).toBeChecked();
      const title = screen.getByLabelText(/^title/i);
      await user.clear(title);
      await user.type(title, 'Recruit school, class 3 (corrected)');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      const [, payload] = vi.mocked(eventService.updateEvent).mock.calls[0] ?? [];
      expect(payload).toEqual(
        expect.objectContaining({ title: 'Recruit school, class 3 (corrected)', is_mandatory: true })
      );
      // All members is sent, as every field the form owns is on an update
      // (pitfall #1): the empty list the API reads as every member.
      expect(payload?.mandatory_membership_types).toEqual([]);
      expect(screen.queryByText(/select at least one member type/i)).not.toBeInTheDocument();
    });

    // Every member is the All members choice. "Only these member types" with
    // none ticked, whether unticked or newly made mandatory, is refused under
    // the field: the server would read the empty list as every member.
    it('still asks for a member type when every saved one is unticked', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        is_mandatory: true,
        mandatory_membership_types: ['active'],
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.click(await screen.findByLabelText('Active'));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() =>
        expect(screen.getByLabelText('Active')).toHaveAccessibleDescription(
          'Select at least one member type, or choose All members.'
        )
      );
      expect(eventService.updateEvent).not.toHaveBeenCalled();
    });

    it('still asks for a member type when an event is newly made mandatory', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.click(await screen.findByLabelText(/mandatory attendance/i));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() =>
        expect(screen.getByLabelText('Active')).toHaveAccessibleDescription(
          'Select at least one member type, or choose All members.'
        )
      );
      expect(eventService.updateEvent).not.toHaveBeenCalled();
    });

    it('shows a saved member type the department no longer lists, so it can be removed', async () => {
      vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue({
        ...visibleTypesWith(),
        membership_types: [{ value: 'active', label: 'Active Member' }],
      });
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        is_mandatory: true,
        mandatory_membership_types: ['administrative'],
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      // The box appears only once the event and the department's types have
      // both loaded; under a loaded runner that took 1,075ms, past the 1s
      // default, so the wait is lengthened rather than the run retried.
      const stale = await screen.findByLabelText(/administrative \(not a current member type\)/i, undefined, {
        timeout: 5000,
      });
      expect(stale).toBeChecked();
      // A 16px box: the 44px target comes from the label wrapping it, as on
      // every listed type.
      expect(stale instanceof HTMLInputElement ? stale.labels?.[0] : undefined).toHaveClass('mobile-touch-target');
      // Unticking keeps the box (and focus) so a mis-tick can be undone.
      await user.click(stale);
      expect(stale).toBeInTheDocument();
      expect(stale).not.toBeChecked();
      await user.click(stale);
      expect(stale).toBeChecked();
      await user.click(stale);
      await user.click(screen.getByLabelText('Active Member'));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() =>
        expect(eventService.updateEvent).toHaveBeenCalledWith(
          'evt-1',
          expect.objectContaining({ mandatory_membership_types: ['active'] })
        )
      );
    });

    it("does not call a saved member type obsolete when the department's list could not be loaded", async () => {
      // The form's built-in fallback list lacks real tiers such as "senior".
      vi.mocked(eventService.getVisibleEventTypesWithCategories).mockRejectedValue(new Error('offline'));
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        is_mandatory: true,
        mandatory_membership_types: ['senior'],
      });

      renderWithRouter(<EventEditPage />);

      expect(await screen.findByLabelText('senior')).toBeChecked();
      expect(screen.queryByText(/not a current member type/i)).not.toBeInTheDocument();
    });

    it("shows the event's category", async () => {
      vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue(
        visibleTypesWith([
          { value: 'drills', label: 'Drills', color: '#991b1b' },
          { value: 'outreach', label: 'Outreach', color: '#1e40af' },
        ])
      );
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, custom_category: 'outreach' });

      renderWithRouter(<EventEditPage />);

      expect(await screen.findByLabelText(/^category$/i)).toHaveValue('outreach');
      // A listed category is offered once, not again as an unlisted value.
      expect(screen.getAllByRole('option', { name: /outreach/i })).toHaveLength(1);
    });

    // It showed the stored value alone, as if it were still on the list.
    it('names a stored category the department no longer lists, and says so', async () => {
      vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue(
        visibleTypesWith([{ value: 'drills', label: 'Drills', color: '#991b1b' }])
      );
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, custom_category: 'Night Drill' });

      renderWithRouter(<EventEditPage />);

      expect(
        await screen.findByRole('option', { name: 'Night Drill (no longer an event category)' })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^category$/i)).toHaveValue('Night Drill');
      expect(
        screen.getByText('No longer an event category. It stays on this event until someone picks another.')
      ).toBeInTheDocument();
    });
  });

  describe('Cancel Action', () => {
    it('should navigate back to event detail on cancel', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event');
      });

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/events/evt-1');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible error alerts', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(makeApiError('Event not found', 404));

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('should have a trail back to the events list', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      window.history.replaceState({}, '', '/events/evt-1/edit');

      renderWithRouter(<EventEditPage />);

      await screen.findByRole('link', { name: 'Existing Event' });
      const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
      expect(within(trail).getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events');
    });
  });
  // training.manage reaches the page for any event; the server says whether
  // this one is theirs, and the type stays Training.
  describe('A training manager', () => {
    beforeEach(() => {
      mockPermissions.clear();
      mockPermissions.add('training.manage');
      vi.mocked(eventService.getEvent).mockReset();
    });

    it('edits a Training event with the type locked, in the training form', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        event_type: 'training',
        can_edit_event: true,
      });

      renderWithRouter(<EventEditPage />);

      const type = await screen.findByLabelText(/event type/i);
      expect(type).toBeDisabled();
      expect(screen.getByText(/only an event manager can change a training event/i)).toBeInTheDocument();
      // The training form saves from its Review step.
      expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    });

    it('is turned away from an event that is not theirs to edit', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, can_edit_event: false });

      renderWithRouter(<EventEditPage />);

      expect(await screen.findByText(/only an event manager can edit this event/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    });
  });

  // A Training event is edited in the training form (owner decision,
  // 2026-11-10): the event's own fields as the single-page form edits them,
  // and its session's on Training Info, saved together through PATCH
  // /events/{id} or /update-future with EventUpdate.training_details.
  describe('A Training event', () => {
    const trainingEvent: Event = {
      ...mockEvent,
      title: 'Hose Testing Night',
      event_type: 'training',
      requires_rsvp: false,
      start_datetime: '2026-03-15T18:00:00Z',
      end_datetime: '2026-03-15T20:00:00Z',
      check_in_window_type: 'flexible',
      check_in_minutes_before: 60,
      check_in_minutes_after: 15,
      require_checkout: false,
      can_edit_event: true,
    };

    // Filed under the title with no course; the hours equal the length.
    const session: TrainingSessionResponse = {
      id: 'sess-1',
      organization_id: 'org-1',
      event_id: 'evt-1',
      course_name: 'Hose Testing Night',
      training_type: 'skills_practice',
      credit_hours: 2,
      instructor: 'Owen Kittredge',
      issues_certification: false,
      counts_toward_certification: true,
      auto_create_records: true,
      require_completion_confirmation: false,
      approval_deadline_days: 7,
      attendance_requirement_ids: [],
      is_finalized: false,
      created_at: '',
      updated_at: '',
    };

    const attendanceRequirement = {
      id: 'req-att',
      organization_id: 'org-1',
      name: 'Company Drill Attendance',
      requirement_type: 'session_attendance',
      required_attendance_pct: 60,
      source: 'department',
      frequency: 'annual',
      applies_to_all: true,
      due_date_type: 'calendar_period',
      active: true,
      created_at: '',
      updated_at: '',
    };

    const officerAttendance = {
      ...attendanceRequirement,
      id: 'req-att-2',
      name: 'Officer Meeting Attendance',
      required_attendance_pct: 75,
    };

    /**
     * Every training field the form owns, as an edit sends it: blanks as null
     * (pitfall #1). The hours equal the length, so they follow it and travel as
     * null — each event's own length, the backend's reading of null — and the
     * approval deadline is left out while sign-off is off.
     */
    // Requirement is absent: an unchanged one is left out, so a series edit
    // leaves each later occurrence's own (toUpdatePayload).
    const unchangedDetails = {
      course_id: null,
      course_name: null,
      course_code: null,
      category_id: null,
      program_id: null,
      phase_id: null,
      training_type: 'skills_practice',
      credit_hours: null,
      instructor: 'Owen Kittredge',
      instructor_id: null,
      issues_certification: false,
      certification_number_prefix: null,
      issuing_agency: null,
      expiration_months: null,
      counts_toward_certification: true,
      auto_create_records: true,
      require_completion_confirmation: false,
      attendance_requirement_ids: [],
    };

    type User = ReturnType<typeof userEvent.setup>;
    const next = (user: User) => user.click(screen.getByRole('button', { name: 'Next' }));
    /** Next until the Review step's Save Changes. */
    async function toReview(user: User) {
      while (!screen.queryByRole('button', { name: 'Save Changes' })) {
        await next(user);
      }
    }
    const sent = () => vi.mocked(eventService.updateEvent).mock.calls[0]?.[1];

    beforeEach(() => {
      vi.mocked(eventService.getEvent).mockReset();
      vi.mocked(eventService.getEvent).mockResolvedValue(trainingEvent);
      vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue(session);
      vi.mocked(eventService.updateEvent).mockReset();
      vi.mocked(eventService.updateEvent).mockResolvedValue(trainingEvent);
      vi.mocked(eventService.updateFutureEvents).mockReset();
      vi.mocked(eventService.updateFutureEvents).mockResolvedValue({ updated_count: 4 });
      linkageRequirements.value = [attendanceRequirement];
    });

    it('opens the training form, and the single-page form for any other type', async () => {
      const { unmount } = renderWithRouter(<EventEditPage />);

      expect(await screen.findByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
      expect(screen.getByLabelText(/^title/i)).toHaveValue('Hose Testing Night');
      expect(trainingSessionService.getSessionByEvent).toHaveBeenCalledWith('evt-1');
      unmount();

      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(trainingSessionService.getSessionByEvent).mockClear();
      renderWithRouter(<EventEditPage />);

      expect(await screen.findByRole('button', { name: /save changes/i })).toBeInTheDocument();
      expect(screen.queryByText(/Step 1 of 4/)).not.toBeInTheDocument();
      expect(trainingSessionService.getSessionByEvent).not.toHaveBeenCalled();
    });

    it("opens on Training Info with ?step=training, showing the session's details", async () => {
      window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
      renderWithRouter(<EventEditPage />);

      expect(await screen.findByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /No course yet/ })).toBeChecked();
      expect(screen.getByLabelText(/Training Type/)).toHaveValue('skills_practice');
      expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(2);
      // A stored name that is no member's is kept as text, not passed off as one.
      expect(screen.getByText('Owen Kittredge, not a member')).toBeInTheDocument();
    });

    it('sends every training field with the event fields, blanks as null', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await screen.findByText('Step 1 of 4 · Event Details');
      await next(user);
      await user.selectOptions(screen.getByLabelText(/Training Type/), 'refresher');
      await user.click(screen.getByLabelText(/Company Drill Attendance/));
      await toReview(user);
      expect(screen.getByRole('heading', { name: 'Review changes' })).toBeInTheDocument();
      // What changed says what it was.
      expect(screen.getByText('was Skills Practice')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(sent()).toEqual(
        expect.objectContaining({
          title: 'Hose Testing Night',
          event_type: 'training',
          description: 'An event that already exists.',
          training_details: {
            ...unchangedDetails,
            training_type: 'refresher',
            attendance_requirement_ids: ['req-att'],
          },
        })
      );
      expect(eventService.updateFutureEvents).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/events/evt-1');
    });

    it('clears an emptied training field rather than leaving it in place', async () => {
      vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue({
        ...session,
        issues_certification: true,
        issuing_agency: 'State Fire Training',
      });
      window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.clear(await screen.findByLabelText(/Issuing Agency/));
      await toReview(user);
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(sent()?.training_details).toEqual({
        ...unchangedDetails,
        issues_certification: true,
        issuing_agency: null,
      });
    });

    it('offers the series scope on Review, covering the training details', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...trainingEvent,
        recurrence_parent_id: 'series-1',
        recurrence_pattern: 'weekly',
        recurrence_end_date: '2026-06-15T23:59:00Z',
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await screen.findByText('Step 1 of 4 · Event Details');
      // Not above the form as the single-page form has it: on Review, with the save.
      expect(screen.queryByLabelText(/this and all future events/i)).not.toBeInTheDocument();
      await toReview(user);
      expect(screen.getByLabelText(/this event only/i)).toBeChecked();
      expect(screen.getByText(/Either choice covers the event fields/)).toBeInTheDocument();
      await user.click(screen.getByLabelText(/this and all future events/i));
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(eventService.updateFutureEvents).toHaveBeenCalledTimes(1));
      expect(eventService.updateFutureEvents).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({ title: 'Hose Testing Night', training_details: unchangedDetails })
      );
      expect(eventService.updateEvent).not.toHaveBeenCalled();
    });

    // The series end and the rolling flag are stored on the series' first
    // event only (SERIES_PARENT_FIELDS); a later occurrence carries neither.
    describe('on a later occurrence of a series', () => {
      const child: Event = {
        ...trainingEvent,
        recurrence_parent_id: 'series-1',
        recurrence_pattern: 'weekly',
        rolling_recurrence: false,
      };
      const parent: Event = {
        ...trainingEvent,
        id: 'series-1',
        is_recurring: true,
        recurrence_pattern: 'weekly',
        start_datetime: '2026-01-04T18:00:00Z',
        end_datetime: '2026-01-04T20:00:00Z',
      };

      it("names the series' end, read from its first event", async () => {
        vi.mocked(eventService.getEvent).mockImplementation((id: string) =>
          Promise.resolve(id === 'series-1' ? { ...parent, recurrence_end_date: '2026-06-15T23:59:00Z' } : child)
        );
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await toReview(user);
        expect(screen.getByText('This and all future events (through Mon, Jun 15, 2026)')).toBeInTheDocument();
        expect(screen.getByText('Sun, Mar 15, 2026, in a series running since Sun, Jan 4, 2026.')).toBeInTheDocument();
        expect(screen.getByText('Sun, Mar 15, 2026', { selector: 'span' })).toBeInTheDocument();
      });

      // Review named the series' start but never that an earlier occurrence
      // is finalized, which is what says "This and all future events" leaves
      // that one alone.
      it('names the nearest earlier occurrence with finalized attendance', async () => {
        vi.mocked(eventService.getEvent).mockImplementation((id: string) =>
          Promise.resolve(id === 'series-1' ? parent : child)
        );
        const listed = (id: string, start: string, finalized: string | null, parentId = 'series-1') => ({
          ...trainingEvent,
          id,
          start_datetime: start,
          recurrence_parent_id: parentId,
          attendance_finalized_at: finalized,
        });
        vi.mocked(eventService.getEvents).mockImplementation((params) =>
          Promise.resolve(
            params?.start_before
              ? ([
                  { ...parent, attendance_finalized_at: '2026-01-04T21:00:00Z' },
                  listed('occ-feb', '2026-02-01T18:00:00Z', '2026-02-01T21:00:00Z'),
                  listed('occ-mar', '2026-03-08T18:00:00Z', null),
                  listed('other', '2026-03-10T18:00:00Z', '2026-03-10T21:00:00Z', 'other-series'),
                  listed('evt-1', '2026-03-15T18:00:00Z', null),
                ] as never)
              : []
          )
        );
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await toReview(user);
        expect(
          screen.getByText(
            'Sun, Mar 15, 2026, in a series running since Sun, Jan 4, 2026. Sun, Feb 1, 2026, before it, has finalized attendance.'
          )
        ).toBeInTheDocument();
        // The series alone, asked of the server: an org-wide page capped at
        // 500 could cut off the very occurrence named here.
        expect(eventService.getEvents).toHaveBeenCalledWith(
          expect.objectContaining({
            recurrence_series_id: 'series-1',
            start_after: '2026-01-04T18:00:00Z',
            start_before: '2026-03-15T18:00:00Z',
          })
        );
      });

      // A full page may stop short of the nearest finalized occurrence, so
      // the date it would name could be the wrong one: say nothing instead.
      it('names no finalized occurrence when the list came back full', async () => {
        vi.mocked(eventService.getEvent).mockImplementation((id: string) =>
          Promise.resolve(id === 'series-1' ? parent : child)
        );
        const page = Array.from({ length: 500 }, (_, index) => ({
          ...trainingEvent,
          id: `occ-${index}`,
          start_datetime: '2026-02-01T18:00:00Z',
          recurrence_parent_id: 'series-1',
          attendance_finalized_at: '2026-02-01T21:00:00Z',
        }));
        vi.mocked(eventService.getEvents).mockImplementation((params) =>
          Promise.resolve(params?.start_before ? (page as never) : [])
        );
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await toReview(user);
        expect(screen.getByText('Sun, Mar 15, 2026, in a series running since Sun, Jan 4, 2026.')).toBeInTheDocument();
        expect(screen.queryByText(/has finalized attendance/)).not.toBeInTheDocument();
      });

      it('says that occurrences a rolling series adds later copy the changes', async () => {
        vi.mocked(eventService.getEvent).mockImplementation((id: string) =>
          Promise.resolve(
            id === 'series-1'
              ? { ...parent, rolling_recurrence: true, recurrence_end_date: '2027-01-04T23:59:00Z' }
              : child
          )
        );
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await toReview(user);
        expect(screen.getByText(/occurrences added later copy these changes too/)).toBeInTheDocument();
        expect(screen.getByText('This and all future events')).toBeInTheDocument();
      });
    });

    describe('with a library course and a legacy requirement link', () => {
      const PUMP = {
        id: 'course-pump',
        organization_id: 'org-1',
        name: 'Pump Operations',
        code: 'PUMP',
        training_type: 'skills_practice',
        credit_hours: 2,
        is_active: true,
      };
      beforeEach(() => {
        vi.mocked(trainingService.getCourses).mockResolvedValue([PUMP] as never);
        vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue({
          ...session,
          course_id: 'course-pump',
          course_name: 'Pump Operations',
          requirement_id: 'req-att',
        });
      });

      it('reads stored hours equal to the course as from the course', async () => {
        window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        const hours = await screen.findByLabelText(/Credit Hours/);
        // Once the Course Library has loaded.
        await waitFor(() =>
          expect(hours).toHaveAccessibleDescription(expect.stringContaining('From the course (2 hours).'))
        );
        await toReview(user);
        expect(screen.getByText('2 hours (from the course)')).toBeInTheDocument();
      });

      /**
       * A three-hour event whose session holds the pump course with the given
       * stored hours, opened on Training Info once the Course Library has
       * loaded, so the form can tell whether the hours are the course's.
       */
      async function openWithStoredHours(storedHours: number) {
        vi.mocked(eventService.getEvent).mockResolvedValue({ ...trainingEvent, end_datetime: '2026-03-15T21:00:00Z' });
        vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue({
          ...session,
          course_id: 'course-pump',
          course_name: 'Pump Operations',
          credit_hours: storedHours,
        });
        window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);
        await screen.findByRole('option', { name: 'PUMP - Pump Operations' });
        return user;
      }

      async function save(user: User) {
        await toReview(user);
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      }

      // Stored hours equal to the course's are its figure, not the officer's.
      // Leaving the library kept them as typed, so the course-less session was
      // saved with the old course's 2 hours on a three-hour event, where a
      // create goes back to the length. Null is each event's own length to
      // the backend.
      it("follows the event's length again when the course is left", async () => {
        const user = await openWithStoredHours(2);
        expect(screen.getByLabelText(/Credit Hours/)).toHaveAccessibleDescription(
          expect.stringContaining('From the course (2 hours).')
        );

        await user.click(screen.getByRole('radio', { name: /No course yet/ }));
        expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(3);
        await save(user);

        expect(sent()?.training_details).toMatchObject({ course_id: null, credit_hours: null });
      });

      it('keeps hours unlike the course when the course is left', async () => {
        const user = await openWithStoredHours(5);

        await user.click(screen.getByRole('radio', { name: /One-off course/ }));
        await user.type(screen.getByLabelText(/Course Name/), 'Pump Refresher');
        expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(5);
        await save(user);

        expect(sent()?.training_details).toMatchObject({
          course_id: null,
          course_name: 'Pump Refresher',
          credit_hours: 5,
        });
      });

      it('says why the session-attendance requirement link is kept, on the step and on Review', async () => {
        window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        expect(await screen.findByLabelText('Requirement')).toHaveAccessibleDescription(
          expect.stringContaining('Company Drill Attendance is a session-attendance requirement.')
        );
        await toReview(user);
        expect(screen.getByText('Company Drill Attendance (currently linked, no longer offered)')).toBeInTheDocument();
      });

      // A later occurrence may store another Requirement, or none, and the
      // legacy link may not be given to it: re-sent untouched, it refused
      // "This and all future events" for an edit of the description.
      describe('on "This and all future events"', () => {
        beforeEach(() => {
          vi.mocked(eventService.getEvent).mockResolvedValue({
            ...trainingEvent,
            recurrence_parent_id: 'series-1',
            recurrence_pattern: 'weekly',
          });
        });

        async function saveFuture(user: User) {
          await toReview(user);
          await user.click(screen.getByLabelText(/this and all future events/i));
          await user.click(screen.getByRole('button', { name: 'Save Changes' }));
          await waitFor(() => expect(eventService.updateFutureEvents).toHaveBeenCalledTimes(1));
          return vi.mocked(eventService.updateFutureEvents).mock.calls[0]?.[1];
        }

        it('leaves the untouched Requirement out, and says each occurrence keeps its own', async () => {
          const user = userEvent.setup();
          renderWithRouter(<EventEditPage />);
          const description = await screen.findByLabelText(/Description/);
          await user.type(description, ' Bring gloves.');
          await toReview(user);
          expect(screen.getByText(/each later occurrence keeps its own/)).toBeInTheDocument();

          const payload = await saveFuture(user);
          expect(payload?.training_details).toBeDefined();
          expect(payload?.training_details).not.toHaveProperty('requirement_id');
        });

        it('still sends a cleared Requirement, as null', async () => {
          window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
          const user = userEvent.setup();
          renderWithRouter(<EventEditPage />);
          await user.selectOptions(await screen.findByLabelText('Requirement'), '');

          const payload = await saveFuture(user);
          expect(payload?.training_details).toMatchObject({ requirement_id: null });
        });
      });

      it("does not tell a reader they can change the course's type", async () => {
        mockPermissions.clear();
        mockPermissions.add('training.manage');
        window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
        renderWithRouter(<EventEditPage />);

        const type = await screen.findByLabelText(/Training Type/);
        await waitFor(() => expect(type).toHaveAccessibleDescription('From the course.'));
      });
    });

    it('says on Review that attachments are managed on the event page', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...trainingEvent,
        attachments: [
          { id: 'att-1', file_name: 'Pump chart.pdf', file_size: 2048, file_type: 'application/pdf' } as never,
        ],
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await screen.findByText('Step 1 of 4 · Event Details');
      await toReview(user);
      expect(screen.getByText('Attachments are managed on the event page.')).toBeInTheDocument();
    });

    it("names a single event's date in the subtitle", async () => {
      renderWithRouter(<EventEditPage />);

      expect(
        await screen.findByText('Update the details for “Hose Testing Night”, Sun, Mar 15, 2026.')
      ).toBeInTheDocument();
    });

    it('puts a refused training field under its field, back on Training Info', async () => {
      vi.mocked(eventService.updateEvent).mockRejectedValue({
        response: {
          status: 422,
          data: { detail: [{ field: 'training_details.credit_hours', message: 'Input should be a finite number' }] },
        },
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await screen.findByText('Step 1 of 4 · Event Details');
      await toReview(user);
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      expect(await screen.findByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
      const hours = screen.getByLabelText(/Credit Hours/);
      await waitFor(() => expect(hours).toHaveFocus());
      expect(hours).toHaveAccessibleDescription(expect.stringContaining('Input should be a finite number'));
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('says a failed save failed, on Review', async () => {
      vi.mocked(eventService.updateEvent).mockRejectedValue(new Error('Network Error'));
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await screen.findByText('Step 1 of 4 · Event Details');
      await toReview(user);
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      expect(await screen.findByText('Failed to update event. Try again.')).toBeInTheDocument();
      expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument();
    });

    describe('Mandatory for, pre-filled from Counts toward attendance', () => {
      // Stored mandatory for active members only, linked to an every-member requirement.
      beforeEach(() => {
        vi.mocked(eventService.getEvent).mockResolvedValue({
          ...trainingEvent,
          is_mandatory: true,
          mandatory_membership_types: ['active'],
        });
        vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue({
          ...session,
          attendance_requirement_ids: ['req-att'],
        });
        vi.mocked(trainingSessionService.getMandatoryTiers).mockResolvedValue({
          everyone: true,
          tier_ids: [],
          unmapped: [],
        });
      });

      it('keeps the stored choice when the event loads', async () => {
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await next(user);
        expect(screen.getByLabelText(/Company Drill Attendance/)).toBeChecked();
        await next(user);

        expect(screen.getByRole('radio', { name: 'Only these member types' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Active' })).toBeChecked();
        expect(screen.queryByText('Pre-filled from Counts toward attendance')).not.toBeInTheDocument();
        expect(trainingSessionService.getMandatoryTiers).not.toHaveBeenCalled();
      });

      it('fills it again once Counts toward attendance changes', async () => {
        linkageRequirements.value = [attendanceRequirement, officerAttendance];
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await next(user);
        await user.click(screen.getByLabelText(/Officer Meeting Attendance/));
        await waitFor(() =>
          expect(trainingSessionService.getMandatoryTiers).toHaveBeenCalledWith(['req-att', 'req-att-2'])
        );
        await next(user);

        await waitFor(() => expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked());
        expect(
          screen.getByText('Company Drill Attendance, Officer Meeting Attendance → All members.')
        ).toBeInTheDocument();
      });

      // A tick filled Mandatory for; unticking it again left the fill in
      // place, so the save changed Mandatory for though Counts toward
      // attendance ended where it started.
      it('puts the stored choice back when the ticks return after a fill', async () => {
        linkageRequirements.value = [attendanceRequirement, officerAttendance];
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await next(user);
        await user.click(screen.getByLabelText(/Officer Meeting Attendance/));
        await waitFor(() => expect(trainingSessionService.getMandatoryTiers).toHaveBeenCalledTimes(1));
        await next(user);
        await waitFor(() => expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked());
        await user.click(screen.getByRole('button', { name: 'Previous' }));
        await user.click(screen.getByLabelText(/Officer Meeting Attendance/));
        await next(user);

        expect(screen.getByRole('radio', { name: 'Only these member types' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Active' })).toBeChecked();
        await toReview(user);
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
        expect(sent()).toEqual(expect.objectContaining({ is_mandatory: true, mandatory_membership_types: ['active'] }));
      });

      // Unticked and ticked again, Counts toward attendance is what was
      // stored, so nothing changed and the stored Mandatory for stands.
      it('leaves the stored choice alone when the ticks end where they started', async () => {
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await next(user);
        await user.click(screen.getByLabelText(/Company Drill Attendance/));
        await user.click(screen.getByLabelText(/Company Drill Attendance/));
        await next(user);

        expect(screen.getByRole('radio', { name: 'Only these member types' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Active' })).toBeChecked();
        expect(screen.queryByText('Pre-filled from Counts toward attendance')).not.toBeInTheDocument();
        expect(trainingSessionService.getMandatoryTiers).not.toHaveBeenCalled();
      });
    });

    describe('once attendance is finalized', () => {
      beforeEach(() => {
        vi.mocked(eventService.getEvent).mockResolvedValue({
          ...trainingEvent,
          attendance_finalized_at: '2026-03-15T21:00:00Z',
        });
      });

      it('says under the type and the category that they are locked', async () => {
        vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue(
          visibleTypesWith([{ value: 'drill', label: 'Company Drill', color: '#991b1b' }])
        );
        renderWithRouter(<EventEditPage />);

        await screen.findByRole('combobox', { name: 'Event Category' });
        // The type, the category and the schedule.
        expect(screen.getAllByText('Locked while attendance is finalized.')).toHaveLength(3);
      });

      it('locks every training field but Counts toward attendance', async () => {
        window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
        renderWithRouter(<EventEditPage />);

        expect(await screen.findByText('Locked except Counts toward attendance')).toBeInTheDocument();
        expect(screen.getByText(/check-in rules and training details are locked/)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /No course yet/ })).toBeDisabled();
        expect(screen.getByLabelText(/Training Type/)).toBeDisabled();
        expect(screen.getByLabelText(/Credit Hours/)).toBeDisabled();
        expect(screen.getByLabelText(/This training issues a certification/)).toBeDisabled();
        expect(screen.getByLabelText(/Require sign-off/)).toBeDisabled();
        expect(screen.getByLabelText(/Company Drill Attendance/)).toBeEnabled();
      });

      it('sends only the attendance links, and none of the locked event fields', async () => {
        window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await user.click(await screen.findByLabelText(/Company Drill Attendance/));
        await toReview(user);
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
        const payload = sent();
        expect(payload?.training_details).toEqual({ attendance_requirement_ids: ['req-att'] });
        for (const field of ATTENDANCE_LOCKED_EVENT_FIELDS) {
          expect(payload).not.toHaveProperty(field);
        }
      });

      it('saves a class stored mandatory for every member as All members', async () => {
        // How every course-cohort class is stored; see the single-page case above.
        vi.mocked(eventService.getEvent).mockResolvedValue({
          ...trainingEvent,
          is_mandatory: true,
          attendance_finalized_at: '2026-03-15T21:00:00Z',
        });
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        await screen.findByText('Step 1 of 4 · Event Details');
        await next(user);
        await next(user);
        expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked();
        await next(user);
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
        expect(sent()).toEqual(
          expect.objectContaining({
            is_mandatory: true,
            mandatory_membership_types: [],
            training_details: { attendance_requirement_ids: [] },
          })
        );
      });

      it('offers no training details on a finalized event that has none', async () => {
        vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue(null);
        window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
        const user = userEvent.setup();
        renderWithRouter(<EventEditPage />);

        expect(
          await screen.findByText(
            'No training details: attendance is filed under ‘Hose Testing Night’ as Continuing Education.'
          )
        ).toBeInTheDocument();
        expect(screen.getByLabelText(/Company Drill Attendance/)).toBeDisabled();
        await toReview(user);
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
        expect(sent()).not.toHaveProperty('training_details');
      });
    });

    it('shows a training manager the details read-only and sends none, since the API refuses them', async () => {
      mockPermissions.clear();
      mockPermissions.add('training.manage');
      window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      expect(await screen.findByText('Training details are changed by an event manager.')).toBeInTheDocument();
      expect(screen.getByText('Read-only')).toBeInTheDocument();
      expect(screen.getByLabelText(/Training Type/)).toBeDisabled();
      expect(screen.getByLabelText(/Company Drill Attendance/)).toBeDisabled();
      await toReview(user);
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(sent()).toEqual(expect.objectContaining({ title: 'Hose Testing Night' }));
      expect(sent()).not.toHaveProperty('training_details');
    });

    // A read-only step offered one-tap requirement chips nobody could tap, and
    // dropped the hint's "The event's length" though the hours were just that.
    it('shows a training manager no requirement suggestions, and says the hours are the length', async () => {
      mockPermissions.clear();
      mockPermissions.add('training.manage');
      linkageRequirements.value = [
        attendanceRequirement,
        {
          ...attendanceRequirement,
          id: 'req-hose',
          name: 'Annual Hose Hours',
          requirement_type: 'hours',
          category_ids: ['cat-hose'],
        },
      ];
      vi.mocked(trainingSessionService.getSessionByEvent).mockResolvedValue({ ...session, category_id: 'cat-hose' });
      window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
      renderWithRouter(<EventEditPage />);

      expect(await screen.findByText('Training details are changed by an event manager.')).toBeInTheDocument();
      expect(screen.getByLabelText(/Credit Hours/)).toHaveAccessibleDescription(
        /^The event's length \(2 hours\)\. Each attendee is credited/
      );
      expect(screen.queryByText('Requirements in this category:')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Annual Hose Hours/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Tap a requirement to link it to this session.')).not.toBeInTheDocument();
    });

    // The save leaves the session's hours alone, so a locked step must show
    // them as stored, not as the event's new length.
    it("shows a training manager the stored credit hours after the event's times move", async () => {
      mockPermissions.clear();
      mockPermissions.add('training.manage');
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await screen.findByText('Step 1 of 4 · Event Details');
      await user.click(screen.getByRole('button', { name: '4 hours' }));
      await next(user);
      expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(2);
      await toReview(user);

      expect(screen.getByText('2 hours')).toBeInTheDocument();
      expect(screen.queryByText(/4 hours/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(sent()).not.toHaveProperty('training_details');
    });

    it('leaves the training details alone when the session could not be loaded', async () => {
      vi.mocked(trainingSessionService.getSessionByEvent).mockRejectedValue(new Error('Network Error'));
      window.history.replaceState({}, '', '/events/evt-1/edit?step=training');
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      expect(await screen.findByText('The training details could not be loaded.')).toBeInTheDocument();
      await toReview(user);
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(sent()).not.toHaveProperty('training_details');
    });

    it('swaps to the single-page form when the type changes, and saves no training details', async () => {
      vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue({
        ...visibleTypesWith(),
        visible_event_types: ['business_meeting', 'training'],
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.selectOptions(await screen.findByLabelText(/event type/i), 'business_meeting');

      expect(screen.getByText(/Saving takes the event out of training/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      expect(sent()).toEqual(expect.objectContaining({ event_type: 'business_meeting' }));
      expect(sent()).not.toHaveProperty('training_details');
    });
  });
});
