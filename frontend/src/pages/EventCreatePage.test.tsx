import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
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
    createRecurringEvent: vi.fn(),
    getEvents: vi.fn().mockResolvedValue([]),
    getTemplates: vi.fn().mockResolvedValue([]),
    getVisibleEventTypes: vi.fn().mockResolvedValue([]),
    getVisibleEventTypesWithCategories: vi.fn().mockResolvedValue({
      visible_event_types: [],
      custom_event_categories: [],
      visible_custom_categories: [],
    }),
  },
  roleService: {
    getRoles: vi.fn().mockResolvedValue([]),
  },
  locationsService: {
    getLocations: vi.fn().mockResolvedValue([]),
  },
  // Behind EventForm's Training details section.
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

    it('should display back to events link', () => {
      renderWithRouter(<EventCreatePage />);

      const backLink = screen.getByRole('link', { name: /back to events/i });
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/events');
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
      fireEvent.change(startInput, { target: { value: '2026-04-01' } });

      const endInput = screen.getByLabelText(/end date & time/i);
      fireEvent.change(endInput, { target: { value: '2026-04-02' } });

      // Submit
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/events/new-event-1');
      });
    });

    it('should display error on failed creation', async () => {
      vi.mocked(eventService.createEvent).mockRejectedValue(makeApiError('Title is already taken', 400));

      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      // Fill required fields
      await user.type(screen.getByLabelText(/title/i), 'Duplicate Event');

      const startInput = screen.getByLabelText(/start date & time/i);
      fireEvent.change(startInput, { target: { value: '2026-04-01' } });

      const endInput = screen.getByLabelText(/end date & time/i);
      fireEvent.change(endInput, { target: { value: '2026-04-02' } });

      // Submit
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        // Error appears in both EventCreatePage and EventForm error displays
        const errors = screen.getAllByText('Title is already taken');
        expect(errors.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Validation errors from the server', () => {
    it('shows a 422 detail array as a message instead of crashing the page', async () => {
      // A 422 detail is an array of {field, message}; rendered directly as a
      // React child it threw, and the error boundary replaced the whole page.
      const error = Object.assign(new Error('Request failed with status code 422'), {
        response: {
          status: 422,
          data: {
            detail: [{ field: 'request', message: 'end_datetime must be after start_datetime' }],
            code: 'LB-VAL-001',
          },
        },
      });
      vi.mocked(eventService.createEvent).mockRejectedValue(error);

      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      await user.type(screen.getByLabelText(/title/i), 'Monthly Drill');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-02' } });
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        expect(screen.getAllByText(/end_datetime must be after start_datetime/).length).toBeGreaterThanOrEqual(1);
      });
      // The form survived: what the member typed is still there.
      expect(screen.getByLabelText(/title/i)).toHaveValue('Monthly Drill');
    });
  });

  describe('Training details', () => {
    // Pitfall #28: state every mock this block depends on, reset first.
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
      vi.mocked(eventService.createEvent).mockReset();
      vi.mocked(eventService.createEvent).mockResolvedValue({ id: 'evt-new' } as unknown as Event);
      vi.mocked(eventService.createRecurringEvent).mockReset();
      vi.mocked(eventService.createRecurringEvent).mockResolvedValue([{ id: 'evt-a' }] as unknown as Event[]);
    });

    const fillTrainingEvent = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText(/title/i), 'Ladder drill');
      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');
      await user.selectOptions(screen.getByLabelText('Training Type'), 'orientation');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-02' } });
    };

    it('passes the picked details through on a single event', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      await fillTrainingEvent(user);
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        expect(eventService.createEvent).toHaveBeenCalledWith(
          expect.objectContaining({ event_type: 'training', training_details: { training_type: 'orientation' } })
        );
      });
    });

    it('passes the picked details through on a recurring series', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      await fillTrainingEvent(user);
      await user.click(screen.getByLabelText('Make this a recurring event'));
      fireEvent.change(screen.getByLabelText('Series end date'), { target: { value: '2026-06-30' } });
      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        expect(eventService.createRecurringEvent).toHaveBeenCalledWith(
          expect.objectContaining({ event_type: 'training', training_details: { training_type: 'orientation' } })
        );
      });
      expect(eventService.createEvent).not.toHaveBeenCalled();
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
