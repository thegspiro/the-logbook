import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getUsers = vi.fn();
const getCourses = vi.fn();
const getLocations = vi.fn();
const createSession = vi.fn();
const getBasicApparatus = vi.fn();

vi.mock('../services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
  trainingService: { getCourses: (...args: unknown[]) => getCourses(...args) as unknown },
  locationsService: { getLocations: (...args: unknown[]) => getLocations(...args) as unknown },
  trainingSessionService: {
    createSession: (...args: unknown[]) => createSession(...args) as unknown,
    createRecurringSessions: vi.fn(),
  },
}));

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: { getBasicApparatus: (...args: unknown[]) => getBasicApparatus(...args) as unknown },
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

vi.mock('../components/training/TrainingLinkageFields', () => ({ TrainingLinkageFields: () => null }));

vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

const tzState = vi.hoisted(() => ({ value: 'UTC' }));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => tzState.value }));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: toastError },
}));

import CreateTrainingSessionPage from './CreateTrainingSessionPage';

const INSTRUCTOR_ID = '7d4c1f0e-0000-4000-8000-0000000000aa';

describe('CreateTrainingSessionPage lead instructor', () => {
  beforeEach(() => {
    getUsers.mockReset();
    getUsers.mockResolvedValue([
      { id: INSTRUCTOR_ID, username: 'rcole', first_name: 'Rita', last_name: 'Cole', status: 'active' },
    ]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([]);
    getLocations.mockReset();
    getLocations.mockResolvedValue([]);
    getBasicApparatus.mockReset();
    getBasicApparatus.mockResolvedValue([]);
    createSession.mockReset();
    createSession.mockResolvedValue({ id: 'session-1', event_id: 'event-1' });
    linkageRequirements.value = [];
  });

  // The page kept the picked member's id locally and sent only their name,
  // so the backend's instructor qualification checks never had a member to check.
  it('sends the picked member as instructor_id alongside the name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Ladder Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-02');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED for Healthcare Providers'), 'Ladder Operations');
    const instructor = screen.getByDisplayValue('Select instructor...');
    await waitFor(() => expect(within(instructor).getByRole('option', { name: 'Rita Cole' })).toBeInTheDocument());
    await user.selectOptions(instructor, 'Rita Cole');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ instructor: 'Rita Cole', instructor_id: INSTRUCTOR_ID })
    );
  });

  it('omits instructor_id when no lead instructor is picked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Ladder Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-02');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByPlaceholderText('e.g., CPR/AED for Healthcare Providers'), 'Ladder Operations');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    const payload = createSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.instructor_id).toBeUndefined();
    expect(payload.instructor).toBeUndefined();
  });

  // The apparatus picker was never sent, so a choice made there was silently
  // dropped; it was removed rather than left to imply something is recorded.
  it('offers no apparatus picker and does not load the apparatus list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Ladder Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-02');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByDisplayValue('Select instructor...')).toBeInTheDocument();
    expect(screen.queryByText('No apparatus')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Apparatus/)).not.toBeInTheDocument();
    expect(getBasicApparatus).not.toHaveBeenCalled();
  });
});

// A course saved the way the setup guide's first step leaves it: a duration,
// and Credit Hours left blank.
const CPR = {
  id: 'course-cpr',
  organization_id: 'org',
  name: 'CPR / BLS',
  training_type: 'continuing_education',
  duration_hours: 4,
  is_active: true,
};

describe('CreateTrainingSessionPage with a course from the library', () => {
  beforeEach(() => {
    tzState.value = 'UTC';
    toastError.mockReset();
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([CPR]);
    getLocations.mockReset();
    getLocations.mockResolvedValue([]);
    getBasicApparatus.mockReset();
    getBasicApparatus.mockResolvedValue([]);
    createSession.mockReset();
    createSession.mockResolvedValue({ id: 'session-1', event_id: 'event-1' });
  });

  async function fillEventDetails(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Training Title/), 'CPR recert night');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.selectOptions(screen.getByLabelText('Start time hour'), '7');
    await user.selectOptions(screen.getByLabelText('Start time minute'), '00');
    await user.selectOptions(screen.getByLabelText('Start time AM/PM'), 'PM');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-01');
    await user.selectOptions(screen.getByLabelText('End time hour'), '11');
    await user.selectOptions(screen.getByLabelText('End time minute'), '00');
    await user.selectOptions(screen.getByLabelText('End time AM/PM'), 'PM');
    await user.click(screen.getByRole('button', { name: 'Next' }));
  }

  it('starts on the library choice when the department has courses', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);

    expect(screen.getByRole('radio', { name: 'Use a course from the Course Library' })).toBeChecked();
    expect(screen.getByLabelText(/Select Course/)).toBeInTheDocument();
  });

  it("credits the course's duration when it has no credit hours, and shows it", async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);

    await screen.findByRole('option', { name: 'CPR / BLS' });
    await user.selectOptions(screen.getByLabelText(/Select Course/), 'course-cpr');
    expect(screen.getByLabelText(/Credit Hours/)).toHaveValue(4);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('4 hours')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ course_id: 'course-cpr', credit_hours: 4, use_existing_course: true })
    );
  });

  it('lets the officer change the hours for a library course', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);

    await screen.findByRole('option', { name: 'CPR / BLS' });
    await user.selectOptions(screen.getByLabelText(/Select Course/), 'course-cpr');
    const hours = screen.getByLabelText(/Credit Hours/);
    await user.clear(hours);
    await user.type(hours, '3');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ credit_hours: 3 }));
  });

  it('refuses to create from the library with no course chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    expect(toastError).toHaveBeenCalledWith('Back to Training Info: fix the flagged field');
    expect(await screen.findByText('Choose a course from the Course Library')).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  // The review used to format the form's local wall-clock string as UTC, so in
  // Chicago a 7 PM class read as 2 PM while the save itself was right.
  it('reviews the times as entered, in the department timezone, with readable values', async () => {
    tzState.value = 'America/Chicago';
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillEventDetails(user);
    await screen.findByRole('option', { name: 'CPR / BLS' });
    await user.selectOptions(screen.getByLabelText(/Select Course/), 'course-cpr');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Each value sits beside its label; the times are unique on the review.
    expect(screen.getByText(/7:00\s?PM/)).toBeInTheDocument();
    expect(screen.getByText(/11:00\s?PM/)).toBeInTheDocument();
    expect(screen.queryByText(/2:00\s?PM/)).not.toBeInTheDocument();
    expect(screen.getByText('CPR / BLS', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Continuing Education')).toBeInTheDocument();
    expect(screen.getByText('CPR recert night')).toBeInTheDocument();
  });
});

describe('CreateTrainingSessionPage field names', () => {
  beforeEach(() => {
    tzState.value = 'UTC';
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([]);
    getLocations.mockReset();
    getLocations.mockResolvedValue([{ id: 'loc-1', name: 'Station 1', is_active: true }]);
    getBasicApparatus.mockReset();
    getBasicApparatus.mockResolvedValue([]);
  });

  it('names the event fields a screen reader announced as unnamed', async () => {
    renderWithRouter(<CreateTrainingSessionPage />);

    expect(screen.getByLabelText(/Training Title/)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/Description/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Location/, { selector: 'select' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Location Details/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Max Participants/)).toBeInTheDocument();
  });
});

describe('CreateTrainingSessionPage schedule check', () => {
  beforeEach(() => {
    tzState.value = 'UTC';
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([]);
    getLocations.mockReset();
    getLocations.mockResolvedValue([]);
    getBasicApparatus.mockReset();
    getBasicApparatus.mockResolvedValue([]);
    toastError.mockReset();
  });

  // Workflow review, training events: a 7 PM start with a 6 PM end went through
  // all four steps and was refused only by the server on the last click.
  it('keeps the officer on the first step when the end is before the start', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByLabelText(/Training Title/), 'Ladder Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.selectOptions(screen.getByLabelText('Start time hour'), '7');
    await user.selectOptions(screen.getByLabelText('Start time AM/PM'), 'PM');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-01');
    await user.selectOptions(screen.getByLabelText('End time hour'), '6');
    await user.selectOptions(screen.getByLabelText('End time AM/PM'), 'PM');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(toastError).toHaveBeenCalledWith('End time must be after the start time');
    expect(screen.getByLabelText(/Training Title/)).toBeInTheDocument();
    expect(screen.queryByText('Course Selection')).not.toBeInTheDocument();
  });
});

describe('CreateTrainingSessionPage location picker', () => {
  beforeEach(() => {
    tzState.value = 'UTC';
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([]);
    getBasicApparatus.mockReset();
    getBasicApparatus.mockResolvedValue([]);
    getLocations.mockReset();
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
  });

  it('names the building once', async () => {
    renderWithRouter(<CreateTrainingSessionPage />);

    const select = await screen.findByLabelText(/^Location/, { selector: 'select' });
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBeGreaterThan(2));
    const labels = Array.from((select as HTMLSelectElement).options).map((option) => option.text);
    expect(labels).toContain('Volunteer Office — Station 1 - Headquarters #107');
    expect(labels).toContain('Training Room (Annex)');
  });
});

describe('CreateTrainingSessionPage attendance requirements', () => {
  beforeEach(() => {
    getUsers.mockReset();
    getUsers.mockResolvedValue([]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([]);
    getLocations.mockReset();
    getLocations.mockResolvedValue([]);
    getBasicApparatus.mockReset();
    getBasicApparatus.mockResolvedValue([]);
    createSession.mockReset();
    createSession.mockResolvedValue({ id: 'session-1', event_id: 'event-1' });
    linkageRequirements.value = [
      { id: 'req-drills', name: 'Company drills', requirement_type: 'session_attendance', required_attendance_pct: 60 },
      { id: 'req-hours', name: 'Annual hours', requirement_type: 'hours' },
    ];
  });

  const fillAndCreate = async (user: ReturnType<typeof userEvent.setup>, tick: boolean) => {
    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Company Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-02');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByPlaceholderText('e.g., CPR/AED for Healthcare Providers'), 'Company Drill');
    if (tick) await user.click(await screen.findByRole('checkbox', { name: /Company drills/ }));
    expect(screen.queryByRole('checkbox', { name: /Annual hours/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
  };

  it('sends the ticked attendance requirements with the new session', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await fillAndCreate(user, true);

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ attendance_requirement_ids: ['req-drills'] }));
  });

  // Workflow review W80-12: the ticked requirements were saved but the review
  // step did not list them, so the officer confirmed without seeing them.
  it('lists the ticked attendance requirements on the review step', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Company Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-02');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByPlaceholderText('e.g., CPR/AED for Healthcare Providers'), 'Company Drill');
    await user.click(await screen.findByRole('checkbox', { name: /Company drills/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Counts toward attendance:')).toBeInTheDocument();
    expect(screen.getByText('Company drills')).toBeInTheDocument();
  });

  // Workflow review W80-13: the hint said attendees are credited these hours;
  // finalize credits the time each one actually attended.
  it('explains that credit follows the time attended, not the credit hours', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Company Drill');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByLabelText(/Credit Hours/)).toHaveAccessibleDescription(
      /planned length\. Each attendee is credited with the time they actually attended/
    );
    expect(screen.queryByText('The training hours each attendee is credited with.')).not.toBeInTheDocument();
  });

  it('leaves the session optional when nothing is ticked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await fillAndCreate(user, false);

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ attendance_requirement_ids: [] }));
  });
});
