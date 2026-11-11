import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getUsers = vi.fn();
const getCourses = vi.fn();
const getLocations = vi.fn();
const getEvents = vi.fn();
const getVisibleEventTypesWithCategories = vi.fn();
const createEvent = vi.fn();
const createRecurringEvent = vi.fn();
const getMandatoryTiers = vi.fn();
const getTemplates = vi.fn();

vi.mock('../services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
  trainingService: { getCourses: (...args: unknown[]) => getCourses(...args) as unknown },
  trainingSessionService: {
    getMandatoryTiers: (...args: unknown[]) => getMandatoryTiers(...args) as unknown,
  },
  locationsService: { getLocations: (...args: unknown[]) => getLocations(...args) as unknown },
  eventService: {
    getEvents: (...args: unknown[]) => getEvents(...args) as unknown,
    getVisibleEventTypesWithCategories: (...args: unknown[]) => getVisibleEventTypesWithCategories(...args) as unknown,
    createEvent: (...args: unknown[]) => createEvent(...args) as unknown,
    createRecurringEvent: (...args: unknown[]) => createRecurringEvent(...args) as unknown,
    getTemplates: (...args: unknown[]) => getTemplates(...args) as unknown,
  },
}));

const linkageRequirements = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('../hooks/useTrainingLinkageData', () => ({
  useTrainingLinkageData: () => ({
    categories: [],
    requirements: linkageRequirements.value,
    programs: [],
    phases: [],
  }),
}));

vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

const tzState = vi.hoisted(() => ({ value: 'UTC' }));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => tzState.value }));

const permissions = vi.hoisted(() => ({ value: new Set<string>() }));
vi.mock('../stores/authStore', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string }; checkPermission: (permission: string) => boolean }) => unknown
  ) => selector({ user: { id: 'me' }, checkPermission: (permission: string) => permissions.value.has(permission) }),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: toastError },
}));

import CreateTrainingSessionPage from './CreateTrainingSessionPage';

type User = ReturnType<typeof userEvent.setup>;

const INSTRUCTOR_ID = '7d4c1f0e-0000-4000-8000-0000000000aa';
const RITA = { id: INSTRUCTOR_ID, username: 'rcole', first_name: 'Rita', last_name: 'Cole', status: 'active' };

// A course saved the way the setup guide's first step leaves it: a duration,
// and Credit Hours left blank.
const CPR = {
  id: 'course-cpr',
  organization_id: 'org',
  name: 'CPR / BLS',
  code: 'CPR',
  training_type: 'continuing_education',
  duration_hours: 4,
  is_active: true,
};

/** The API defaults every block starts from; each block resets and installs them (pitfall #28). */
function resetApi() {
  tzState.value = 'UTC';
  permissions.value = new Set(['events.manage', 'training.manage']);
  linkageRequirements.value = [];
  for (const mock of [
    getUsers,
    getCourses,
    getLocations,
    getEvents,
    getVisibleEventTypesWithCategories,
    createEvent,
    createRecurringEvent,
    getMandatoryTiers,
    getTemplates,
    navigate,
    toastError,
  ]) {
    mock.mockReset();
  }
  getUsers.mockResolvedValue([]);
  getCourses.mockResolvedValue([]);
  getLocations.mockResolvedValue([]);
  getEvents.mockResolvedValue([]);
  getVisibleEventTypesWithCategories.mockResolvedValue({
    visible_event_types: ['training'],
    custom_event_categories: [],
    visible_custom_categories: [],
    membership_types: [{ value: 'active', label: 'Active Member' }],
  });
  createEvent.mockResolvedValue({ id: 'event-1' });
  createRecurringEvent.mockResolvedValue([{ id: 'event-1' }, { id: 'event-2' }]);
  getMandatoryTiers.mockResolvedValue({ everyone: false, tier_ids: [], unmapped: [] });
  getTemplates.mockResolvedValue([]);
}

/** Title and a start date; the end follows two hours later. */
async function fillEventDetails(user: User, title = 'Ladder Drill') {
  await user.type(screen.getByLabelText(/^Title/), title);
  await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
}

const next = (user: User) => user.click(screen.getByRole('button', { name: 'Next' }));

/** From the Training Info step to the Review step. */
async function toReview(user: User) {
  await next(user); // to Settings
  await next(user); // to Review
}

const submit = (user: User) =>
  user.click(screen.getByRole('button', { name: /^Create (Training Session|Recurring Sessions)$/ }));

const sentEvent = () =>
  createEvent.mock.calls[0]?.[0] as Record<string, unknown> & { training_details: Record<string, unknown> };

describe('CreateTrainingSessionPage permission', () => {
  beforeEach(resetApi);

  // The hub opens for training.manage, but every save goes through the events
  // endpoints, which need events.manage: the old form opened and then 403'd.
  it('tells a training manager without events.manage who creates sessions, instead of the form', () => {
    permissions.value = new Set(['training.manage']);
    renderWithRouter(<CreateTrainingSessionPage />);

    expect(screen.getByRole('heading', { name: 'Create Training Session' })).toBeInTheDocument();
    expect(screen.getByText('Creating a training session needs the Manage all events permission')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('opens the form for an event manager', async () => {
    renderWithRouter(<CreateTrainingSessionPage />);

    expect(screen.getByRole('heading', { name: 'Create Training Session' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    await waitFor(() => expect(getEvents).toHaveBeenCalledTimes(1));
  });
});

// Training Admin gains the Events page's templates, Training ones only.
describe('CreateTrainingSessionPage templates', () => {
  const template = (id: string, name: string, event_type: string, extra: Record<string, unknown> = {}) => ({
    id,
    organization_id: 'org',
    name,
    event_type,
    default_title: name,
    default_duration_minutes: 120,
    requires_rsvp: false,
    is_mandatory: false,
    allow_guests: false,
    require_checkout: false,
    send_reminders: true,
    reminder_target: 'going',
    reminder_schedule: [24],
    is_active: true,
    created_at: '',
    updated_at: '',
    ...extra,
  });

  beforeEach(() => {
    resetApi();
    getTemplates.mockResolvedValue([
      template('tpl-drill', 'Company Drill', 'training', { default_description: 'Weekly training drill' }),
      template('tpl-meeting', 'Business Meeting', 'business_meeting'),
      template('tpl-old', 'Old Drill', 'training', { is_active: false }),
    ]);
  });

  it('offers the active Training templates, first, and fills the form from one', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    const picker = await screen.findByRole('combobox', { name: 'Start from a template' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['— No template —', 'Company Drill']);
    expect(picker).toHaveAccessibleDescription(
      "Training templates only. A template fills the event's own fields, replacing what is already typed."
    );
    await user.selectOptions(picker, 'tpl-drill');

    expect(screen.getByLabelText(/^Title/)).toHaveValue('Company Drill');
    expect(screen.getByLabelText(/^Description/)).toHaveValue('Weekly training drill');
    expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
  });

  it('records the template a series was created from', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Start from a template' }), 'tpl-drill');
    await user.click(screen.getByRole('checkbox', { name: /Make this a recurring event/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Rolling 12-month cycle' }));
    await next(user);
    await toReview(user);
    await submit(user);

    await waitFor(() => expect(createRecurringEvent).toHaveBeenCalledTimes(1));
    expect(createRecurringEvent).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'tpl-drill' }));
  });
});

describe('CreateTrainingSessionPage event details step', () => {
  beforeEach(resetApi);

  it('fixes the type to Training and names the event fields', async () => {
    getLocations.mockResolvedValue([{ id: 'loc-1', name: 'Station 1', is_active: true }]);
    renderWithRouter(<CreateTrainingSessionPage />);

    expect(screen.queryByRole('combobox', { name: /Event Type/ })).not.toBeInTheDocument();
    expect(screen.getByText('Set by Training Admin. Other event types use the Events page.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveAccessibleDescription(
      'Becomes the event title, and the course name when no course is chosen.'
    );
    expect(screen.getByLabelText(/^Description/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Location/, { selector: 'select' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Additional Directions/)).toBeInTheDocument();
  });

  // The location label pointed at the select's id, so with no saved locations
  // the text box drawn in its place had no name.
  it('names the location box when the department has no saved locations', async () => {
    renderWithRouter(<CreateTrainingSessionPage />);

    expect(await screen.findByLabelText(/^Location/, { selector: 'input' })).toHaveAttribute(
      'id',
      'location-text-fallback'
    );
  });

  // The Training Admin wizard had none of these; the Events form had them all.
  it('offers the organizer, a rolling series and dates to skip', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    expect(await screen.findByLabelText(/^Organizer/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Make this a recurring event/ }));
    expect(screen.getByLabelText('Date to skip')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Rolling 12-month cycle' }));
    expect(
      screen.getByText(/Each new occurrence copies the training details and attendance links/)
    ).toBeInTheDocument();
  });

  // Workflow review, training events: a 7 PM start with a 6 PM end went through
  // all four steps and was refused only by the server on the last click. The
  // refusal is now under the field, not a toast.
  it('keeps the officer on the first step when the end is before the start', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByLabelText(/^Title/), 'Ladder Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.selectOptions(screen.getByLabelText('Start time hour'), '7');
    await user.selectOptions(screen.getByLabelText('Start time AM/PM'), 'PM');
    await user.selectOptions(screen.getByLabelText('End time hour'), '6');
    await user.selectOptions(screen.getByLabelText('End time AM/PM'), 'PM');
    await next(user);

    expect(screen.getByLabelText(/End Date & Time/)).toHaveAccessibleDescription('End must be after the start.');
    expect(screen.getByLabelText(/End Date & Time/)).toHaveFocus();
    expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('names the building once in the location list', async () => {
    // A facility room's location is named "Room — Facility" by the backend
    // and carries that facility as its building.
    getLocations.mockResolvedValue([
      {
        id: 'room-1',
        name: 'Volunteer Office — Station 1 - Headquarters',
        building: 'Station 1 - Headquarters',
        room_number: '107',
        is_active: true,
      },
      { id: 'loc-2', name: 'Training Room', building: 'Annex', is_active: true },
    ]);
    renderWithRouter(<CreateTrainingSessionPage />);

    const select = await screen.findByLabelText(/^Location/, { selector: 'select' });
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBeGreaterThan(2));
    const labels = Array.from((select as HTMLSelectElement).options).map((option) => option.text);
    expect(labels).toContain('Volunteer Office — Station 1 - Headquarters');
    expect(labels).toContain('Training Room (Annex)');
  });
});

describe('CreateTrainingSessionPage training info step', () => {
  beforeEach(() => {
    resetApi();
    getCourses.mockResolvedValue([CPR]);
    getUsers.mockResolvedValue([RITA]);
  });

  // The course is optional (owner decision, 2026-11-10). The wizard used to
  // open on the library choice whenever the department had courses.
  it('starts on No course yet, with type, instructor and hours offered', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);

    expect(screen.getByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /No course yet \(filed under the event title\)/ })).toBeChecked();
    expect(screen.getByText(/filed under “Ladder Drill”/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Training Type/)).toHaveValue('continuing_education');
    expect(screen.getByLabelText(/Lead Instructor/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Course/ })).not.toBeInTheDocument();
  });

  // Workflow review W80-13: the hint said attendees are credited these hours;
  // finalize credits the time each one actually attended.
  it('follows the event length until the hours are typed, and says what credit is', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);

    const hours = screen.getByLabelText(/Credit Hours/);
    expect(hours).toHaveValue(2);
    expect(hours).toHaveAccessibleDescription(
      /Follows the event's length \(2 hours\) until you change it\. Each attendee is credited with the time they actually attended/
    );
    await user.clear(hours);
    await user.type(hours, '1.5');
    expect(hours).toHaveValue(1.5);
    expect(hours).not.toHaveAccessibleDescription(/Follows the event's length/);
  });

  it('refuses Next from the library with no course chosen, under the course field', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await next(user);

    const course = screen.getByRole('combobox', { name: /^Course/ });
    expect(course).toHaveAccessibleDescription('Choose a course from the Course Library.');
    expect(course).toHaveFocus();
    expect(screen.getByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('refuses a one-off course with no name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await next(user);

    expect(screen.getByLabelText(/Course Name/)).toHaveAccessibleDescription('Enter a course name.');
  });

  it('fills from a library course, crediting its duration when it has no credit hours', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await screen.findByRole('option', { name: 'CPR - CPR / BLS' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Course/ }), 'course-cpr');

    expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(4);
    expect(screen.getByLabelText(/Credit Hours/)).toHaveAccessibleDescription(/^From the course \(4 hours\)\./);
  });

  // A course's instructor is free text; it is picked as a member only when a
  // member has that name, and otherwise kept as the name it is.
  it("keeps a course's instructor as text when no member has that name", async () => {
    getCourses.mockResolvedValue([{ ...CPR, instructor: 'AHA Regional Faculty' }]);
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await screen.findByRole('option', { name: 'CPR - CPR / BLS' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Course/ }), 'course-cpr');

    const instructor = screen.getByLabelText(/Lead Instructor/);
    expect(instructor).toHaveValue('');
    expect(instructor).toHaveAccessibleDescription('From the course: AHA Regional Faculty, not a member');
  });

  it("picks the member a course's instructor names", async () => {
    getCourses.mockResolvedValue([{ ...CPR, instructor: 'Rita Cole' }]);
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await screen.findByRole('option', { name: 'CPR - CPR / BLS' });
    await waitFor(() =>
      expect(within(screen.getByLabelText(/Lead Instructor/)).getByRole('option', { name: 'Rita Cole' })).toBeVisible()
    );
    await user.selectOptions(screen.getByRole('combobox', { name: /^Course/ }), 'course-cpr');

    expect(screen.getByLabelText(/Lead Instructor/)).toHaveValue(INSTRUCTOR_ID);
  });

  it('offers only session-attendance requirements under Counts toward attendance', async () => {
    linkageRequirements.value = [
      { id: 'req-drills', name: 'Company drills', requirement_type: 'session_attendance', required_attendance_pct: 60 },
      { id: 'req-hours', name: 'Annual hours', requirement_type: 'hours' },
    ];
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);

    const group = screen.getByRole('group', { name: 'Counts toward attendance' });
    expect(within(group).getByRole('checkbox', { name: /Company drills/ })).toBeInTheDocument();
    expect(within(group).queryByRole('checkbox', { name: /Annual hours/ })).not.toBeInTheDocument();
    expect(group).toHaveAccessibleDescription(/It does not make attending mandatory/);
  });
});

describe('CreateTrainingSessionPage saving', () => {
  beforeEach(() => {
    resetApi();
    getUsers.mockResolvedValue([RITA]);
    getCourses.mockResolvedValue([CPR]);
  });

  // The wizard used to post to /training/sessions with RSVP on, a 15-minute
  // check-in window and manual check-out; it now saves through /events with the
  // Events form's defaults, and always attaches the session.
  it('creates a Training event with no course, filed under its title, and opens it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await toReview(user);
    await submit(user);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    const payload = sentEvent();
    expect(payload).toMatchObject({
      title: 'Ladder Drill',
      event_type: 'training',
      start_datetime: '2030-05-01T09:00:00.000Z',
      end_datetime: '2030-05-01T11:00:00.000Z',
      requires_rsvp: false,
      check_in_minutes_before: 60,
      require_checkout: false,
    });
    expect(payload.training_details).toEqual({
      training_type: 'continuing_education',
      credit_hours: 2,
      issues_certification: false,
      counts_toward_certification: true,
      auto_create_records: true,
      require_completion_confirmation: false,
      attendance_requirement_ids: [],
    });
    expect(navigate).toHaveBeenCalledWith('/events/event-1');
  });

  // The page kept the picked member's id locally and sent only their name,
  // so the backend's instructor qualification checks never had a member to check.
  it('sends the picked member as instructor_id alongside the name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    const instructor = screen.getByLabelText(/Lead Instructor/);
    await waitFor(() => expect(within(instructor).getByRole('option', { name: 'Rita Cole' })).toBeInTheDocument());
    await user.selectOptions(instructor, 'Rita Cole');
    await toReview(user);
    expect(screen.getByText('Rita Cole', { selector: 'dd' })).toBeInTheDocument();
    await submit(user);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(sentEvent().training_details).toMatchObject({ instructor: 'Rita Cole', instructor_id: INSTRUCTOR_ID });
  });

  it('omits the instructor when none is picked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await toReview(user);
    await submit(user);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(sentEvent().training_details.instructor_id).toBeUndefined();
    expect(sentEvent().training_details.instructor).toBeUndefined();
  });

  it("files under a library course, crediting the course's hours", async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await screen.findByRole('option', { name: 'CPR - CPR / BLS' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Course/ }), 'course-cpr');
    await toReview(user);
    expect(screen.getByText('4 hours (from the course)')).toBeInTheDocument();
    await submit(user);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(sentEvent().training_details).toMatchObject({ course_id: 'course-cpr', credit_hours: 4 });
    // A library course and a one-off name are refused together.
    expect(sentEvent().training_details.course_name).toBeUndefined();
  });

  it('lets the officer change the hours for a library course', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await screen.findByRole('option', { name: 'CPR - CPR / BLS' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Course/ }), 'course-cpr');
    const hours = screen.getByLabelText(/Credit Hours/);
    await user.clear(hours);
    await user.type(hours, '3');
    await toReview(user);
    await submit(user);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(sentEvent().training_details).toMatchObject({ course_id: 'course-cpr', credit_hours: 3 });
  });

  it('files under a one-off course name, leaving the library out', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await user.type(screen.getByLabelText(/Course Name/), 'Ladder Operations');
    await user.type(screen.getByLabelText(/Course Code/), 'LAD-1');
    await toReview(user);
    await submit(user);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(sentEvent().training_details).toMatchObject({ course_name: 'Ladder Operations', course_code: 'LAD-1' });
    expect(sentEvent().training_details.course_id).toBeUndefined();
  });

  it('sends the ticked attendance requirements with the new session', async () => {
    linkageRequirements.value = [
      { id: 'req-drills', name: 'Company drills', requirement_type: 'session_attendance', required_attendance_pct: 60 },
    ];
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: /Company drills/ }));
    await toReview(user);
    await submit(user);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(sentEvent().training_details).toMatchObject({ attendance_requirement_ids: ['req-drills'] });
  });

  // Training details on a rolling series were refused until #4231, and the
  // wizard offered no rolling series at all.
  it('creates a rolling series with the session on every occurrence, and opens the first', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await user.click(screen.getByRole('checkbox', { name: /Make this a recurring event/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Rolling 12-month cycle' }));
    await next(user);
    await toReview(user);
    expect(screen.getByText('Rolling 12-month cycle', { selector: 'dd' })).toBeInTheDocument();
    await submit(user);

    await waitFor(() => expect(createRecurringEvent).toHaveBeenCalledTimes(1));
    const series = createRecurringEvent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(series).toMatchObject({
      event_type: 'training',
      recurrence_pattern: 'weekly',
      rolling_recurrence: true,
      training_details: { training_type: 'continuing_education', credit_hours: 2 },
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/events/event-1');
  });

  // A 422 lands under the field it names, on that field's step, not in a toast.
  it('puts a refused training field under its field, back on Training Info', async () => {
    createEvent.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [{ field: 'training_details.course_name', message: 'String should have at most 255 characters' }],
        },
      },
    });
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await user.type(screen.getByLabelText(/Course Name/), 'Ladder Operations');
    await toReview(user);
    await submit(user);

    expect(await screen.findByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
    expect(screen.getByLabelText(/Course Name/)).toHaveAccessibleDescription(
      /Course name is too long — keep it to 255 characters\./
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('shows a failure that names no field on the Review step', async () => {
    createEvent.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await toReview(user);
    await submit(user);

    expect(await screen.findByText('Failed to create event. Try again.')).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Training Session' })).toBeEnabled();
  });
});

describe('CreateTrainingSessionPage review step', () => {
  beforeEach(() => {
    resetApi();
    getCourses.mockResolvedValue([CPR]);
  });

  // The review used to format the form's local wall-clock string as UTC, so in
  // Chicago a 7 PM class read as 2 PM while the save itself was right.
  it('reviews the times as entered, in the department timezone, with readable values', async () => {
    tzState.value = 'America/Chicago';
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await user.type(screen.getByLabelText(/^Title/), 'CPR recert night');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.selectOptions(screen.getByLabelText('Start time hour'), '7');
    await user.selectOptions(screen.getByLabelText('Start time minute'), '00');
    await user.selectOptions(screen.getByLabelText('Start time AM/PM'), 'PM');
    await user.selectOptions(screen.getByLabelText('End time hour'), '11');
    await user.selectOptions(screen.getByLabelText('End time minute'), '00');
    await user.selectOptions(screen.getByLabelText('End time AM/PM'), 'PM');
    await next(user);
    await user.click(screen.getByRole('radio', { name: /From the Course Library/ }));
    await screen.findByRole('option', { name: 'CPR - CPR / BLS' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^Course/ }), 'course-cpr');
    await toReview(user);

    expect(screen.getByText(/7:00\s?PM/)).toBeInTheDocument();
    expect(screen.getByText(/11:00\s?PM/)).toBeInTheDocument();
    expect(screen.queryByText(/2:00\s?PM/)).not.toBeInTheDocument();
    expect(screen.getByText('CPR - CPR / BLS (Course Library)')).toBeInTheDocument();
    expect(screen.getByText('Continuing Education')).toBeInTheDocument();
    expect(screen.getByText('CPR recert night')).toBeInTheDocument();
  });

  // Workflow review W80-12: the ticked requirements were saved but the review
  // step did not list them, so the officer confirmed without seeing them.
  it('lists the ticked attendance requirements', async () => {
    linkageRequirements.value = [
      { id: 'req-drills', name: 'Company drills', requirement_type: 'session_attendance', required_attendance_pct: 60 },
    ];
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user, 'Company Drill');
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: /Company drills/ }));
    await toReview(user);

    expect(screen.getByText('Counts toward attendance', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('Company drills (60%)')).toBeInTheDocument();
  });

  it('goes back to the step a section is set on', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await next(user);
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Edit Training Details' }));

    expect(screen.getByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
  });
});

describe('CreateTrainingSessionPage mandatory pre-fill', () => {
  const DRILLS = {
    id: 'req-drills',
    name: 'Company Drill Attendance',
    requirement_type: 'session_attendance',
    required_attendance_pct: 60,
  };
  const ADMIN_DRILLS = {
    id: 'req-admin',
    name: 'Administrative Drill Attendance',
    requirement_type: 'session_attendance',
    required_attendance_pct: 25,
  };
  const ADMIN_UNMAPPED = {
    requirement_id: 'req-admin',
    name: 'Administrative Drill Attendance',
    reason: 'Administrative is a member class, not a membership tier',
  };

  beforeEach(() => {
    resetApi();
    linkageRequirements.value = [DRILLS, ADMIN_DRILLS];
    getVisibleEventTypesWithCategories.mockResolvedValue({
      visible_event_types: ['training'],
      custom_event_categories: [],
      visible_custom_categories: [],
      membership_types: [
        { value: 'probationary', label: 'Probationary' },
        { value: 'active', label: 'Active Member' },
        { value: 'senior', label: 'Senior Member' },
      ],
    });
    getMandatoryTiers.mockImplementation((ids: string[]) =>
      Promise.resolve(
        ids.includes('req-drills')
          ? {
              everyone: false,
              tier_ids: ['probationary', 'active'],
              unmapped: ids.includes('req-admin') ? [ADMIN_UNMAPPED] : [],
            }
          : { everyone: false, tier_ids: [], unmapped: [ADMIN_UNMAPPED] }
      )
    );
  });

  /** Event Details filled, on Training Info. */
  async function toTrainingInfo(user: User) {
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user, 'Monday Night Drill');
    await next(user);
  }
  const tick = (user: User, name: RegExp) => user.click(screen.getByRole('checkbox', { name }));
  const memberType = (name: string) => screen.getByRole('checkbox', { name });

  it('fills Mandatory for from the ticked requirements once Mandatory is ticked, naming what it could not map', async () => {
    const user = userEvent.setup();
    await toTrainingInfo(user);
    await tick(user, /Company Drill Attendance/);
    await tick(user, /Administrative Drill Attendance/);
    await waitFor(() => expect(getMandatoryTiers).toHaveBeenLastCalledWith(['req-drills', 'req-admin']));
    await next(user);

    // Counting toward a percentage does not make attending mandatory.
    expect(screen.getByRole('checkbox', { name: 'Mandatory attendance' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Mandatory attendance' }));

    expect(screen.getByRole('radio', { name: 'Only these member types' })).toBeChecked();
    expect(memberType('Probationary')).toBeChecked();
    expect(memberType('Active Member')).toBeChecked();
    expect(memberType('Senior Member')).not.toBeChecked();
    expect(screen.getByText('Pre-filled from Counts toward attendance')).toBeInTheDocument();
    expect(screen.getByText('Company Drill Attendance → Probationary, Active Member.')).toBeInTheDocument();
    expect(screen.getByText(/Administrative is a member class, not a membership tier/)).toBeInTheDocument();

    await next(user);
    await submit(user);
    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(sentEvent()).toMatchObject({ is_mandatory: true, mandatory_membership_types: ['probationary', 'active'] });
  });

  it('writes straight into Mandatory for when Mandatory is already on', async () => {
    const user = userEvent.setup();
    await toTrainingInfo(user);
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: 'Mandatory attendance' }));
    expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await tick(user, /Company Drill Attendance/);
    await waitFor(() => expect(getMandatoryTiers).toHaveBeenCalledTimes(1));
    await next(user);

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Only these member types' })).toBeChecked());
    expect(memberType('Probationary')).toBeChecked();
    expect(memberType('Active Member')).toBeChecked();
  });

  it('chooses All members for a requirement that applies to every member', async () => {
    getMandatoryTiers.mockResolvedValue({ everyone: true, tier_ids: [], unmapped: [] });
    const user = userEvent.setup();
    await toTrainingInfo(user);
    await tick(user, /Company Drill Attendance/);
    await waitFor(() => expect(getMandatoryTiers).toHaveBeenCalledTimes(1));
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: 'Mandatory attendance' }));

    expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked();
    expect(screen.getByText('Company Drill Attendance → All members.')).toBeInTheDocument();
  });

  it('leaves Mandatory for as it was when no ticked requirement maps, and says why', async () => {
    const user = userEvent.setup();
    await toTrainingInfo(user);
    await tick(user, /Administrative Drill Attendance/);
    await waitFor(() => expect(getMandatoryTiers).toHaveBeenCalledWith(['req-admin']));
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: 'Mandatory attendance' }));

    expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked();
    expect(screen.getByText('Not pre-filled from Counts toward attendance')).toBeInTheDocument();
    expect(screen.getByText(/Administrative is a member class, not a membership tier/)).toBeInTheDocument();
    expect(screen.getByText(/All members is selected\. Choose member types instead/)).toBeInTheDocument();
  });

  it("does not overwrite the officer's own choice", async () => {
    const user = userEvent.setup();
    await toTrainingInfo(user);
    await tick(user, /Company Drill Attendance/);
    await waitFor(() => expect(getMandatoryTiers).toHaveBeenCalledTimes(1));
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: 'Mandatory attendance' }));
    await user.click(memberType('Active Member'));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await tick(user, /Administrative Drill Attendance/);
    await tick(user, /Company Drill Attendance/);
    await tick(user, /Company Drill Attendance/);
    await next(user);

    expect(getMandatoryTiers).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'Only these member types' })).toBeChecked();
    expect(memberType('Probationary')).toBeChecked();
    expect(memberType('Active Member')).not.toBeChecked();
  });

  it('leaves both fields alone when every requirement is unticked', async () => {
    const user = userEvent.setup();
    await toTrainingInfo(user);
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: 'Mandatory attendance' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await tick(user, /Company Drill Attendance/);
    await waitFor(() => expect(getMandatoryTiers).toHaveBeenCalledTimes(1));
    await tick(user, /Company Drill Attendance/);
    await next(user);

    expect(getMandatoryTiers).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('checkbox', { name: 'Mandatory attendance' })).toBeChecked();
    expect(memberType('Probationary')).toBeChecked();
    expect(memberType('Active Member')).toBeChecked();
    expect(screen.queryByText('Pre-filled from Counts toward attendance')).not.toBeInTheDocument();
  });

  it('applies only the latest answer when two arrive out of order', async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    getMandatoryTiers
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce({ everyone: true, tier_ids: [], unmapped: [] });
    const user = userEvent.setup();
    await toTrainingInfo(user);
    await tick(user, /Company Drill Attendance/);
    await tick(user, /Administrative Drill Attendance/);
    await waitFor(() => expect(getMandatoryTiers).toHaveBeenCalledTimes(2));
    releaseFirst({ everyone: false, tier_ids: ['senior'], unmapped: [] });
    await next(user);
    await user.click(screen.getByRole('checkbox', { name: 'Mandatory attendance' }));

    expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked();
  });
});
