import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { EventForm } from './EventForm';
import * as apiModule from '../services/api';
import type { Location } from '../services/api';

// Mock the useTimezone hook
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getVisibleEventTypes: vi
      .fn()
      .mockResolvedValue([
        'business_meeting',
        'public_education',
        'training',
        'social',
        'fundraiser',
        'ceremony',
        'other',
      ]),
    getVisibleEventTypesWithCategories: vi.fn().mockResolvedValue({
      visible_event_types: [
        'business_meeting',
        'public_education',
        'training',
        'social',
        'fundraiser',
        'ceremony',
        'other',
      ],
      custom_event_categories: [],
      visible_custom_categories: [],
      membership_types: [
        { value: 'cadet', label: 'Cadet' },
        { value: 'active', label: 'Active Member' },
      ],
    }),
  },
  locationsService: {
    getLocations: vi.fn(),
  },
  // Behind the organizer pickers, which only the create page turns on.
  userService: {
    getUsers: vi.fn(),
  },
  // Behind the Training details section (TrainingDetailsFields).
  trainingService: {
    getCourses: vi.fn(),
    getCategories: vi.fn(),
    getRequirements: vi.fn(),
  },
  trainingProgramService: {
    getPrograms: vi.fn(),
    getProgramPhases: vi.fn(),
  },
}));

// Only the Training details section asks: whether to link Create Training
// Session, which only a training.manage holder can open.
const mockCheckPermission = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission: string) => mockCheckPermission(permission) as boolean }),
}));

const mockLocations = [
  { id: 'loc-1', name: 'Station 1 Conference Room', is_active: true },
  { id: 'loc-2', name: 'Training Center', is_active: true },
];

describe('EventForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiModule.locationsService.getLocations).mockResolvedValue(mockLocations as unknown as Location[]);
  });

  describe('Rendering', () => {
    it('should render all form sections', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await waitFor(() => {
        expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
      });

      const headings = screen.getAllByRole('heading', { level: 2 });
      const headingTexts = headings.map((h) => h.textContent);
      expect(headingTexts).toContain('Event Details');
      expect(headingTexts).toContain('Notifications');
      expect(headingTexts).toContain('Check-In Settings');
      expect(headingTexts).toContain('RSVP Settings');
      expect(headingTexts).toContain('Attendance');
      expect(headingTexts).toContain('Location');
      expect(headingTexts).toContain('Schedule');
    });

    it('should render submit and cancel buttons', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} submitLabel="Create Event" />);

      expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('should use custom submit label', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} submitLabel="Save Changes" />);

      expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    });

    it('should show Saving... when isSubmitting is true', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} isSubmitting={true} />);

      expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeDisabled();
    });
  });

  describe('Accessible names (workflow review W18)', () => {
    // The start and end pickers both announced "Time hour", and the series
    // end date, the date to skip and the reminder picker had no name at all.
    it('names every schedule control a screen reader reaches', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} showRecurrence />);

      expect(screen.getByLabelText('Start time hour')).toBeInTheDocument();
      expect(screen.getByLabelText('End time hour')).toBeInTheDocument();
      expect(screen.getByLabelText('Add a reminder')).toBeInTheDocument();

      await user.click(screen.getByLabelText('Make this a recurring event'));
      expect(screen.getByLabelText('Series end date')).toBeInTheDocument();
      await user.type(screen.getByLabelText('Date to skip'), '2026-10-12');
      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByRole('button', { name: 'Remove 2026-10-12' })).toBeInTheDocument();
    });
  });

  describe('Event Details Section', () => {
    it('should render title input', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const titleInput = screen.getByLabelText(/title/i);
      expect(titleInput).toBeInTheDocument();
      expect(titleInput).toBeRequired();
    });

    it('should render description textarea', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });

    it('should render event type dropdown with all options', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const typeSelect = screen.getByLabelText(/event type/i);
      expect(typeSelect).toBeInTheDocument();
    });
  });

  describe('Training details', () => {
    // Pitfall #28: this block states every mock the section depends on.
    beforeEach(() => {
      const { trainingService, trainingProgramService } = apiModule;
      vi.mocked(trainingService.getCourses).mockReset();
      vi.mocked(trainingService.getCourses).mockResolvedValue([]);
      vi.mocked(trainingService.getCategories).mockReset();
      vi.mocked(trainingService.getCategories).mockResolvedValue([]);
      vi.mocked(trainingService.getRequirements).mockReset();
      vi.mocked(trainingService.getRequirements).mockResolvedValue([]);
      vi.mocked(trainingProgramService.getPrograms).mockReset();
      vi.mocked(trainingProgramService.getPrograms).mockResolvedValue([]);
      vi.mocked(trainingProgramService.getProgramPhases).mockReset();
      vi.mocked(trainingProgramService.getProgramPhases).mockResolvedValue([]);
      mockOnSubmit.mockReset();
      mockOnSubmit.mockResolvedValue(undefined);
      mockCheckPermission.mockReset();
      mockCheckPermission.mockImplementation((permission: string) => permission === 'training.manage');
    });

    const fillRequired = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText(/title/i), 'Hose drill');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-01' } });
    };

    it('offers an optional training details section on a new Training event', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.queryByText('Training details (optional)')).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');

      expect(screen.getByRole('heading', { name: 'Training details (optional)' })).toBeInTheDocument();
      expect(
        screen.getByText(/credited to members' training records when attendance is finalized/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/filed under the event title as Continuing Education/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Create Training Session' })).toHaveAttribute(
        'href',
        '/training/admin?page=records&tab=sessions'
      );
      expect(screen.getByLabelText('Training Type')).toHaveValue('');
      expect(screen.queryByText(/use "Create Training Session" instead/i)).not.toBeInTheDocument();
    });

    it('names Create Training Session without linking it for someone who cannot open it', async () => {
      mockCheckPermission.mockReturnValue(false);
      const user = userEvent.setup();
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');

      expect(screen.getByText(/a training officer uses Create Training Session instead/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Create Training Session' })).not.toBeInTheDocument();
    });

    it('sends no training_details when the section is left untouched', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
      const submitted = mockOnSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(submitted.event_type).toBe('training');
      expect(submitted).not.toHaveProperty('training_details');
    });

    it('sends the picked training type, omitting the blanks', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');
      await user.selectOptions(screen.getByLabelText('Training Type'), 'skills_practice');
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
      const submitted = mockOnSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(submitted.training_details).toStrictEqual({ training_type: 'skills_practice' });
    });

    it('drops the details if the event is retyped away from Training', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');
      await user.selectOptions(screen.getByLabelText('Training Type'), 'skills_practice');
      await user.selectOptions(screen.getByLabelText(/event type/i), 'social');
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1));
      expect(mockOnSubmit.mock.calls[0]?.[0]).not.toHaveProperty('training_details');
    });

    it('points to the event page when editing instead of offering the section', () => {
      renderWithRouter(
        <EventForm
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
          editingEventId="evt-1"
          submitLabel="Save Changes"
          initialData={{ title: 'Hose drill', event_type: 'training' }}
        />
      );

      expect(
        screen.getByText("Training details are edited on the event page's Requirements & Programs card.")
      ).toBeInTheDocument();
      expect(screen.queryByText('Training details (optional)')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Training Type')).not.toBeInTheDocument();
    });

    it('disables the section on a rolling series and sends nothing from it', async () => {
      const mockOnSubmitRecurring = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderWithRouter(
        <EventForm
          onSubmit={mockOnSubmit}
          onSubmitRecurring={mockOnSubmitRecurring}
          onCancel={mockOnCancel}
          showRecurrence
        />
      );

      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');
      await user.selectOptions(screen.getByLabelText('Training Type'), 'refresher');
      await user.click(screen.getByLabelText('Make this a recurring event'));
      await user.click(screen.getByLabelText('Rolling 12-month cycle'));

      expect(screen.getByText("Training details can't be added to a rolling series.")).toBeInTheDocument();
      expect(screen.getByLabelText('Training Type')).toBeDisabled();
      expect(screen.getByLabelText('Course')).toBeDisabled();

      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => expect(mockOnSubmitRecurring).toHaveBeenCalledTimes(1));
      const submitted = mockOnSubmitRecurring.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(submitted.rolling_recurrence).toBe(true);
      expect(submitted).not.toHaveProperty('training_details');
    });

    it('carries the details onto a fixed-length series', async () => {
      const mockOnSubmitRecurring = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderWithRouter(
        <EventForm
          onSubmit={mockOnSubmit}
          onSubmitRecurring={mockOnSubmitRecurring}
          onCancel={mockOnCancel}
          showRecurrence
        />
      );

      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');
      await user.selectOptions(screen.getByLabelText('Training Type'), 'refresher');
      await user.click(screen.getByLabelText('Make this a recurring event'));
      fireEvent.change(screen.getByLabelText('Series end date'), { target: { value: '2026-06-30' } });

      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => expect(mockOnSubmitRecurring).toHaveBeenCalledTimes(1));
      const submitted = mockOnSubmitRecurring.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(submitted.training_details).toStrictEqual({ training_type: 'refresher' });
    });
  });

  describe('Schedule Section', () => {
    it('should render start and end datetime inputs', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByLabelText(/start date & time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/end date & time/i)).toBeInTheDocument();
    });

    it('should render quick duration buttons', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByRole('button', { name: /1 hour/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /2 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /4 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /8 hours/i })).toBeInTheDocument();
    });
  });

  describe('Location Section', () => {
    it('should load and display locations', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await waitFor(() => {
        expect(screen.getByText('Station 1 Conference Room')).toBeInTheDocument();
        expect(screen.getByText('Training Center')).toBeInTheDocument();
      });
    });

    it('shows only room names when all facility rooms belong to one facility', async () => {
      vi.mocked(apiModule.locationsService.getLocations).mockResolvedValue([
        {
          id: 'room-1',
          name: 'Quartermaster Storage — Volunteer Office — Station 1',
          facility_id: 'facility-1',
          facility_room_id: 'room-1',
          building: 'Station 1',
          address: '1 Main Street',
          is_active: true,
        },
        {
          id: 'room-2',
          name: 'Conference Room — Station 1',
          facility_id: 'facility-1',
          facility_room_id: 'room-2',
          is_active: true,
        },
      ] as unknown as Location[]);

      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const locationSelect = await screen.findByLabelText(/location/i);
      const labels = Array.from((locationSelect as HTMLSelectElement).options).map((option) => option.text);
      expect(labels).toContain('Quartermaster Storage');
      expect(labels).toContain('Conference Room');
      expect(labels).not.toContain('Quartermaster Storage (Station 1) — 1 Main Street');
    });

    it('keeps room hierarchy when rooms span multiple facilities', async () => {
      vi.mocked(apiModule.locationsService.getLocations).mockResolvedValue([
        {
          id: 'room-1',
          name: 'Storage — Office — Station 1',
          facility_id: 'facility-1',
          facility_room_id: 'room-1',
          is_active: true,
        },
        {
          id: 'room-2',
          name: 'Storage — Office — Station 2',
          facility_id: 'facility-2',
          facility_room_id: 'room-2',
          is_active: true,
        },
      ] as unknown as Location[]);

      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const locationSelect = await screen.findByLabelText(/location/i);
      expect(locationSelect).toHaveTextContent('Storage — Office — Station 1');
      expect(locationSelect).toHaveTextContent('Storage — Office — Station 2');
    });

    it('should toggle between select and manual location modes', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await waitFor(() => {
        expect(screen.getByLabelText(/location/i)).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const locationSelect = screen.getByLabelText(/location/i);
      await user.selectOptions(locationSelect, '__other__');

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/city hall/i)).toBeInTheDocument();
      });
    });

    it('should fall back to text input when no locations are available', async () => {
      vi.mocked(apiModule.locationsService.getLocations).mockResolvedValue([]);

      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/station 1 conference room/i)).toBeInTheDocument();
      });
    });
  });

  describe('RSVP Settings', () => {
    it('hides only the deadline until a response is required', () => {
      // Capacity, guests and roster visibility apply to an event that merely
      // *accepts* RSVPs, so they stay available. Only a deadline is
      // meaningless without an expectation to be late for.
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.queryByLabelText(/rsvp deadline/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/max attendees/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/allow guests/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/who can see who's going/i)).toBeInTheDocument();
    });

    it('should show the deadline when Require RSVP is checked', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      const rsvpCheckbox = screen.getByLabelText(/require rsvp/i);
      await user.click(rsvpCheckbox);

      await waitFor(() => {
        expect(screen.getByLabelText(/rsvp deadline/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/max attendees/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/allow guests/i)).toBeInTheDocument();
      });
    });

    it('asks for a deadline before creating an event that requires RSVPs', async () => {
      // The API refuses to create one without it (EventCreate.validate_dates),
      // so catching it here keeps the member on a form that says what to fix.
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/title/i), 'RSVP drill');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-01' } });
      await user.click(screen.getByLabelText(/require rsvp/i));

      expect(screen.getByLabelText(/rsvp deadline\s*\*/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /create event/i }));

      expect(screen.getByRole('alert')).toHaveTextContent('Set an RSVP deadline');
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('does not demand a deadline when editing, where the API does not either', async () => {
      mockOnSubmit.mockResolvedValue(undefined);
      renderWithRouter(
        <EventForm
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
          editingEventId="evt-1"
          submitLabel="Save Changes"
          initialData={{ title: 'RSVP drill', requires_rsvp: true }}
        />
      );

      const user = userEvent.setup();
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-01' } });

      expect(screen.getByLabelText(/rsvp deadline/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/rsvp deadline\s*\*/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({ requires_rsvp: true }));
      });
    });

    it('keeps capacity and guests when Require RSVP is turned back off', async () => {
      // The submit path used to wipe max_attendees and allow_guests whenever
      // requires_rsvp was false, which silently uncapped a voluntary event and
      // revoked its guests on every save.
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/max attendees/i), '10');
      await user.click(screen.getByLabelText(/allow guests/i));
      await user.click(screen.getByLabelText(/require rsvp/i));
      await user.click(screen.getByLabelText(/require rsvp/i));

      expect(screen.getByLabelText(/max attendees/i)).toHaveValue(10);
      expect(screen.getByLabelText(/allow guests/i)).toBeChecked();
    });

    it('should show RSVP status options when RSVP is enabled', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await user.click(screen.getByLabelText(/require rsvp/i));

      await waitFor(() => {
        expect(screen.getByText('RSVP Status Options')).toBeInTheDocument();
        expect(screen.getByLabelText('Going')).toBeInTheDocument();
        expect(screen.getByLabelText('Not Going')).toBeInTheDocument();
        expect(screen.getByLabelText('Maybe')).toBeInTheDocument();
      });
    });
  });

  describe('Check-In Settings', () => {
    it('should render check-in window dropdown', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const checkinSelect = screen.getByLabelText(/check-in window/i);
      expect(checkinSelect).toBeInTheDocument();
    });

    it('should show the standard 60-minute lead time for flexible check-in', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByLabelText(/minutes before/i)).toHaveValue(60);
    });

    it('should shorten the lead time when a business meeting immediately precedes it', async () => {
      renderWithRouter(
        <EventForm
          initialData={{ start_datetime: '2026-08-13T18:00:00Z' }}
          userEvents={[
            {
              id: 'previous-meeting',
              title: 'Previous meeting',
              event_type: 'business_meeting',
              start_datetime: '2026-08-13T16:45:00Z',
              end_datetime: '2026-08-13T17:45:00Z',
            },
          ]}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      await waitFor(() => expect(screen.getByLabelText(/minutes before/i)).toHaveValue(15));
    });

    it('should derive the lead time from the gap when the preceding meeting is back-to-back', async () => {
      renderWithRouter(
        <EventForm
          initialData={{ start_datetime: '2026-08-13T18:00:00Z' }}
          userEvents={[
            {
              id: 'previous-meeting',
              title: 'Previous meeting',
              event_type: 'business_meeting',
              start_datetime: '2026-08-13T17:00:00Z',
              end_datetime: '2026-08-13T18:00:00Z',
            },
          ]}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Gap of 0 — check-in must not open during the earlier meeting at all.
      await waitFor(() => expect(screen.getByLabelText(/minutes before/i)).toHaveValue(0));
    });

    it('should derive the lead time from the gap when it is under 15 minutes', async () => {
      renderWithRouter(
        <EventForm
          initialData={{ start_datetime: '2026-08-13T18:00:00Z' }}
          userEvents={[
            {
              id: 'previous-meeting',
              title: 'Previous meeting',
              event_type: 'business_meeting',
              start_datetime: '2026-08-13T16:50:00Z',
              end_datetime: '2026-08-13T17:50:00Z',
            },
          ]}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Gap of 10 minutes — lead is the gap, not the 15-minute standard.
      await waitFor(() => expect(screen.getByLabelText(/minutes before/i)).toHaveValue(10));
    });

    it('should cap the shortened lead time at 15 minutes for larger gaps', async () => {
      renderWithRouter(
        <EventForm
          initialData={{ start_datetime: '2026-08-13T18:00:00Z' }}
          userEvents={[
            {
              id: 'previous-meeting',
              title: 'Previous meeting',
              event_type: 'business_meeting',
              start_datetime: '2026-08-13T16:30:00Z',
              end_datetime: '2026-08-13T17:30:00Z',
            },
          ]}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Gap of 30 minutes — the shortened standard (15) applies, not the gap.
      await waitFor(() => expect(screen.getByLabelText(/minutes before/i)).toHaveValue(15));
    });

    it('should keep the standard 60-minute lead when no meeting precedes within the hour', async () => {
      renderWithRouter(
        <EventForm
          initialData={{ start_datetime: '2026-08-13T18:00:00Z' }}
          userEvents={[
            {
              id: 'distant-meeting',
              title: 'Distant meeting',
              event_type: 'business_meeting',
              start_datetime: '2026-08-13T15:00:00Z',
              end_datetime: '2026-08-13T16:00:00Z',
            },
          ]}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      await waitFor(() => expect(screen.getByLabelText(/minutes before/i)).toHaveValue(60));
    });

    it('should show window options when Window type is selected', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      const checkinSelect = screen.getByLabelText(/check-in window/i);
      await user.selectOptions(checkinSelect, 'window');

      await waitFor(() => {
        expect(screen.getByLabelText(/minutes before/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/minutes after/i)).toBeInTheDocument();
      });
    });

    it('should render require checkout checkbox', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByLabelText(/require manual check-out/i)).toBeInTheDocument();
    });
  });

  describe('Recruitment events', () => {
    /** The type picker regroups once org settings load: recruitment is not a
     *  visible type, so it moves into the "Other" optgroup. Selecting before
     *  that re-render lands on the pre-fetch option list and is discarded. */
    const selectRecruitment = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByRole('group', { name: 'Other' });
      await user.selectOptions(screen.getByLabelText(/event type/i), 'recruitment');
    };

    const guestSignIn = () => screen.getByLabelText(/allow guest \(non-member\) sign-in/i);
    const createsProspect = () => screen.getByLabelText(/add guests to the prospective members pipeline/i);

    it('turns both guest sign-in switches on for a new recruitment event', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await selectRecruitment(userEvent.setup());

      await waitFor(() => {
        expect(guestSignIn()).toBeChecked();
        expect(createsProspect()).toBeChecked();
      });
      // The default is stated, not silent.
      expect(screen.getByText(/will be added to the prospective members pipeline/i)).toBeInTheDocument();
    });

    it('withdraws its own defaults when the type changes away again', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await selectRecruitment(user);
      await waitFor(() => expect(guestSignIn()).toBeChecked());

      await user.selectOptions(screen.getByLabelText(/event type/i), 'social');

      await waitFor(() => expect(guestSignIn()).not.toBeChecked());
    });

    it('leaves a hand-set guest choice alone when the type changes', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await screen.findByRole('group', { name: 'Other' });
      await user.click(guestSignIn());
      await waitFor(() => expect(guestSignIn()).toBeChecked());

      await user.selectOptions(screen.getByLabelText(/event type/i), 'recruitment');
      await user.selectOptions(screen.getByLabelText(/event type/i), 'social');

      // Auto-defaults never applied, so nothing may be withdrawn either.
      expect(guestSignIn()).toBeChecked();
    });

    it('does not change guest settings on an event that already exists', async () => {
      renderWithRouter(
        <EventForm
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
          editingEventId="event-1"
          initialData={{
            title: 'Standing open house',
            event_type: 'social',
            start_datetime: '2026-09-01T18:00:00Z',
            end_datetime: '2026-09-01T20:00:00Z',
            allow_guest_check_in: false,
            guest_check_in_creates_prospect: false,
          }}
        />
      );

      const user = userEvent.setup();
      await selectRecruitment(user);

      expect(guestSignIn()).not.toBeChecked();
      expect(await screen.findByRole('button', { name: /enable guest sign-in/i })).toBeInTheDocument();
    });

    it('turns on both switches from the prompt when they are off', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await selectRecruitment(user);
      await waitFor(() => expect(guestSignIn()).toBeChecked());

      await user.click(guestSignIn());
      await waitFor(() => expect(guestSignIn()).not.toBeChecked());

      await user.click(await screen.findByRole('button', { name: /enable guest sign-in/i }));

      await waitFor(() => {
        expect(guestSignIn()).toBeChecked();
        expect(createsProspect()).toBeChecked();
      });
      expect(screen.queryByRole('button', { name: /enable guest sign-in/i })).not.toBeInTheDocument();
    });

    it('does not prompt for other event types', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await screen.findByRole('group', { name: 'Other' });
      await user.selectOptions(screen.getByLabelText(/event type/i), 'social');

      expect(screen.queryByRole('button', { name: /enable guest sign-in/i })).not.toBeInTheDocument();
    });
  });

  describe('Notifications Section', () => {
    it('defaults mandatory events to all-member reminders', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await user.click(screen.getByLabelText(/mandatory attendance/i));

      expect(screen.getByLabelText(/who should receive reminders/i)).toHaveValue('all');
    });

    it('should remind signed-up members by default', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByLabelText(/who should receive reminders/i)).toHaveValue('going');
    });

    it('should show reminder schedule when reminders enabled', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByText(/reminder schedule/i)).toBeInTheDocument();
    });

    it('should hide reminder schedule when reminders disabled', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText(/who should receive reminders/i), 'none');

      await waitFor(() => {
        expect(screen.queryByText(/reminder schedule/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Attendance Section', () => {
    it('should render mandatory checkbox', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByLabelText(/mandatory attendance/i)).toBeInTheDocument();
    });

    it('should render attendance section with mandatory checkbox', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const heading = screen.getAllByRole('heading', { level: 2 }).find((h) => h.textContent?.includes('Attendance'));
      expect(heading).toBeInTheDocument();
      expect(screen.getByLabelText(/mandatory attendance/i)).toBeInTheDocument();
    });

    it('allows multiple mandatory member types to be selected', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      expect(screen.queryByText('Mandatory for')).not.toBeInTheDocument();

      await user.click(screen.getByLabelText(/mandatory attendance/i));

      expect(screen.getByText('Mandatory for')).toBeInTheDocument();
      expect(screen.getByLabelText('Active Member')).toBeInTheDocument();
      expect(screen.getByLabelText('Cadet')).toBeInTheDocument();

      await user.click(screen.getByLabelText('Active Member'));
      await user.click(screen.getByLabelText('Cadet'));

      expect(screen.getByLabelText('Active Member')).toBeChecked();
      expect(screen.getByLabelText('Cadet')).toBeChecked();
    });

    it('requires a member type for mandatory attendance', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      await user.click(screen.getByLabelText(/mandatory attendance/i));
      await user.type(screen.getByLabelText(/title/i), 'Required drill');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-01' } });
      await user.click(screen.getByRole('button', { name: /create event/i }));

      expect(screen.getByRole('alert')).toHaveTextContent('Select at least one member type');
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Form Submission', () => {
    it('should call onSubmit with form data', async () => {
      mockOnSubmit.mockResolvedValue(undefined);

      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();

      // Fill required fields
      await user.type(screen.getByLabelText(/title/i), 'Test Event');

      const startInput = screen.getByLabelText(/start date & time/i);
      fireEvent.change(startInput, { target: { value: '2026-04-01' } });

      const endInput = screen.getByLabelText(/end date & time/i);
      fireEvent.change(endInput, { target: { value: '2026-04-01' } });

      // Submit form
      const submitButton = screen.getByRole('button', { name: /create event/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Event',
          })
        );
      });
    });

    it('should show error when end date is before start date', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/title/i), 'Test Event');

      const startInput = screen.getByLabelText(/start date & time/i);
      fireEvent.change(startInput, { target: { value: '2026-04-02' } });

      const endInput = screen.getByLabelText(/end date & time/i);
      fireEvent.change(endInput, { target: { value: '2026-04-01' } });

      const submitButton = screen.getByRole('button', { name: /create event/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('End date must be after start date')).toBeInTheDocument();
      });

      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should call onCancel when cancel button is clicked', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Initial Data', () => {
    it('should pre-fill form with initial data', async () => {
      renderWithRouter(
        <EventForm
          initialData={{
            title: 'Existing Event',
            event_type: 'social',
            is_mandatory: true,
            requires_rsvp: true,
          }}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event');
        expect(screen.getByLabelText(/event type/i)).toHaveValue('social');
        expect(screen.getByLabelText(/mandatory attendance/i)).toBeChecked();
        expect(screen.getByLabelText(/require rsvp/i)).toBeChecked();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper form labels', () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/event type/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/start date & time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/end date & time/i)).toBeInTheDocument();
    });

    it('should have error role for validation messages', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/title/i), 'Test');

      const startInput = screen.getByLabelText(/start date & time/i);
      fireEvent.change(startInput, { target: { value: '2026-04-02' } });

      const endInput = screen.getByLabelText(/end date & time/i);
      fireEvent.change(endInput, { target: { value: '2026-04-01' } });

      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('Organizer pickers', () => {
    const roster = [
      { id: 'u-olive', first_name: 'Olive', last_name: 'Organizer', username: 'olive', status: 'active' },
      { id: 'u-alex', first_name: 'Alex', last_name: 'Alternate', username: 'alex', status: 'probationary' },
      { id: 'u-rita', first_name: 'Rita', last_name: 'Retired', username: 'rita', status: 'retired' },
    ];

    beforeEach(() => {
      vi.mocked(apiModule.userService.getUsers).mockReset();
      vi.mocked(apiModule.userService.getUsers).mockResolvedValue(
        roster as unknown as Awaited<ReturnType<typeof apiModule.userService.getUsers>>
      );
      mockOnSubmit.mockReset();
      mockOnSubmit.mockResolvedValue(undefined);
    });

    const fillRequired = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText(/title/i), 'Drill Night');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-01' } });
    };

    it('is not offered unless asked for, and sends no organizer keys', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const user = userEvent.setup();
      await fillRequired(user);

      expect(screen.queryByLabelText(/^organizer/i)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => expect(mockOnSubmit).toHaveBeenCalled());
      const payload = mockOnSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('organizer_id');
      expect(apiModule.userService.getUsers).not.toHaveBeenCalled();
    });

    it('offers active and probationary members, and omits the organizer left on the default', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} showOrganizerPickers />);
      const user = userEvent.setup();

      const organizer = await screen.findByLabelText(/^organizer/i);
      await waitFor(() => expect(screen.getAllByRole('option', { name: 'Alex Alternate' }).length).toBeGreaterThan(0));
      expect(screen.queryByRole('option', { name: 'Rita Retired' })).not.toBeInTheDocument();
      expect(organizer).toHaveValue('');

      await fillRequired(user);
      await user.selectOptions(screen.getByLabelText(/^alternate/i), 'u-alex');
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() =>
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ organizer_id: undefined, alternate_organizer_id: 'u-alex' })
        )
      );
    });

    it('sends a chosen organizer, and drops an alternate who becomes the organizer', async () => {
      renderWithRouter(<EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} showOrganizerPickers />);
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getAllByRole('option', { name: 'Olive Organizer' }).length).toBeGreaterThan(0));

      await fillRequired(user);
      await user.selectOptions(screen.getByLabelText(/^alternate/i), 'u-olive');
      await user.selectOptions(screen.getByLabelText(/^organizer/i), 'u-olive');

      expect(screen.getByLabelText(/^alternate/i)).toHaveValue('');
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() =>
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ organizer_id: 'u-olive', alternate_organizer_id: undefined })
        )
      );
    });
  });
});
