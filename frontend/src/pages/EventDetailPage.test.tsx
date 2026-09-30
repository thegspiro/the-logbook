import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import toast from 'react-hot-toast';
import { EventDetailPage } from './EventDetailPage';
import { electionService } from '../services/electionService';
import { applicantService } from '../modules/prospective-members/services/api';
import * as apiModule from '../services/api';
import type { Event, EventStats, RSVP } from '../types/event';
import type { CurrentUser } from '../types/auth';
import type { TrainingSessionResponse } from '../services/api';

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
    endEvent: vi.fn(),
  },
}));

// The card is tested on its own. Here it only reports a session, the way the
// real one does once its fetch settles, and records the props the page gives it.
const mockCardProps = vi.fn();
let mockReportedSession: Partial<TrainingSessionResponse> | null = null;
vi.mock('../components/event-detail/TrainingSessionLinkageCard', async () => {
  const { useEffect } = await import('react');
  const MockTrainingSessionLinkageCard = (props: { onSessionChange?: (session: unknown) => void }) => {
    mockCardProps(props);
    const { onSessionChange } = props;
    useEffect(() => {
      onSessionChange?.(mockReportedSession);
    }, [onSessionChange]);
    return null;
  };
  return { default: MockTrainingSessionLinkageCard };
});

// Neither is under test here. Left real, each sends a live request whose
// failure ends in the auth redirect, which jsdom reports as "Not implemented:
// navigation to another Document" in the middle of unrelated tests.
vi.mock('../services/electionService', () => ({
  electionService: { getElectionsByEvent: vi.fn() },
}));
vi.mock('../modules/prospective-members/services/api', () => ({
  applicantService: { getApplicants: vi.fn() },
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
    mockReportedSession = null;
    mockCardProps.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockAuthState.checkPermission = mockCheckPermission;
    mockAuthState.user = null;
    // A sane default for every block. vi.clearAllMocks() drops
    // implementations but not the mock itself, so without this the member
    // roster fetch resolves undefined in blocks that never mention it.
    vi.mocked(eventService.getEventAttendees).mockResolvedValue([]);
    vi.mocked(electionService.getElectionsByEvent).mockReset();
    vi.mocked(electionService.getElectionsByEvent).mockResolvedValue([]);
    vi.mocked(applicantService.getApplicants).mockReset();
    vi.mocked(applicantService.getApplicants).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      total_pages: 0,
    });
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
      });

      // Open the More dropdown, then click Cancel Event
      await user.click(screen.getByRole('button', { name: /more/i }));
      const firstCancelButton = screen.getAllByRole('button', { name: /cancel event/i })[0] ?? document.body;
      await user.click(firstCancelButton);

      // Modal should be open
      await waitFor(() => {
        expect(screen.getByText("The event will be marked Cancelled. You can't undo this.")).toBeInTheDocument();
      });

      // Fill in reason
      const reasonInput = screen.getByPlaceholderText(/why is this event being cancelled/i);
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
      });

      // Open More dropdown, then cancel modal
      await user.click(screen.getByRole('button', { name: /more/i }));
      const firstCancelBtn = screen.getAllByRole('button', { name: /cancel event/i })[0] ?? document.body;
      await user.click(firstCancelBtn);

      // Check the notifications checkbox
      const notifyCheckbox = screen.getByLabelText(/notify members who rsvp'd going or maybe/i);
      await user.click(notifyCheckbox);

      // Fill in reason and submit
      const reasonInput = screen.getByPlaceholderText(/why is this event being cancelled/i);
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
      });

      // Open More dropdown then click Delete Event
      await user.click(screen.getByRole('button', { name: /more/i }));
      const deleteButton = screen.getByRole('button', { name: /delete event/i });
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByText('Delete Event')).toBeInTheDocument();
        expect(
          screen.getByText(/permanently delete .*its rsvps and attendance records are deleted too/i)
        ).toBeInTheDocument();
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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

    it('should close delete modal on Keep Event', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
      });

      // Open More dropdown then Delete Event
      await user.click(screen.getByRole('button', { name: /more/i }));
      const deleteButton = screen.getByRole('button', { name: /delete event/i });
      await user.click(deleteButton);

      // Click Keep Event
      await waitFor(async () => {
        const keepButton = screen.getByRole('button', { name: /keep event/i });
        await user.click(keepButton);
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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

    describe('once the card reports a training session', () => {
      const trainingEvent = (custom: Record<string, unknown>) =>
        ({ ...withCustomFields(custom), event_type: 'training' }) as unknown as Event;

      it('leaves course, type and hours to the card, which shows them live', async () => {
        mockReportedSession = { id: 'sess-1', require_completion_confirmation: false };
        vi.mocked(eventService.getEvent).mockResolvedValue(
          trainingEvent({
            course_name: 'Fire Behavior',
            course_code: 'FB-1',
            credit_hours: 4,
            training_type: 'skills_practice',
            instructor: 'Alex Rivera',
          })
        );

        renderWithRouter(<EventDetailPage />);

        expect(await screen.findByText('Alex Rivera')).toBeInTheDocument();
        // Drawn until the card's fetch settles and reports the session.
        await waitFor(() => expect(screen.queryByText('Fire Behavior')).not.toBeInTheDocument());
        expect(screen.queryByText('FB-1')).not.toBeInTheDocument();
        expect(screen.queryByText('4 hours')).not.toBeInTheDocument();
        expect(screen.queryByText('Training Type')).not.toBeInTheDocument();
      });

      it('draws no card when those were the only training fields', async () => {
        mockReportedSession = { id: 'sess-1', require_completion_confirmation: false };
        vi.mocked(eventService.getEvent).mockResolvedValue(
          trainingEvent({ course_name: 'Fire Behavior', credit_hours: 4 })
        );

        renderWithRouter(<EventDetailPage />);

        await waitFor(() => expect(mockCardProps).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('Training Session Details')).not.toBeInTheDocument());
        expect(screen.queryByText('Fire Behavior')).not.toBeInTheDocument();
      });

      it('says credit is written at finalize, after approval when the session needs it', async () => {
        mockReportedSession = { id: 'sess-1', require_completion_confirmation: true };
        vi.mocked(eventService.getEvent).mockResolvedValue(trainingEvent({ auto_create_records: true }));

        renderWithRouter(<EventDetailPage />);

        expect(
          await screen.findByText(
            "Credited to members' training records when attendance is finalized after a training officer approves"
          )
        ).toBeInTheDocument();
        expect(screen.queryByText(/automatically created when members check in/)).not.toBeInTheDocument();
      });

      it('says credit is written at finalize when no approval is needed', async () => {
        vi.mocked(eventService.getEvent).mockResolvedValue(trainingEvent({ auto_create_records: true }));

        renderWithRouter(<EventDetailPage />);

        expect(
          await screen.findByText("Credited to members' training records when attendance is finalized")
        ).toBeInTheDocument();
      });
    });

    it('draws no card at all when only bookkeeping keys are present', async () => {
      // Otherwise every event the scheduler has touched carries an empty
      // purple "Training Session Details" box.
      vi.mocked(eventService.getEvent).mockResolvedValue(
        withCustomFields({ validation_notification_sent: true }) as unknown as Event
      );

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
      });
      expect(screen.queryByText('Training Session Details')).not.toBeInTheDocument();
    });
  });

  describe('Training events', () => {
    // Pitfall #28: this block states every mock it depends on.
    const pastTraining: Event = {
      ...mockEvent,
      title: 'Hose drill',
      event_type: 'training',
      start_datetime: '2025-04-15T18:00:00Z',
      end_datetime: '2025-04-15T20:00:00Z',
    };

    beforeEach(() => {
      mockCheckPermission.mockReset();
      mockCheckPermission.mockReturnValue(true);
      mockAuthState.checkPermission = mockCheckPermission;
      mockAuthState.user = { id: 'admin-1', permissions: ['events.manage'] } as CurrentUser;
      vi.mocked(eventService.getEvent).mockReset();
      vi.mocked(eventService.getEvent).mockResolvedValue(pastTraining);
      vi.mocked(eventService.getEventRSVPs).mockReset();
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockReset();
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.finalizeAttendance).mockReset();
      vi.mocked(eventService.endEvent).mockReset();
      vi.mocked(eventService.recordActualTimes).mockReset();
    });

    const finalizeWith = async (result: Awaited<ReturnType<typeof eventService.finalizeAttendance>>) => {
      vi.mocked(eventService.finalizeAttendance).mockResolvedValue(result);
      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);
      await user.click(await screen.findByRole('button', { name: 'Finalize Attendance' }));
      await user.click(await screen.findByRole('button', { name: /finalize and close/i }));
      await waitFor(() => expect(eventService.finalizeAttendance).toHaveBeenCalledWith('evt-1'));
    };

    it('gives the card what it needs to describe the event', async () => {
      mockCheckPermission.mockImplementation((perm: string) => perm === 'training.manage');
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...pastTraining,
        attendance_finalized_at: '2025-04-15T20:30:00Z',
      });

      renderWithRouter(<EventDetailPage />);

      await waitFor(() =>
        expect(mockCardProps).toHaveBeenLastCalledWith(
          expect.objectContaining({
            eventId: 'evt-1',
            eventTitle: 'Hose drill',
            canManage: false,
            canApprove: true,
            attendanceFinalized: true,
            refreshKey: 0,
          })
        )
      );
    });

    it('states how finalizing credits a Training event before it does so', async () => {
      mockReportedSession = { id: 'sess-1', require_completion_confirmation: true };
      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await user.click(await screen.findByRole('button', { name: 'Finalize Attendance' }));

      expect(
        await screen.findByText(/writes a training record for each checked-in member with time to credit/)
      ).toBeInTheDocument();
      expect(screen.getByText(/comes from Edit Times first, then a real check-out or End Event/)).toBeInTheDocument();
      expect(
        screen.getByText('Members with no credited time get no training record, so set their times first.')
      ).toBeInTheDocument();
      expect(screen.getByText(/Credit waits for a training officer's approval/)).toBeInTheDocument();
      expect(screen.getByText('Earlier admin-hours entries for this event are removed.')).toBeInTheDocument();
    });

    it('does not mention an approval the session does not need', async () => {
      mockReportedSession = { id: 'sess-1', require_completion_confirmation: false };
      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await user.click(await screen.findByRole('button', { name: 'Finalize Attendance' }));

      expect(
        await screen.findByText(/writes a training record for each checked-in member with time to credit/)
      ).toBeInTheDocument();
      expect(screen.queryByText(/Credit waits for a training officer's approval/)).not.toBeInTheDocument();
    });

    it('reports the records completed and the admin-hours entries removed', async () => {
      await finalizeWith({
        updated_count: 3,
        training_credit: true,
        training_records_completed: 3,
        training_approval_pending: false,
        training_attendees_uncredited: 0,
        training_uncredited_names: [],
        admin_hours_entries_removed: 2,
      });

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          'Attendance finalized. 3 training records completed. 2 admin-hours entries removed'
        )
      );
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('reports credit waiting on a training officer', async () => {
      await finalizeWith({
        updated_count: 4,
        training_credit: true,
        training_records_completed: 0,
        training_approval_pending: true,
        training_attendees_pending: 4,
      });

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          'Attendance finalized. Waiting for training officer approval (4 members)'
        )
      );
    });

    it('names the members who got no record, as an error', async () => {
      await finalizeWith({
        updated_count: 3,
        training_credit: true,
        training_records_completed: 1,
        training_attendees_uncredited: 2,
        training_uncredited_names: ['Sam Lee', 'Ana Ortiz'],
      });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'No time to credit for: Sam Lee, Ana Ortiz — set their times, then reopen and finalize again',
          expect.objectContaining({ duration: expect.any(Number) as unknown })
        )
      );
      expect(toast.success).toHaveBeenCalledWith('Attendance finalized. 1 training record completed');
    });

    it('counts the rest rather than naming a long list', async () => {
      const names = ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six', 'G Seven'];
      await finalizeWith({
        updated_count: 7,
        training_credit: true,
        training_attendees_uncredited: 7,
        training_uncredited_names: names,
      });

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'No time to credit for: A One, B Two, C Three, D Four, E Five and 2 more — set their times, then reopen and finalize again',
          expect.anything()
        )
      );
    });

    it('keeps the member count for an event that credits no training', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...pastTraining, event_type: 'business_meeting' });
      await finalizeWith({ updated_count: 2, training_credit: false });

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Attendance finalized for 2 members'));
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('has the card refetch after a finalize', async () => {
      await finalizeWith({ updated_count: 1, training_credit: true, training_records_completed: 1 });

      await waitFor(() => expect(mockCardProps).toHaveBeenLastCalledWith(expect.objectContaining({ refreshKey: 1 })));
    });

    describe('End Event', () => {
      const ongoingTraining: Event = { ...pastTraining, end_datetime: '2099-04-15T20:00:00Z' };

      const endWith = async (result: Awaited<ReturnType<typeof eventService.endEvent>>) => {
        vi.mocked(eventService.getEvent).mockResolvedValue(ongoingTraining);
        vi.mocked(eventService.endEvent).mockResolvedValue(result);
        const user = userEvent.setup();
        renderWithRouter(<EventDetailPage />);
        await user.click(await screen.findByRole('button', { name: 'End Event' }));
        await user.click(await screen.findByRole('button', { name: 'End Event Now' }));
        await waitFor(() => expect(eventService.endEvent).toHaveBeenCalledWith('evt-1'));
      };

      it('reports the training credit alongside the check-outs', async () => {
        await endWith({
          checked_out_count: 2,
          actual_end_time: '2026-09-29T20:00:00Z',
          training_credit: true,
          training_records_completed: 2,
          training_attendees_uncredited: 1,
          training_uncredited_names: ['Sam Lee'],
        });

        await waitFor(() =>
          expect(toast.success).toHaveBeenCalledWith(
            'Event ended — 2 members checked out. 2 training records completed'
          )
        );
        expect(toast.error).toHaveBeenCalledWith(
          'No time to credit for: Sam Lee — set their times, then reopen and finalize again',
          expect.anything()
        );
        await waitFor(() => expect(mockCardProps).toHaveBeenLastCalledWith(expect.objectContaining({ refreshKey: 1 })));
      });

      it('keeps the plain wording when no training is credited', async () => {
        await endWith({ checked_out_count: 1, actual_end_time: '2026-09-29T20:00:00Z', training_credit: false });

        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Event ended — 1 member checked out'));
      });
    });

    describe('Record Times', () => {
      const saveTimes = async () => {
        const user = userEvent.setup();
        renderWithRouter(<EventDetailPage />);
        await user.click(await screen.findByRole('button', { name: /more/i }));
        await user.click(screen.getByRole('button', { name: /record times/i }));
        await user.click(screen.getByRole('button', { name: 'Save Times' }));
        await waitFor(() => expect(eventService.recordActualTimes).toHaveBeenCalled());
      };

      it('warns when an end time was saved but attendance stayed open', async () => {
        vi.mocked(eventService.recordActualTimes).mockResolvedValue({ ...pastTraining, attendance_finalized_at: null });

        await saveTimes();

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(
            'Times recorded, but attendance could not be finalized. Try Finalize Attendance.'
          )
        );
        await waitFor(() => expect(mockCardProps).toHaveBeenLastCalledWith(expect.objectContaining({ refreshKey: 1 })));
      });

      it('stays quiet when the end time finalized attendance', async () => {
        vi.mocked(eventService.recordActualTimes).mockResolvedValue({
          ...pastTraining,
          attendance_finalized_at: '2025-04-15T20:30:00Z',
        });

        await saveTimes();

        await waitFor(() => expect(eventService.getEvent).toHaveBeenCalledTimes(2));
        expect(toast.error).not.toHaveBeenCalled();
      });
    });

    describe('once attendance is finalized', () => {
      beforeEach(() => {
        vi.mocked(eventService.getEvent).mockResolvedValue({
          ...pastTraining,
          attendance_finalized_at: '2025-04-15T20:30:00Z',
          attendance_finalized_by_name: 'Pat Ramirez',
        });
      });

      it('describes the lock in training terms', async () => {
        renderWithRouter(<EventDetailPage />);

        expect(
          await screen.findByText(
            /training records are written from this attendance, and attendance can no longer be changed/
          )
        ).toBeInTheDocument();
        expect(screen.getByText(/Use Reopen Attendance to correct times or training details/)).toBeInTheDocument();
      });

      it('says what a reopen does to the training records and the approval', async () => {
        const user = userEvent.setup();
        renderWithRouter(<EventDetailPage />);

        await user.click(await screen.findByRole('button', { name: /reopen attendance/i }));

        expect(
          await screen.findByText(/updates the training records already written rather than adding to them/)
        ).toBeInTheDocument();
        expect(screen.getByText(/finalizing again issues a new one/)).toBeInTheDocument();
      });
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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

    it('hides the card when the roster genuinely fails to load', async () => {
      // getEventAttendees already turns 403/404 into an empty list, so a
      // rejection here is a real failure. Rendering an empty roster for one
      // would tell the member nobody is coming, which is a wrong answer rather
      // than a safe one.
      vi.mocked(eventService.getEventAttendees).mockRejectedValue(new Error('network'));

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
      });
      expect(screen.queryByRole('heading', { name: /who's going/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/nobody yet/i)).not.toBeInTheDocument();
    });

    it('refreshes the roster after the member responds', async () => {
      // fetchAttendees otherwise runs only on mount, so a member who joined
      // stayed absent from the list they were looking at until a reload.
      const user = userEvent.setup();
      vi.mocked(eventService.createOrUpdateRSVP).mockResolvedValue({ status: 'going' } as never);

      renderWithRouter(<EventDetailPage />);

      await user.click(await screen.findByRole('button', { name: /rsvp now|i'm coming/i }));
      await user.click(await screen.findByRole('button', { name: /submit rsvp/i }));

      await waitFor(() => {
        expect(eventService.getEventAttendees).toHaveBeenCalledTimes(2);
      });
    });

    it('does not fetch the member roster for a manager', async () => {
      // Managers get EventRSVPSection, which is strictly richer. Two rosters
      // on one page reads as a bug.
      mockCheckPermission.mockReturnValue(true);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Monthly Business Meeting');
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

    it('tells a party too large for the event the truth, not a promise', async () => {
      // Promotion passes such a party over, so "you'll be moved up
      // automatically" is a promise the server will never keep. Arises when an
      // organizer lowers the cap below a party that had already queued.
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        user_rsvp_status: 'waitlisted',
        user_waitlist_exceeds_capacity: true,
      });

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByText(/larger than this event can hold/i)).toBeInTheDocument();
      expect(screen.queryByText(/automatically moved/i)).not.toBeInTheDocument();
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
        },
      });

      renderWithRouter(<EventDetailPage />);

      await user.click(await screen.findByRole('button', { name: /update rsvp/i }));

      expect(await screen.findByDisplayValue('Bringing the projector')).toBeInTheDocument();
      expect(screen.getByLabelText(/number of guests/i)).toHaveValue(2);
    });

    it('opens a waitlisted member on Going rather than an unselectable status', async () => {
      // `waitlisted` is server-generated and absent from allowed_rsvp_statuses,
      // so seeding it left no radio selected and submitting was rejected as a
      // disallowed status. A waitlisted member is queued *for* going.
      const user = userEvent.setup();
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        user_rsvp_status: 'waitlisted',
        user_rsvp: { status: 'waitlisted', guest_count: 1, notes: null },
      });

      renderWithRouter(<EventDetailPage />);

      await user.click(await screen.findByRole('button', { name: /update rsvp/i }));

      // Exact name: /going/i would also match "Not Going".
      const going = await screen.findByRole('radio', { name: 'Going' });
      expect(going).toBeChecked();
      expect(screen.getByLabelText(/number of guests/i)).toHaveValue(1);
    });
  });

  describe('the event organizer', () => {
    const organizedEvent: Event = { ...mockEvent, created_by: 'organizer-1', created_by_name: 'Sam Ortiz' };

    // mockReset, not the file-level vi.clearAllMocks: clearAllMocks drops
    // recorded calls but not implementations, and nested blocks in this file
    // install mockImplementation on mockCheckPermission. Without the reset,
    // whichever of these two ran second would inherit the other's answer and
    // pass for the wrong reason.
    beforeEach(() => {
      mockCheckPermission.mockReset();
      mockCheckPermission.mockReturnValue(false);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
    });

    it('names the organizer for a manager', async () => {
      mockCheckPermission.mockImplementation((p: string) => p === 'events.manage');
      vi.mocked(eventService.getEvent).mockResolvedValue(organizedEvent);

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByText('Organized by')).toBeInTheDocument();
      expect(screen.getByText('Sam Ortiz')).toBeInTheDocument();
    });

    it('shows nothing to a member who cannot finalize', async () => {
      // The server withholds created_by_name from this caller, so the realistic
      // payload has no name at all. Asserted anyway: the point is that a member
      // is never told who organized the event, whichever layer withheld it.
      vi.mocked(eventService.getEvent).mockResolvedValue(organizedEvent);

      renderWithRouter(<EventDetailPage />);

      await screen.findByRole('heading', { level: 1, name: mockEvent.title });
      expect(screen.queryByText('Organized by')).not.toBeInTheDocument();
      expect(screen.queryByText('Sam Ortiz')).not.toBeInTheDocument();
    });

    it('renders nothing when no organizer is recorded', async () => {
      // An event predating the column, or one whose organizer has left the
      // department. An "Unknown" row would read as a data error.
      mockCheckPermission.mockImplementation((p: string) => p === 'events.manage');
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, created_by_name: null });

      renderWithRouter(<EventDetailPage />);

      await screen.findByRole('heading', { level: 1, name: mockEvent.title });
      expect(screen.queryByText('Organized by')).not.toBeInTheDocument();
    });
  });

  describe('Event Information card', () => {
    // A member: no stats, so nothing else on the page draws capacity.
    beforeEach(() => {
      vi.mocked(eventService.getEventStats).mockReset();
      vi.mocked(eventService.getEventRSVPs).mockReset();
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
    });

    it('is not drawn when the event has nothing for it to say', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        requires_rsvp: false,
        rsvp_deadline: undefined,
        max_attendees: undefined,
        allow_guests: false,
      });

      renderWithRouter(<EventDetailPage />);

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('heading', { name: 'Event Information' })).not.toBeInTheDocument();
    });

    // The RSVP path waitlists past the cap whether or not a response is
    // required, so the capacity that explains a waitlist has to show too.
    it('shows capacity on a capped event that does not require an RSVP', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        requires_rsvp: false,
        rsvp_deadline: undefined,
        max_attendees: 3,
        occupied_seats: 3,
        allow_guests: false,
      });

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByRole('heading', { name: 'Event Information' })).toBeInTheDocument();
      expect(screen.getByText('Capacity')).toBeInTheDocument();
      expect(screen.getByText('3 / 3 spots filled')).toBeInTheDocument();
      expect(screen.getByText('Event Full')).toBeInTheDocument();
      expect(screen.queryByText('RSVP Required')).not.toBeInTheDocument();
    });

    it('leaves capacity to the Statistics card when that card shows it', async () => {
      mockCheckPermission.mockReturnValue(true);
      mockAuthState.user = { id: 'admin-1', permissions: ['events.manage'] } as CurrentUser;
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await screen.findByRole('heading', { name: 'Statistics' });
      expect(screen.getAllByText('Capacity')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Event Information' })).toBeInTheDocument();
      expect(screen.getByText('RSVP Required')).toBeInTheDocument();
    });
  });

  describe('Calendar and check-in QR actions', () => {
    const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

    beforeEach(() => {
      vi.mocked(eventService.getEvent).mockReset();
      vi.mocked(eventService.getEventRSVPs).mockReset();
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockReset();
    });

    it('offers both on an upcoming event', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({ ...mockEvent, check_in_closes_at: mockEvent.end_datetime });

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByRole('button', { name: /Add to Calendar/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /View QR Code/ })).toBeInTheDocument();
    });

    it('offers neither once the event is over and check-in has closed', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        start_datetime: '2020-04-15T18:00:00Z',
        end_datetime: '2020-04-15T20:00:00Z',
        rsvp_deadline: undefined,
        check_in_closes_at: '2020-04-15T20:00:00Z',
      });

      renderWithRouter(<EventDetailPage />);

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('button', { name: /Add to Calendar/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /View QR Code/ })).not.toBeInTheDocument();
    });

    // A "window" event keeps accepting check-ins after its scheduled end, so
    // the QR code outlives the calendar button until the backend's close.
    it('keeps the QR code while check-in is still open past the scheduled end', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        start_datetime: minutesFromNow(-120),
        end_datetime: minutesFromNow(-5),
        rsvp_deadline: undefined,
        check_in_window_type: 'window',
        check_in_minutes_after: 15,
        check_in_closes_at: minutesFromNow(10),
      });

      renderWithRouter(<EventDetailPage />);

      expect(await screen.findByRole('button', { name: /View QR Code/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add to Calendar/ })).not.toBeInTheDocument();
    });

    it('hides the QR code once attendance is finalized', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue({
        ...mockEvent,
        check_in_closes_at: mockEvent.end_datetime,
        attendance_finalized_at: '2026-01-21T10:00:00Z',
      });

      renderWithRouter(<EventDetailPage />);

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('button', { name: /View QR Code/ })).not.toBeInTheDocument();
    });
  });
});
