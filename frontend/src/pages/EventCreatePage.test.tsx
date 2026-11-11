import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  // Behind EventForm's organizer pickers.
  userService: {
    getUsers: vi.fn().mockResolvedValue([]),
  },
  locationsService: {
    getLocations: vi.fn().mockResolvedValue([]),
  },
  // Behind the training-event form's course choice.
  trainingService: {
    getCourses: vi.fn(),
  },
}));

// The rest of what the training-event form loads.
vi.mock('../hooks/useTrainingLinkageData', () => ({
  useTrainingLinkageData: () => ({ categories: [], requirements: [], programs: [], phases: [] }),
}));
vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

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
    // Rendered only as a tab of Events Administration, which owns the page's
    // one <h1> and names this tab in its section nav; the title stays as a
    // heading for screen-reader navigation.
    it('keeps a Create Event heading below the hub title', () => {
      renderWithRouter(<EventCreatePage />);

      expect(screen.getByRole('heading', { level: 2, name: 'Create Event' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    });

    // The hub's breadcrumb already leads back to Events.
    it('carries no back link of its own', () => {
      renderWithRouter(<EventCreatePage />);

      expect(screen.queryByRole('link', { name: /back to events/i })).not.toBeInTheDocument();
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

      // Once: the form reports its own failed save, as on the edit page.
      expect(await screen.findByText('Title is already taken')).toBeInTheDocument();
      expect(screen.getAllByText('Title is already taken')).toHaveLength(1);
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

  describe('Field errors (forms review F-2/F-4)', () => {
    it('puts a server refusal on the field it names, once, without the API field name', async () => {
      vi.mocked(eventService.createEvent).mockRejectedValue({
        response: { status: 422, data: { detail: [{ field: 'location', message: 'Value is too long.' }] } },
      });
      vi.mocked(apiModule.locationsService.getLocations).mockResolvedValue([]);
      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      await user.type(screen.getByLabelText(/title/i), 'Open House');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      fireEvent.change(screen.getByLabelText(/end date & time/i), { target: { value: '2026-04-02' } });
      await user.click(screen.getByRole('button', { name: /create event/i }));

      const location = screen.getByPlaceholderText('e.g., Station 1 Conference Room');
      await waitFor(() =>
        expect(location).toHaveAccessibleDescription('Location is too long — keep it to 300 characters.')
      );
      expect(location).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(location).toHaveFocus());
      expect(screen.queryByText(/location: Value is too long/)).not.toBeInTheDocument();
    });

    it('refuses an empty title on its field rather than with a browser bubble', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);
      await user.click(screen.getByRole('button', { name: /create event/i }));

      const title = screen.getByLabelText(/title/i);
      expect(title).toHaveAttribute('aria-invalid', 'true');
      expect(title).toHaveAccessibleDescription('Enter a title for the event.');
      expect(title).toHaveAttribute('aria-required', 'true');
      expect(eventService.createEvent).not.toHaveBeenCalled();
    });
  });

  // Training events are created in the step-by-step training form, which the
  // page's form hands off to (EventComposer.test.tsx covers the hand-off).
  describe('Training events', () => {
    // Pitfall #28: state every mock this block depends on, reset first.
    beforeEach(() => {
      vi.mocked(apiModule.trainingService.getCourses).mockReset();
      vi.mocked(apiModule.trainingService.getCourses).mockResolvedValue([]);
      vi.mocked(eventService.getVisibleEventTypesWithCategories).mockReset();
      vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue({
        visible_event_types: ['business_meeting', 'training'],
        custom_event_categories: [],
        visible_custom_categories: [],
      });
      vi.mocked(eventService.createEvent).mockReset();
      vi.mocked(eventService.createEvent).mockResolvedValue({ id: 'evt-new' } as unknown as Event);
    });

    it('creates a Training event through the training form, with its session', async () => {
      const user = userEvent.setup();
      renderWithRouter(<EventCreatePage />);

      await user.type(screen.getByLabelText(/title/i), 'Ladder drill');
      fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2026-04-01' } });
      await user.selectOptions(screen.getByLabelText(/event type/i), 'training');
      expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
      for (let step = 0; step < 3; step += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(screen.getByRole('button', { name: 'Create Event' }));

      await waitFor(() =>
        expect(eventService.createEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Ladder drill',
            event_type: 'training',
            training_details: expect.objectContaining({ training_type: 'continuing_education' }) as unknown,
          })
        )
      );
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/events/evt-new'));
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

describe('EventCreatePage starting from a template (workflow review W21)', () => {
  const { eventService } = apiModule;
  const template = {
    id: 'tpl-1',
    name: 'Monday Drill',
    event_type: 'business_meeting',
    default_title: 'Monday Night Drill',
    default_duration_minutes: 120,
    is_active: true,
    requires_rsvp: false,
    is_mandatory: false,
    allow_guests: false,
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 9:48 PM on 28 September in New York; 01:48 on the 29th in UTC.
    vi.setSystemTime(new Date('2026-09-29T01:48:00Z'));
    vi.mocked(eventService.getTemplates).mockReset();
    vi.mocked(eventService.getTemplates).mockResolvedValue([template] as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(eventService.getTemplates).mockReset();
    vi.mocked(eventService.getTemplates).mockResolvedValue([]);
  });

  const pickTemplate = async () => {
    renderWithRouter(<EventCreatePage />);
    const picker = await screen.findByRole('combobox', { name: 'Start from a template' });
    await screen.findByRole('option', { name: 'Monday Drill' });
    fireEvent.change(picker, { target: { value: 'tpl-1' } });
  };

  // The default start was the next hour on the browser's clock, not the
  // department's: in a browser whose offset differs by a part-hour (India,
  // UTC+5:30) it landed on the half hour. Run under TZ=Asia/Kolkata to see it.
  it("starts at the next hour on the department's clock", async () => {
    await pickTemplate();

    await waitFor(() => expect(screen.getByLabelText('Start Date & Time *')).toHaveValue('2026-09-28'));
    expect(screen.getByLabelText('Start time hour')).toHaveDisplayValue('10');
    expect(screen.getByLabelText('Start time minute')).toHaveDisplayValue('00');
    expect(screen.getByLabelText('Start time AM/PM')).toHaveDisplayValue('PM');
  });

  // Moving the start left the end on the old day, before the new start.
  it('carries the end with the start, keeping the length', async () => {
    await pickTemplate();
    await waitFor(() => expect(screen.getByLabelText('Start Date & Time *')).toHaveValue('2026-09-28'));

    fireEvent.change(screen.getByLabelText('Start Date & Time *'), { target: { value: '2026-10-12' } });

    expect(screen.getByLabelText('End Date & Time *')).toHaveValue('2026-10-13');
    expect(screen.getByLabelText('End time hour')).toHaveDisplayValue('12');
    expect(screen.getByLabelText('End time AM/PM')).toHaveDisplayValue('AM');
  });
});

describe('EventCreatePage templates', () => {
  const { eventService } = apiModule;
  const meeting = {
    id: 'tpl-meeting',
    name: 'Monthly Business Meeting',
    description: 'Second Tuesday, 7 PM',
    event_type: 'business_meeting',
    default_title: 'Monthly Business Meeting',
    default_duration_minutes: 90,
    is_active: true,
    requires_rsvp: false,
    is_mandatory: false,
    allow_guests: false,
  };
  const cpr = {
    id: 'tpl-cpr',
    name: 'CPR Renewal',
    description: 'Two-year recertification',
    event_type: 'training',
    default_title: 'CPR Renewal',
    default_duration_minutes: 240,
    is_active: true,
    requires_rsvp: false,
    is_mandatory: false,
    allow_guests: false,
  };

  // Pitfall #28: state every mock this block depends on, reset first.
  beforeEach(() => {
    vi.mocked(eventService.getTemplates).mockReset();
    vi.mocked(eventService.getTemplates).mockResolvedValue([meeting, cpr] as never);
    vi.mocked(eventService.createEvent).mockReset();
    vi.mocked(eventService.createEvent).mockResolvedValue({ id: 'evt-new' } as unknown as Event);
    vi.mocked(eventService.createRecurringEvent).mockReset();
    vi.mocked(eventService.createRecurringEvent).mockResolvedValue([{ id: 'evt-a' }] as unknown as Event[]);
    vi.mocked(eventService.getVisibleEventTypesWithCategories).mockReset();
    vi.mocked(eventService.getVisibleEventTypesWithCategories).mockResolvedValue({
      visible_event_types: ['business_meeting', 'training'],
      custom_event_categories: [],
      visible_custom_categories: [],
    });
    vi.mocked(apiModule.trainingService.getCourses).mockReset();
    vi.mocked(apiModule.trainingService.getCourses).mockResolvedValue([]);
    window.history.pushState({}, '', '/events/admin?tab=create');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
    vi.mocked(eventService.getTemplates).mockReset();
    vi.mocked(eventService.getTemplates).mockResolvedValue([]);
  });

  const picker = () => screen.findByRole('combobox', { name: 'Start from a template' });

  // The Events list's "Use template" sent ?template=<id>, and nothing read it:
  // the tab opened blank.
  it('starts from the template the link names', async () => {
    window.history.pushState({}, '', '/events/admin?tab=create&template=tpl-meeting');
    renderWithRouter(<EventCreatePage />);

    await waitFor(async () => expect(await picker()).toHaveValue('tpl-meeting'));
    expect(screen.getByLabelText(/title/i)).toHaveValue('Monthly Business Meeting');
  });

  it('starts blank when the link names a template that is not on offer', async () => {
    window.history.pushState({}, '', '/events/admin?tab=create&template=tpl-gone');
    renderWithRouter(<EventCreatePage />);

    await screen.findByRole('option', { name: /CPR Renewal/ });
    expect(await picker()).toHaveValue('');
    expect(screen.getByLabelText(/title/i)).toHaveValue('');
  });

  it('marks a Training template, and opens the training form from it', async () => {
    renderWithRouter(<EventCreatePage />);

    const option = await screen.findByRole('option', {
      name: 'CPR Renewal — Two-year recertification (Training)',
    });
    expect(await picker()).toHaveAccessibleDescription(
      'Pick a template to pre-fill common settings, or start blank. A Training template opens the step-by-step form.'
    );
    fireEvent.change(await picker(), { target: { value: (option as HTMLOptionElement).value } });

    expect(await screen.findByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('CPR Renewal');
    expect(screen.queryByText('Switched to the training form')).not.toBeInTheDocument();
  });

  // The page drew its own banner as well as the training form's.
  it("says once that a Training event's save failed", async () => {
    vi.mocked(eventService.createEvent).mockRejectedValue(new Error('Network Error'));
    window.history.pushState({}, '', '/events/admin?tab=create&template=tpl-cpr');
    const user = userEvent.setup();
    renderWithRouter(<EventCreatePage />);

    await screen.findByText('Step 1 of 4 · Event Details');
    for (let step = 0; step < 3; step += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create Event' }));

    expect(await screen.findByText('Failed to create event. Try again.')).toBeInTheDocument();
    expect(screen.getAllByText('Failed to create event. Try again.')).toHaveLength(1);
  });

  it('opens the training form from a link to a Training template', async () => {
    window.history.pushState({}, '', '/events/admin?tab=create&template=tpl-cpr');
    renderWithRouter(<EventCreatePage />);

    expect(await screen.findByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('CPR Renewal');
  });

  // RecurringEventCreate takes template_id; the page never sent it.
  it('records the template a series was created from', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/events/admin?tab=create&template=tpl-meeting');
    renderWithRouter(<EventCreatePage />);
    await waitFor(() => expect(screen.getByLabelText(/title/i)).toHaveValue('Monthly Business Meeting'));

    await user.click(screen.getByLabelText('Make this a recurring event'));
    fireEvent.change(screen.getByLabelText('Series end date'), { target: { value: '2027-06-30' } });
    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() =>
      expect(eventService.createRecurringEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Monthly Business Meeting', template_id: 'tpl-meeting' })
      )
    );
  });

  it('sends no template on a series started blank', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventCreatePage />);
    await screen.findByRole('option', { name: /CPR Renewal/ });

    await user.type(screen.getByLabelText(/title/i), 'Open house');
    fireEvent.change(screen.getByLabelText(/start date & time/i), { target: { value: '2027-04-01' } });
    await user.click(screen.getByLabelText('Make this a recurring event'));
    fireEvent.change(screen.getByLabelText('Series end date'), { target: { value: '2027-06-30' } });
    await user.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => expect(eventService.createRecurringEvent).toHaveBeenCalledTimes(1));
    expect(vi.mocked(eventService.createRecurringEvent).mock.calls[0]?.[0].template_id).toBeUndefined();
  });
});
