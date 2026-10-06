import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import EventEditPage from './EventEditPage';
import * as apiModule from '../services/api';
import type { Event, EventCategoryConfig } from '../types/event';
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
  };
}

describe('EventEditPage', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventService.getVisibleEventTypesWithCategories).mockReset();
    vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue(visibleTypesWith());
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

    it('should display back link and event title in description', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      const backLink = await screen.findByRole('link', { name: /back to event/i });
      expect(backLink).toHaveAttribute('href', '/events/evt-1');
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

  describe('Finalized attendance', () => {
    const finalizedEvent: Event = {
      ...mockEvent,
      event_type: 'training',
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
          event_type: 'training',
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
      // finalized class included, until somebody narrowed it.
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        event_type: 'training',
        is_mandatory: true,
        attendance_finalized_at: '2026-03-15T21:00:00Z',
      });
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      expect(await screen.findByText(/mandatory for every member/i)).toBeInTheDocument();
      const title = screen.getByLabelText(/^title/i);
      await user.clear(title);
      await user.type(title, 'Recruit school, class 3 (corrected)');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(eventService.updateEvent).toHaveBeenCalledTimes(1));
      const [, payload] = vi.mocked(eventService.updateEvent).mock.calls[0] ?? [];
      expect(payload).toEqual(
        expect.objectContaining({ title: 'Recruit school, class 3 (corrected)', is_mandatory: true })
      );
      expect(payload?.mandatory_membership_types).toBeUndefined();
      expect(screen.queryByText(/select at least one member type/i)).not.toBeInTheDocument();
    });

    // Only an event stored with no member types means everyone. Narrowing one
    // down to nothing, or making an event mandatory now, still needs a choice:
    // the server would read an empty list as every member.
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

      expect(await screen.findByText(/select at least one member type/i)).toBeInTheDocument();
      expect(eventService.updateEvent).not.toHaveBeenCalled();
    });

    it('still asks for a member type when an event is newly made mandatory', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      const user = userEvent.setup();
      renderWithRouter(<EventEditPage />);

      await user.click(await screen.findByLabelText(/mandatory attendance/i));
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      expect(await screen.findByText(/select at least one member type/i)).toBeInTheDocument();
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

      const stale = await screen.findByLabelText(/administrative \(not a current member type\)/i);
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

    it('should have proper back navigation link', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      const backLink = await screen.findByRole('link', { name: /back to event/i });
      expect(backLink).toHaveAttribute('href', '/events/evt-1');
    });
  });
});
