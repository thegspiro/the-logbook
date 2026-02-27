import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import EventEditPage from './EventEditPage';
import * as apiModule from '../services/api';
import type { Event } from '../types/event';

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
  },
  roleService: {
    getRoles: vi.fn().mockResolvedValue([]),
  },
  locationsService: {
    getLocations: vi.fn().mockResolvedValue([]),
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
  reminder_schedule: [24],
  is_cancelled: false,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-20T10:00:00Z',
};

describe('EventEditPage', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should display loading spinner while fetching event', () => {
      vi.mocked(eventService.getEvent).mockImplementation(
        () => new Promise(() => {})
      );

      renderWithRouter(<EventEditPage />);

      expect(screen.getByText('Loading event...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error when event fails to load', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByText('Event not found')).toBeInTheDocument();
      });
    });

    it('should show back to events link on error', async () => {
      vi.mocked(eventService.getEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

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

    it('should display breadcrumb with event title', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByText('Events')).toBeInTheDocument();
        expect(screen.getByText('Existing Event')).toBeInTheDocument();
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });
    });

    it('should pre-fill form with event data', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event');
      });
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
        expect(eventService.updateEvent).toHaveBeenCalledWith('evt-1', expect.objectContaining({
          title: 'Updated Event Title',
        }));
        expect(mockNavigate).toHaveBeenCalledWith('/events/evt-1');
      });
    });

    it('should display error on failed update', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);
      vi.mocked(eventService.updateEvent).mockRejectedValue(
        makeApiError('Location conflict', 409)
      );

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
      vi.mocked(eventService.getEvent).mockRejectedValue(
        makeApiError('Event not found', 404)
      );

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('should have proper breadcrumb navigation', async () => {
      vi.mocked(eventService.getEvent).mockResolvedValue(mockEvent);

      renderWithRouter(<EventEditPage />);

      await waitFor(() => {
        const breadcrumb = screen.getByRole('navigation', { name: /breadcrumb/i });
        expect(breadcrumb).toBeInTheDocument();
      });
    });
  });
});
