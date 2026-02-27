import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import EventCreatePage from './EventCreatePage';
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
    createEvent: vi.fn(),
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
  };
});

describe('EventCreatePage', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should display Create Event heading', () => {
      renderWithRouter(<EventCreatePage />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create Event');
    });

    it('should display breadcrumb navigation', () => {
      renderWithRouter(<EventCreatePage />);

      expect(screen.getByText('Events')).toBeInTheDocument();
      expect(screen.getByText('Create Event', { selector: 'li' })).toBeInTheDocument();
    });

    it('should display the EventForm component', () => {
      renderWithRouter(<EventCreatePage />);

      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument();
    });
  });

  describe('Form Submission', () => {
    it('should navigate to event detail on successful creation', async () => {
      vi.mocked(eventService.createEvent).mockResolvedValue({
        id: 'new-event-1',
        title: 'New Event',
      } as unknown as Event);

      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      // Fill required fields
      await user.type(screen.getByLabelText(/title/i), 'New Event');

      const startInput = screen.getByLabelText(/start date & time/i);
      await user.clear(startInput);
      await user.type(startInput, '2026-04-01T18:00');

      const endInput = screen.getByLabelText(/end date & time/i);
      await user.clear(endInput);
      await user.type(endInput, '2026-04-01T20:00');

      // Submit
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/events/new-event-1');
      });
    });

    it('should display error on failed creation', async () => {
      vi.mocked(eventService.createEvent).mockRejectedValue(
        makeApiError('Title is already taken', 400)
      );

      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      // Fill required fields
      await user.type(screen.getByLabelText(/title/i), 'Duplicate Event');

      const startInput = screen.getByLabelText(/start date & time/i);
      await user.clear(startInput);
      await user.type(startInput, '2026-04-01T18:00');

      const endInput = screen.getByLabelText(/end date & time/i);
      await user.clear(endInput);
      await user.type(endInput, '2026-04-01T20:00');

      // Submit
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        // Error appears in both EventCreatePage and EventForm error displays
        const errors = screen.getAllByText('Title is already taken');
        expect(errors.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Cancel Action', () => {
    it('should navigate back to events on cancel', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockNavigate).toHaveBeenCalledWith('/events');
    });
  });
});
