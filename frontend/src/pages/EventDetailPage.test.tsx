import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { EventDetailPage } from './EventDetailPage';
import * as apiModule from '../services/api';
import * as authStoreModule from '../stores/authStore';
import type { Event, EventStats, RSVP } from '../types/event';

/** Create a mock API error object (not a Promise) */
function makeApiError(message: string, status = 400) {
  const error: any = new Error(message);
  error.response = { data: { detail: message }, status };
  return error;
}

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getEvent: vi.fn(),
    getEventRSVPs: vi.fn(),
    getEventStats: vi.fn(),
    getEligibleMembers: vi.fn(),
    createOrUpdateRSVP: vi.fn(),
    cancelEvent: vi.fn(),
    deleteEvent: vi.fn(),
    duplicateEvent: vi.fn(),
    checkInAttendee: vi.fn(),
    recordActualTimes: vi.fn(),
  },
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'evt-1' }),
  };
});

// Mock auth store
const mockCheckPermission = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));

const mockEvent: Event = {
  id: 'evt-1',
  organization_id: 'org-1',
  title: 'Monthly Business Meeting',
  description: 'Regular monthly meeting to discuss department updates.',
  event_type: 'business_meeting',
  location: 'Station 1 Conference Room',
  start_datetime: '2026-03-15T18:00:00Z',
  end_datetime: '2026-03-15T20:00:00Z',
  requires_rsvp: true,
  rsvp_deadline: '2026-03-14T18:00:00Z',
  max_attendees: 50,
  allowed_rsvp_statuses: ['going', 'not_going'],
  is_mandatory: false,
  allow_guests: true,
  send_reminders: true,
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
    vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
      checkPermission: mockCheckPermission,
      user: null,
    } as any);
  });

  describe('Loading State', () => {
    it('should display loading spinner initially', () => {
      vi.mocked(eventService.getEvent).mockImplementation(
        () => new Promise(() => {})
      );

      renderWithRouter(<EventDetailPage />);

      expect(screen.getByText('Loading event details...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error when event fails to load', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Event not found')).toBeInTheDocument();
      });
    });

    it('should show back to events button on error', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        const backButton = screen.getByRole('button', { name: /back to events/i });
        expect(backButton).toBeInTheDocument();
      });
    });

    it('should navigate to events on back button click', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

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
      vi.mocked(eventService.createOrUpdateRSVP).mockResolvedValue({} as any);

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
        expect(eventService.createOrUpdateRSVP).toHaveBeenCalledWith('evt-1', expect.objectContaining({
          status: 'going',
        }));
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
      vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
        checkPermission: mockCheckPermission,
        user: { id: 'admin-1', permissions: ['events.manage'] },
      } as any);
    });

    it('should show management buttons for managers', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue(mockRSVPs);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /check in members/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /record times/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel event/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
      });
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
      vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
        checkPermission: mockCheckPermission,
        user: { id: 'admin-1', permissions: ['events.manage'] },
      } as any);
    });

    it('should open and submit cancel modal', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.cancelEvent).mockResolvedValue({} as any);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      // Wait for page to load, then click the header "Cancel Event" button
      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Get the cancel button in the action buttons area (not in the modal)
      const cancelButtons = screen.getAllByRole('button', { name: /cancel event/i });
      await user.click(cancelButtons[0]);

      // Modal should be open
      await waitFor(() => {
        expect(screen.getByText('This action cannot be undone. The event will be marked as cancelled.')).toBeInTheDocument();
      });

      // Fill in reason
      const reasonInput = screen.getByPlaceholderText(/please provide a reason/i);
      await user.type(reasonInput, 'The venue is no longer available for this date');

      // Submit via the modal's submit button (type="submit")
      const submitButtons = screen.getAllByRole('button', { name: /cancel event/i });
      const modalSubmitButton = submitButtons.find(btn => btn.getAttribute('type') === 'submit');
      expect(modalSubmitButton).toBeDefined();
      await user.click(modalSubmitButton!);

      await waitFor(() => {
        expect(eventService.cancelEvent).toHaveBeenCalledWith('evt-1', expect.objectContaining({
          cancellation_reason: 'The venue is no longer available for this date',
          send_notifications: false,
        }));
      });
    });

    it('should include send_notifications when checkbox is checked', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);
      vi.mocked(eventService.cancelEvent).mockResolvedValue({} as any);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open cancel modal
      const cancelButtons = screen.getAllByRole('button', { name: /cancel event/i });
      await user.click(cancelButtons[0]);

      // Check the notifications checkbox
      const notifyCheckbox = screen.getByLabelText(/send cancellation notifications/i);
      await user.click(notifyCheckbox);

      // Fill in reason and submit
      const reasonInput = screen.getByPlaceholderText(/please provide a reason/i);
      await user.type(reasonInput, 'Weather emergency - event postponed');

      const submitButtons = screen.getAllByRole('button', { name: /cancel event/i });
      const modalSubmitButton = submitButtons.find(btn => btn.getAttribute('type') === 'submit');
      await user.click(modalSubmitButton!);

      await waitFor(() => {
        expect(eventService.cancelEvent).toHaveBeenCalledWith('evt-1', expect.objectContaining({
          send_notifications: true,
        }));
      });
    });
  });

  describe('Delete Event Modal', () => {
    beforeEach(() => {
      mockCheckPermission.mockReturnValue(true);
      vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
        checkPermission: mockCheckPermission,
        user: { id: 'admin-1', permissions: ['events.manage'] },
      } as any);
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

      const deleteButton = screen.getByRole('button', { name: /delete/i });
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
      vi.mocked(eventService.deleteEvent).mockResolvedValue(undefined as any);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open delete modal
      const deleteButton = screen.getByRole('button', { name: /delete/i });
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

      // Open delete modal
      const deleteButton = screen.getByRole('button', { name: /delete/i });
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
      vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
        checkPermission: mockCheckPermission,
        user: { id: 'admin-1', permissions: ['events.manage'] },
      } as any);
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

      const duplicateButton = screen.getByRole('button', { name: /duplicate/i });
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
      vi.mocked(eventService.duplicateEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      const duplicateButton = screen.getByRole('button', { name: /duplicate/i });
      await user.click(duplicateButton);

      await waitFor(() => {
        expect(toastModule.default.error).toHaveBeenCalledWith('Event not found');
      });
    });

    it('should not show duplicate button for non-managers', async () => {
      mockCheckPermission.mockReturnValue(false);
      vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
        checkPermission: mockCheckPermission,
        user: null,
      } as any);

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
        expect(screen.getByText('Max Attendees')).toBeInTheDocument();
        expect(screen.getByText('50')).toBeInTheDocument();
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
      vi.mocked(eventService.getEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
      });
    });

    it('should have accessible modal dialogs', async () => {
      mockCheckPermission.mockReturnValue(true);
      vi.mocked(authStoreModule.useAuthStore).mockReturnValue({
        checkPermission: mockCheckPermission,
        user: { id: 'admin-1', permissions: ['events.manage'] },
      } as any);

      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.getEventRSVPs).mockResolvedValue([]);
      vi.mocked(eventService.getEventStats).mockResolvedValue(mockStats);

      const user = userEvent.setup();
      renderWithRouter(<EventDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Open cancel modal
      const cancelButtons = screen.getAllByRole('button', { name: /cancel event/i });
      await user.click(cancelButtons[0]);

      await waitFor(() => {
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
      });
    });
  });
});
