import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { EventsPage } from './EventsPage';
import * as apiModule from '../services/api';
import type { EventListItem } from '../types/event';

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getEvents: vi.fn(),
    getVisibleEventTypes: vi.fn().mockResolvedValue([
      'business_meeting',
      'public_education',
      'training',
      'social',
      'fundraiser',
      'ceremony',
      'other',
    ]),
  },
}));

// Mock auth store with selector support
const mockAuthState: Record<string, unknown> = {
  checkPermission: vi.fn().mockReturnValue(false),
  user: null,
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

const mockEvents: EventListItem[] = [
  {
    id: 'evt-1',
    title: 'Monthly Business Meeting',
    event_type: 'business_meeting',
    start_datetime: '2026-03-15T18:00:00Z',
    end_datetime: '2026-03-15T20:00:00Z',
    location: 'Conference Room A',
    requires_rsvp: true,
    is_mandatory: false,
    is_cancelled: false,
    going_count: 15,
  },
  {
    id: 'evt-2',
    title: 'CPR Training',
    event_type: 'training',
    start_datetime: '2026-03-20T09:00:00Z',
    end_datetime: '2026-03-20T12:00:00Z',
    location: 'Station 1',
    requires_rsvp: true,
    is_mandatory: true,
    is_cancelled: false,
    going_count: 30,
  },
  {
    id: 'evt-3',
    title: 'Annual Fundraiser Gala',
    event_type: 'fundraiser',
    start_datetime: '2026-04-01T19:00:00Z',
    end_datetime: '2026-04-01T23:00:00Z',
    location: 'Banquet Hall',
    requires_rsvp: true,
    is_mandatory: false,
    is_cancelled: true,
    going_count: 50,
  },
];

describe('EventsPage', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.checkPermission = vi.fn().mockReturnValue(false);
    mockAuthState.user = null;
  });

  describe('Loading State', () => {
    it('should display loading spinner initially', () => {
      vi.mocked(eventService.getEvents).mockImplementation(
        () => new Promise(() => {})
      );

      renderWithRouter(<EventsPage />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message when API call fails', async () => {
      vi.mocked(eventService.getEvents).mockRejectedValue(new Error('Network error'));

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load events. Please try again later.')).toBeInTheDocument();
      });
    });

    it('should show try again button on error', async () => {
      vi.mocked(eventService.getEvents).mockRejectedValue(new Error('Network error'));

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        const retryButton = screen.getByRole('button', { name: /try again/i });
        expect(retryButton).toBeInTheDocument();
      });
    });

    it('should retry loading when try again is clicked', async () => {
      let callCount = 0;
      vi.mocked(eventService.getEvents).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('fail'));
        return Promise.resolve(mockEvents);
      });

      const user = userEvent.setup();
      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load events. Please try again later.')).toBeInTheDocument();
      });

      const retryButton = screen.getByRole('button', { name: /try again/i });
      await user.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });
    });
  });

  describe('Events List', () => {
    it('should display all events', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
        expect(screen.getByText('CPR Training')).toBeInTheDocument();
        expect(screen.getByText('Annual Fundraiser Gala')).toBeInTheDocument();
      });
    });

    it('should display event type badges', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        // Event type labels appear both as filter tabs and as badges on cards.
        // Verify at least 2 instances exist for types present in mockEvents
        // (one tab + one badge per type).
        expect(screen.getAllByText('Business Meeting').length).toBeGreaterThanOrEqual(2);
        expect(screen.getAllByText('Training').length).toBeGreaterThanOrEqual(2);
        expect(screen.getAllByText('Fundraiser').length).toBeGreaterThanOrEqual(2);
      });
    });

    it('should display mandatory badge for mandatory events', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Mandatory')).toBeInTheDocument();
      });
    });

    it('should display cancelled badge', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
      });
    });

    it('should display attending count for RSVP events', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('15 attending')).toBeInTheDocument();
        expect(screen.getByText('30 attending')).toBeInTheDocument();
      });
    });

    it('should show empty state when no events', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue([]);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('No events found')).toBeInTheDocument();
        expect(screen.getByText('Get started by creating a new event.')).toBeInTheDocument();
      });
    });

    it('should link each event to its detail page', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        const eventLinks = screen.getAllByRole('link');
        const eventDetailLinks = eventLinks.filter(link =>
          link.getAttribute('href')?.startsWith('/events/evt-')
        );
        expect(eventDetailLinks.length).toBe(3);
      });
    });
  });

  describe('Type Filter', () => {
    it('should show all filter tabs', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /all events/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /business meeting/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /training/i })).toBeInTheDocument();
      });
    });

    it('should filter by event type when tab is clicked', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      const user = userEvent.setup();
      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Click Training tab
      const trainingTab = screen.getByRole('button', { name: /^training$/i });
      await user.click(trainingTab);

      await waitFor(() => {
        expect(screen.getByText('CPR Training')).toBeInTheDocument();
        expect(screen.queryByText('Monthly Business Meeting')).not.toBeInTheDocument();
        expect(screen.queryByText('Annual Fundraiser Gala')).not.toBeInTheDocument();
      });
    });

    it('should show all events when All Events tab is clicked', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      const user = userEvent.setup();
      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Click training tab
      const trainingTab = screen.getByRole('button', { name: /^training$/i });
      await user.click(trainingTab);

      // Click all events tab
      const allTab = screen.getByRole('button', { name: /all events/i });
      await user.click(allTab);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
        expect(screen.getByText('CPR Training')).toBeInTheDocument();
        expect(screen.getByText('Annual Fundraiser Gala')).toBeInTheDocument();
      });
    });

    it('should show empty message for filtered type with no events', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      const user = userEvent.setup();
      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      // Click Social tab (no social events exist)
      const socialTab = screen.getByRole('button', { name: /social/i });
      await user.click(socialTab);

      await waitFor(() => {
        expect(screen.getByText('No events found')).toBeInTheDocument();
      });
    });
  });

  describe('Manager Actions', () => {
    it('should show Create Event button for managers', async () => {
      mockAuthState.checkPermission = vi.fn().mockReturnValue(true);
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        const createLink = screen.getByRole('link', { name: /create event/i });
        expect(createLink).toBeInTheDocument();
        expect(createLink).toHaveAttribute('href', '/events/new');
      });
    });

    it('should not show Create Event button for non-managers', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Business Meeting')).toBeInTheDocument();
      });

      expect(screen.queryByRole('link', { name: /create event/i })).not.toBeInTheDocument();
    });
  });

  describe('Page Header', () => {
    it('should display page title and description', async () => {
      vi.mocked(eventService.getEvents).mockResolvedValue(mockEvents);

      renderWithRouter(<EventsPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Events');
        expect(screen.getByText(/department events, meetings, training sessions/i)).toBeInTheDocument();
      });
    });
  });
});
