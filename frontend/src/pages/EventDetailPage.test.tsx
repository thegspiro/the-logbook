import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { EventDetailPage } from './EventDetailPage';
import * as apiModule from '../services/api';
import type { Event, EventStats, RSVP } from '../types/event';
import type { CurrentUser } from '../types/auth';

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
    getEventRSVPs: vi.fn(),
    getEventAttendees: vi.fn(),
    getEventStats: vi.fn(),
    getEligibleMembers: vi.fn(),
    createOrUpdateRSVP: vi.fn(),
    cancelEvent: vi.fn(),
    deleteEvent: vi.fn(),
    duplicateEvent: vi.fn(),
    checkInAttendee: vi.fn(),
    recordActualTimes: vi.fn(),
    finalizeAttendance: vi.fn(),
    reopenAttendance: vi.fn(),
  },
}));

vi.mock('../components/event-detail/TrainingSessionLinkageCard', () => ({
  default: () => null,
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
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

// Mock auth store
const mockCheckPermission = vi.fn();
const mockAuthState = {
  checkPermission: mockCheckPermission,
  user: null as CurrentUser | null,
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState as unknown as Record<string, unknown>) : mockAuthState
  ),
}));

const mockEvent: Event = {
  id: 'evt-1',
  organization_id: 'org-1',
  title: 'Monthly Business Meeting',
  description: 'Regular monthly meeting to discuss department updates.',
  event_type: 'business_meeting',
  location: 'Station 1 Conference Room',
  start_datetime: '2030-04-15T18:00:00Z',
  end_datetime: '2030-04-15T20:00:00Z',
  requires_rsvp: true,
  rsvp_deadline: '2030-04-14T18:00:00Z',
  max_attendees: 50,
  allowed_rsvp_statuses: ['going', 'not_going'],
  is_mandatory: false,
  allow_guests: true,
  send_reminders: true,
  reminder_target: 'all',
  reminder_schedule: [24],
  is_cancelled: false,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-20T10:00:00Z',
};

const mockStats: EventStats = {
  event_id: 'evt-1',
  total_rsvps: 25,
  going_count: 20,
  not_going_count: 3,
  maybe_count: 2,
  checked_in_count: 15,
  total_guests: 5,
  capacity_percentage: 50,
};

const mockRSVPs: RSVP[] = [
  {
    id: 'rsvp-1',
    event_id: 'evt-1',
    user_id: 'user-1',
    status: 'going',
    guest_count: 1,
    responded_at: '2026-03-10T10:00:00Z',
    updated_at: '2026-03-10T10:00:00Z',
    checked_in: false,
    user_name: 'John Doe',
    user_email: 'john@example.com',
  },
  {
    id: 'rsvp-2',
    event_id: 'evt-1',
    user_id: 'user-2',
    status: 'going',
    guest_count: 0,
    responded_at: '2026-03-10T10:00:00Z',
    updated_at: '2026-03-10T10:00:00Z',
    checked_in: true,
    checked_in_at: '2026-03-15T17:55:00Z',
    user_name: 'Jane Smith',
    user_email: 'jane@example.com',
  },
];

describe('EventDetailPage', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(false);
    mockAuthState.checkPermission = mockCheckPermission;
    mockAuthState.user = null;
    // A sane default for every block. vi.clearAllMocks() drops
    // implementations but not the mock itself, so without this the member
    // roster fetch resolves undefined in blocks that never mention it.
    vi.mocked(eventService.getEventAttendees).mockResolvedValue([]);
  });

  describe('Loading State', () => {
    it('should display loading spinner initially', () => {
      vi.mocked(eventService.getEvent).mockImplementation(() => new Promise(() => {}));

      renderWithRouter(<EventDetailPage />);

      expect(screen.getByText('Loading event details...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error when event fails to load', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(makeApiError('Event not found', 404));

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Event not found')).toBeInTheDocument();
      });
    });

    it('should show back to events button on error', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(makeApiError('Event not found', 404));

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        const backButton = screen.getByRole('button', { name: /back to events/i });
        expect(backButton).toBeInTheDocument();
      });
    });

    it('should navigate to events on back button click', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(makeApiError('Event not found', 404));

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(async () => {
        const backButton = screen.getByRole('button', { name: /back to events/i });
        await user.click(backButton);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/events');
    });
  });

  describe('Event Details Display', () => {
    it('should display event title', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
      });
    });

    it('should display event description', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Regular monthly meeting to discuss department updates.')).toBeInTheDocument();
      });
    });

    it('should display location', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Station 1 Conference Room')).toBeInTheDocument();
      });
    });

    it('should display cancelled badge for cancelled events', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        is_cancelled: true,
        cancellation_reason: 'Weather emergency',
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
        expect(screen.getByText(/Weather emergency/)).toBeInTheDocument();
      });
    });

    it('should display mandatory badge for mandatory events', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        is_mandatory: true,
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Mandatory')).toBeInTheDocument();
      });
    });

    it('should show QR code button for active events', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view qr code/i })).toBeInTheDocument();
      });
    });
  });

  describe('RSVP Flow', () => {
    it('should show RSVP button for events requiring RSVP', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /rsvp now/i })).toBeInTheDocument();
      });
    });

    it('should not show RSVP button for cancelled events', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        is_cancelled: true,
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /rsvp now/i })).not.toBeInTheDocument();
    });

    it('should open RSVP modal and submit successfully', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.createOrUpdateRSVP).mockResolvedValue({} as unknown as RSVP);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(async () => {
        const rsvpButton = screen.getByRole('button', { name: /rsvp now/i });
        await user.click(rsvpButton);
      });

      // Modal should be open
      await waitFor(() => {
        expect(screen.getByText(`RSVP for ${mockEvent.title}`)).toBeInTheDocument();
      });

      // Submit the RSVP
      const submitButton = screen.getByRole('button', { name: /submit rsvp/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(eventService.createOrUpdateRSVP).toHaveBeenCalledWith(
          'evt-1',
          expect.objectContaining({
            status: 'going',
          })
        );
      });
    });

    it('should show Update RSVP when user already has RSVP', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        user_rsvp_status: 'going',
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /update rsvp/i })).toBeInTheDocument();
      });
    });
  });

  describe('Manager Features', () => {
    beforeEach(() => {
      mockCheckPermission.mockReturnValue(true);
      mockAuthState.checkPermission = mockCheckPermission;
      mockAuthState.user = { id: 'admin-1', permissions: ['events.manage'] } as CurrentUser;
    });

    it('should show management buttons for managers', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        const editButtons = screen.getAllByRole('button', { name: /edit/i });
        expect(editButtons.length).toBeGreaterThan(0);
        const checkInButtons = screen.getAllByRole('button', { name: /check in/i });
        expect(checkInButtons.length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /more/i })).toBeInTheDocument();
      });

      // Open the More dropdown to verify secondary actions
      await user.click(screen.getByRole('button', { name: /more/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /duplicate event/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /record times/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel event/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete event/i })).toBeInTheDocument();
      });
    });

    it('defaults official event times to the scheduled times', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);
      await user.click(await screen.findByRole('button', { name: /more/i }));
      await user.click(screen.getByRole('button', { name: /record times/i }));

      expect(screen.getByLabelText('Actual Start Time')).toHaveValue('2030-04-15');
      expect(screen.getByLabelText('Actual End Time')).toHaveValue('2030-04-15');
      expect(screen.getByText('120 minutes')).toBeInTheDocument();
    });

    it('preserves already-recorded official event times', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        actual_start_time: '2030-04-15T18:30:00Z',
        actual_end_time: '2030-04-15T19:45:00Z',
      });
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);
      await user.click(await screen.findByRole('button', { name: /more/i }));
      await user.click(screen.getByRole('button', { name: /record times/i }));

      expect(screen.getByText('75 minutes')).toBeInTheDocument();
      expect(screen.getAllByText(/Currently:/)).toHaveLength(2);
    });

    it('should show Finalize Attendance as a primary action when the event is over', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        start_datetime: '2025-04-15T18:00:00Z',
        end_datetime: '2025-04-15T20:00:00Z',
      });
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      const finalizeButton = await screen.findByRole('button', { name: 'Finalize Attendance' });
      expect(finalizeButton).toBeVisible();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /more/i }));
      expect(screen.getAllByRole('button', { name: /finalize attendance/i })).toHaveLength(1);
    });

    it('should finalize attendance once the close is confirmed', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        start_datetime: '2025-04-15T18:00:00Z',
        end_datetime: '2025-04-15T20:00:00Z',
      });
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.finalizeAttendance).mockResolvedValue({ updated_count: 2 });

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);
      await user.click(await screen.findByRole('button', { name: 'Finalize Attendance' }));
      await user.click(await screen.findByRole('button', { name: /finalize and close/i }));

      await waitFor(() => {
        expect(eventService.finalizeAttendance).toHaveBeenCalledWith('evt-1');
      });
    });

    it('should not finalize when the close is declined', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        start_datetime: '2025-04-15T18:00:00Z',
        end_datetime: '2025-04-15T20:00:00Z',
      });
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);
      await user.click(await screen.findByRole('button', { name: 'Finalize Attendance' }));
      await user.click(await screen.findByRole('button', { name: /keep it open/i }));

      await waitFor(() => {
        expect(eventService.finalizeAttendance).not.toHaveBeenCalled();
      });
    });

    describe('once attendance is finalized', () => {
      const finalizedEvent: Event = {
        ...mockEvent,
        start_datetime: '2025-04-15T18:00:00Z',
        end_datetime: '2025-04-15T20:00:00Z',
        attendance_finalized_at: '2025-04-15T20:30:00Z',
        attendance_finalized_by: 'chief-1',
        attendance_finalized_by_name: 'Pat Ramirez',
      };

      const renderFinalized = () => {
        vi.mocked(eventService.getEvent).mockResolvedValue(finalizedEvent);
        vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
        vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
        renderWithRouter(<EventDetailPage />);
      };

      it('says who closed it and when', async () => {
        renderFinalized();

        expect(await screen.findByText('Attendance finalized')).toBeVisible();
        expect(screen.getByText(/Closed by Pat Ramirez/)).toBeVisible();
      });

      it('drops the actions the API now refuses', async () => {
        renderFinalized();
        await screen.findByText('Attendance finalized');

        // Every one of these is a 409 on a closed event; an enabled button
        // that always fails is worse than an absent one.
        expect(screen.queryByRole('button', { name: 'Finalize Attendance' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
        // Edit stays: the API still accepts descriptive edits on a closed
        // event and refuses only the attendance-sensitive fields, so removing
        // the entry point would force a reopen just to fix a typo.
        expect(screen.getByRole('button', { name: /^edit$/i })).toBeVisible();
        expect(screen.queryByRole('button', { name: /send reminders/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /edit times/i })).not.toBeInTheDocument();
      });

      it('keeps the roster readable and exportable', async () => {
        renderFinalized();
        await screen.findByText('Attendance finalized');

        expect(screen.getByText('Jane Smith')).toBeVisible();
        expect(screen.getByRole('button', { name: /export csv/i })).toBeVisible();
        expect(screen.getByRole('button', { name: /print roster/i })).toBeVisible();
      });

      it('hides delete and cancel from the More menu', async () => {
        renderFinalized();
        await screen.findByText('Attendance finalized');

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /more/i }));

        expect(screen.queryByRole('button', { name: /delete event/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /cancel event/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /record times/i })).not.toBeInTheDocument();
        // Harmless ones stay.
        expect(screen.getByRole('button', { name: /duplicate event/i })).toBeVisible();
      });

      it('offers no way back without the reopen permission', async () => {
        // events.manage alone is not enough — that is the grant that closed it.
        mockCheckPermission.mockImplementation((perm: string) => perm === 'events.manage');
        renderFinalized();
        await screen.findByText('Attendance finalized');

        expect(screen.queryByRole('button', { name: /reopen attendance/i })).not.toBeInTheDocument();
      });

      it('offers Reopen Attendance to a leader who holds the grant', async () => {
        mockCheckPermission.mockImplementation(
          (perm: string) => perm === 'events.manage' || perm === 'events.reopen_attendance'
        );
        renderFinalized();
        await screen.findByText('Attendance finalized');

        expect(screen.getByRole('button', { name: /reopen attendance/i })).toBeVisible();
      });

      it('offers it to a role holding only the reopen grant', async () => {
        // The permission is deliberately independent of events.manage, so the
        // control must not be nested inside the manager-only action group.
        mockCheckPermission.mockImplementation((perm: string) => perm === 'events.reopen_attendance');
        renderFinalized();
        await screen.findByText('Attendance finalized');

        expect(screen.getByRole('button', { name: /reopen attendance/i })).toBeVisible();
      });

      it('reopens with the reason the leader typed', async () => {
        mockCheckPermission.mockImplementation(
          (perm: string) => perm === 'events.manage' || perm === 'events.reopen_attendance'
        );
        vi.mocked(eventService.reopenAttendance).mockResolvedValue({
          ...finalizedEvent,
          attendance_finalized_at: null,
        });
        renderFinalized();
        await screen.findByText('Attendance finalized');

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /reopen attendance/i }));
        await user.type(await screen.findByLabelText(/reason/i), 'Two members were left off');
        await user.click(screen.getByRole('button', { name: /reopen for corrections/i }));

        await waitFor(() => {
          expect(eventService.reopenAttendance).toHaveBeenCalledWith('evt-1', 'Two members were left off');
        });
      });
    });

    it('should show Finalize Attendance when an event is ended early', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        actual_end_time: '2026-08-14T01:00:00Z',
      });
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByRole('button', { name: 'Finalize Attendance' })).toBeVisible();
    });

    it('should display statistics sidebar', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Statistics')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument(); // total_rsvps
        expect(screen.getByText('20')).toBeInTheDocument(); // going_count
      });
    });

    it('should display RSVPs list', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });
    });

    it('should show Check In button for unchecked members', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        // John Doe is going but not checked in - should have Check In button
        const checkInButtons = screen.getAllByRole('button', { name: /^check in$/i });
        expect(checkInButtons.length).toBeGreaterThan(0);
      });
    });

    it('should show Checked In badge for checked-in members', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        // Jane Smith is checked in
        const checkedInBadges = screen.getAllByText('Checked In');
        expect(checkedInBadges.length).toBeGreaterThan(0);
      });
    });

    it('should navigate to edit page when Edit is clicked', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(async () => {
        const editButton = screen.getByRole('button', { name: /edit/i });
        await user.click(editButton);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/events/evt-1/edit');
    });
  });

  describe('Cancel Event Modal', () => {
    beforeEach(() => {
      mockCheckPermission.mockReturnValue(true);
      mockAuthState.checkPermission = mockCheckPermission;
      mockAuthState.user = { id: 'admin-1', permissions: ['events.manage'] } as CurrentUser;
    });

    it('should open and submit cancel modal', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.cancelEvent).mockResolvedValue({} as unknown as Event);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      // Wait for page to load
      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open the More dropdown, then click Cancel Event
      await user.click(screen.getByRole('button', { name: /more/i }));
      const firstCancelButton = screen.getAllByRole('button', { name: /cancel event/i })[0] ?? document.body;
      await user.click(firstCancelButton);

      // Modal should be open
      await waitFor(() => {
        expect(
          screen.getByText('This action cannot be undone. The event will be marked as cancelled.')
        ).toBeInTheDocument();
      });

      // Fill in reason
      const reasonInput = screen.getByPlaceholderText(/please provide a reason/i);
      await user.type(reasonInput, 'The venue is no longer available for this date');

      // Submit via the modal's submit button (type="submit")
      const submitButtons = screen.getAllByRole('button', { name: /cancel event/i });
      const modalSubmitButton =
        submitButtons.find((btn) => btn.getAttribute('type') === 'submit') ??
        submitButtons[submitButtons.length - 1] ??
        document.body;
      await user.click(modalSubmitButton);

      await waitFor(() => {
        expect(eventService.cancelEvent).toHaveBeenCalledWith(
          'evt-1',
          expect.objectContaining({
            cancellation_reason: 'The venue is no longer available for this date',
            send_notifications: false,
          })
        );
      });
    });

    it('should include send_notifications when checkbox is checked', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.cancelEvent).mockResolvedValue({} as unknown as Event);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open More dropdown, then cancel modal
      await user.click(screen.getByRole('button', { name: /more/i }));
      const firstCancelBtn = screen.getAllByRole('button', { name: /cancel event/i })[0] ?? document.body;
      await user.click(firstCancelBtn);

      // Check the notifications checkbox
      const notifyCheckbox = screen.getByLabelText(/send cancellation notifications/i);
      await user.click(notifyCheckbox);

      // Fill in reason and submit
      const reasonInput = screen.getByPlaceholderText(/please provide a reason/i);
      await user.type(reasonInput, 'Weather emergency - event postponed');

      const submitButtons2 = screen.getAllByRole('button', { name: /cancel event/i });
      const modalSubmitBtn =
        submitButtons2.find((btn) => btn.getAttribute('type') === 'submit') ??
        submitButtons2[submitButtons2.length - 1] ??
        document.body;
      await user.click(modalSubmitBtn);

      await waitFor(() => {
        expect(eventService.cancelEvent).toHaveBeenCalledWith(
          'evt-1',
          expect.objectContaining({
            send_notifications: true,
          })
        );
      });
    });
  });

  describe('Delete Event Modal', () => {
    beforeEach(() => {
      mockCheckPermission.mockReturnValue(true);
      mockAuthState.checkPermission = mockCheckPermission;
      mockAuthState.user = { id: 'admin-1', permissions: ['events.manage'] } as CurrentUser;
    });

    it('should open delete confirmation modal', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open More dropdown then click Delete Event
      await user.click(screen.getByRole('button', { name: /more/i }));
      const deleteButton = screen.getByRole('button', { name: /delete event/i });
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByText('Delete Event')).toBeInTheDocument();
        expect(screen.getByText(/are you sure you want to permanently delete/i)).toBeInTheDocument();
      });
    });

    it('should delete event and navigate away', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.deleteEvent).mockResolvedValue(undefined);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open More dropdown then Delete Event
      await user.click(screen.getByRole('button', { name: /more/i }));
      const deleteButton = screen.getByRole('button', { name: /delete event/i });
      await user.click(deleteButton);

      // Confirm delete
      await waitFor(async () => {
        const confirmButton = screen.getByRole('button', { name: /delete permanently/i });
        await user.click(confirmButton);
      });

      await waitFor(() => {
        expect(eventService.deleteEvent).toHaveBeenCalledWith('evt-1');
        expect(mockNavigate).toHaveBeenCalledWith('/events');
      });
    });

    it('should close delete modal on Go Back', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open More dropdown then Delete Event
      await user.click(screen.getByRole('button', { name: /more/i }));
      const deleteButton = screen.getByRole('button', { name: /delete event/i });
      await user.click(deleteButton);

      // Click Go Back
      await waitFor(async () => {
        const goBackButton = screen.getByRole('button', { name: /go back/i });
        await user.click(goBackButton);
      });

      await waitFor(() => {
        expect(screen.queryByText('Delete Event')).not.toBeInTheDocument();
      });
    });
  });

  describe('Duplicate Event', () => {
    beforeEach(() => {
      mockCheckPermission.mockReturnValue(true);
      mockAuthState.checkPermission = mockCheckPermission;
      mockAuthState.user = { id: 'admin-1', permissions: ['events.manage'] } as CurrentUser;
    });

    it('should duplicate event and navigate to edit page', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.duplicateEvent).mockResolvedValue({
        ...mockEvent,
        id: 'evt-copy-1',
        title: 'Copy of Monthly Business Meeting',
      });

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open More dropdown then click Duplicate
      await user.click(screen.getByRole('button', { name: /more/i }));
      const duplicateButton = screen.getByRole('button', { name: /duplicate event/i });
      await user.click(duplicateButton);

      await waitFor(() => {
        expect(eventService.duplicateEvent).toHaveBeenCalledWith('evt-1');
        expect(mockNavigate).toHaveBeenCalledWith('/events/evt-copy-1/edit');
      });
    });

    it('should show error toast when duplication fails', async () => {
      const toastModule = await import('react-hot-toast');

      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.duplicateEvent).mockRejectedValue(makeApiError('Event not found', 404));

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open More dropdown then click Duplicate
      await user.click(screen.getByRole('button', { name: /more/i }));
      const duplicateButton = screen.getByRole('button', { name: /duplicate event/i });
      await user.click(duplicateButton);

      await waitFor(() => {
        expect(toastModule.default.error).toHaveBeenCalledWith('Event not found');
      });
    });

    it('should not show duplicate button for non-managers', async () => {
      mockCheckPermission.mockReturnValue(false);
      mockAuthState.checkPermission = mockCheckPermission;
      mockAuthState.user = null;

      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /duplicate/i })).not.toBeInTheDocument();
    });
  });

  describe('Event Information Sidebar', () => {
    it('should show RSVP required info', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('RSVP Required')).toBeInTheDocument();
        expect(screen.getByText('Capacity')).toBeInTheDocument();
        expect(screen.getByText('0 / 50')).toBeInTheDocument();
      });
    });

    it('should show guests allowed info', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Guests Allowed')).toBeInTheDocument();
      });
    });

    it('should not show RSVP info when not required', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        requires_rsvp: false,
        allow_guests: false,
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Event Information')).toBeInTheDocument();
      });

      expect(screen.queryByText('RSVP Required')).not.toBeInTheDocument();
    });
  });

  describe('Non-Manager View', () => {
    it('should not show management buttons for non-managers', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /duplicate/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /check in members/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /cancel event/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible error alerts', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(makeApiError('Event not found', 404));

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
      });
    });

    it('should have accessible modal dialogs', async () => {
      mockCheckPermission.mockReturnValue(true);
      mockAuthState.checkPermission = mockCheckPermission;
      mockAuthState.user = { id: 'admin-1', permissions: ['events.manage'] } as CurrentUser;

      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open More dropdown, then cancel modal
      await user.click(screen.getByRole('button', { name: /more/i }));
      const firstCancelButton = screen.getAllByRole('button', { name: /cancel event/i })[0] ?? document.body;
      await user.click(firstCancelButton);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });

  describe('Custom Fields', () => {
    // `custom_fields` is shared between what a coordinator typed and what the
    // scheduled tasks write to remember what they have already sent. The
    // Event Details list dumped the whole column, so members opening an event
    // were shown "Validation Notification Sent: true" beside the description.
    const withCustomFields = (custom: Record<string, unknown>) => ({
      ...mockEvent,
      custom_fields: custom,
    });

    beforeEach(() => {
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
    });

    it('shows a field the coordinator entered', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(
        withCustomFields({ dress_code: 'Class B uniform' }) as unknown as Event
      );

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByText('Dress Code')).toBeInTheDocument();
      expect(screen.getByText('Class B uniform')).toBeInTheDocument();
    });

    it('shows training details when only training fields are present', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...withCustomFields({ course_name: 'Fire Behavior', credit_hours: 4, instructor: 'Alex Rivera' }),
        event_type: 'training',
      } as unknown as Event);

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByText('Training Session Details')).toBeInTheDocument();
      expect(screen.getByText('Fire Behavior')).toBeInTheDocument();
      expect(screen.getByText('4 hours')).toBeInTheDocument();
      expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    });

    it.each([
      ['validation_notification_sent', true],
      ['series_end_reminder_sent', true],
      ['reminders_sent', [24]],
    ])('hides the scheduler bookkeeping key %s', async (key, value) => {
      vi.mocked(eventService.getEvent).mockResolvedValue(
        withCustomFields({ [key]: value, dress_code: 'Class B uniform' }) as unknown as Event
      );

      renderWithRouter(<EventDetailPage />);

      // The visible field proves the block rendered at all.
      expect(await screen.findByText('Dress Code')).toBeInTheDocument();
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    });

    it('draws no card at all when only bookkeeping keys are present', async () => {
      // Otherwise every event the scheduler has touched carries an empty
      // purple "Training Session Details" box.
      vi.mocked(eventService.getEvent).mockResolvedValue(
        withCustomFields({ validation_notification_sent: true }) as unknown as Event
      );

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });
      expect(screen.queryByText('Training Session Details')).not.toBeInTheDocument();
    });
  });

  describe('Member-visible attendee list', () => {
    // Pitfall #28: vi.clearAllMocks() does not reset implementations, so this
    // block states every mock it depends on rather than inheriting whatever
    // the manager blocks above left configured.
    beforeEach(() => {
      vi.mocked(eventService.getEvent).mockReset();
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, going_count: 2 });
      vi.mocked(eventService.getEventAttendees).mockReset();
      vi.mocked(eventService.getEventAttendees).mockResolvedValue([
        { user_id: 'user-1', user_name: 'John Doe', status: 'going' },
        { user_id: 'user-2', user_name: 'Jane Smith', status: 'going' },
      ]);
      mockCheckPermission.mockReturnValue(false);
    });

    it('shows the going list to a member when the event shares it', async () => {
      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /who's going/i })).toBeInTheDocument();
    });

    it('renders nothing when the roster is not shared with members', async () => {
      // A 403 resolves to an empty list in the service, so the card is simply
      // absent — a member who may not see the list is not told there is one.
      vi.mocked(eventService.getEventAttendees).mockResolvedValue([]);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });
      expect(screen.queryByRole('heading', { name: /who's going/i })).not.toBeInTheDocument();
    });

    it('never renders contact details even if the payload carries them', async () => {
      // The API allowlists three fields and the type allows three, but the
      // component is the last line of that defence: a widened payload must
      // still not put an email address on a member's screen.
      vi.mocked(eventService.getEventAttendees).mockResolvedValue([
        {
          user_id: 'user-1',
          user_name: 'John Doe',
          status: 'going',
          user_email: 'john@example.com',
          notes: 'Peanut allergy',
        } as never,
      ]);

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByText('John Doe')).toBeInTheDocument();
      expect(screen.queryByText('john@example.com')).not.toBeInTheDocument();
      expect(screen.queryByText('Peanut allergy')).not.toBeInTheDocument();
    });

    it('does not fetch the member roster for a manager', async () => {
      // Managers get EventRSVPSection, which is strictly richer. Two rosters
      // on one page reads as a bug.
      mockCheckPermission.mockReturnValue(true);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });
      expect(eventService.getEventAttendees).not.toHaveBeenCalled();
    });
  });

  describe('Optional RSVP and waitlist standing', () => {
    beforeEach(() => {
      vi.mocked(eventService.getEvent).mockReset();
      vi.mocked(eventService.getEventAttendees).mockReset();
      vi.mocked(eventService.getEventAttendees).mockResolvedValue([]);
      mockCheckPermission.mockReturnValue(false);
    });

    it('offers an RSVP on an event that does not require one', async () => {
      // requires_rsvp means a response is expected, not that responses are
      // accepted. Gating the button on it left members with nothing to do on
      // the majority of events.
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        requires_rsvp: false,
        rsvp_deadline: undefined,
      });

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByRole('button', { name: /i'm coming/i })).toBeInTheDocument();
    });

    it('still refuses an RSVP on a cancelled event', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        requires_rsvp: false,
        is_cancelled: true,
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /i'm coming|rsvp now/i })).not.toBeInTheDocument();
    });

    it('tells a waitlisted member exactly where they stand', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        user_rsvp_status: 'waitlisted',
        user_waitlist_position: 2,
        waitlist_count: 5,
      });

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByText(/#2 of 5 on the waitlist/i)).toBeInTheDocument();
    });

    it('falls back to the vaguer sentence when no position came back', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        user_rsvp_status: 'waitlisted',
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/on the waitlist/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/#\d+ of/)).not.toBeInTheDocument();
    });

    it('opens the RSVP modal prefilled from the existing response', async () => {
      // Before this the form reset on every open, so "Update RSVP" came up
      // blank and submitting discarded the member's notes — and, once guests
      // consumed capacity, silently released the seats they were holding.
      const user = userEvent.setup();
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        user_rsvp_status: 'going',
        user_rsvp: {
          status: 'going',
          guest_count: 2,
          notes: 'Bringing the projector',
          dietary_restrictions: null,
          accessibility_needs: null,
        },
      });

      renderWithRouter(<EventDetailPage />);

      await user.click(await screen.findByRole('button', { name: /update rsvp/i }));

      expect(await screen.findByDisplayValue('Bringing the projector')).toBeInTheDocument();
      expect(screen.getByLabelText(/number of guests/i)).toHaveValue(2);
    });
  });
});
