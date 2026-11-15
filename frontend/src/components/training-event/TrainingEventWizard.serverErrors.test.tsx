/**
 * A refusal, from the server or the form itself, is written under the field it
 * is about, and the training-event form goes back to the step holding it and
 * focuses it (forms batch 17, carried over from the Create Training Session
 * wizard this form replaced). The form saves through the events endpoints, so
 * one 422 can name an event field (`title`) or a training one
 * (`training_details.course_name`); each lands on its own step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const getUsers = vi.fn();
const getCourses = vi.fn();
const getLocations = vi.fn();
const getVisibleEventTypesWithCategories = vi.fn();
const getMandatoryTiers = vi.fn();

vi.mock('../../services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
  trainingService: { getCourses: (...args: unknown[]) => getCourses(...args) as unknown },
  trainingSessionService: { getMandatoryTiers: (...args: unknown[]) => getMandatoryTiers(...args) as unknown },
  locationsService: { getLocations: (...args: unknown[]) => getLocations(...args) as unknown },
  eventService: {
    getVisibleEventTypesWithCategories: (...args: unknown[]) => getVisibleEventTypesWithCategories(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTrainingLinkageData', () => ({
  useTrainingLinkageData: () => ({ categories: [], requirements: [], programs: [], phases: [] }),
}));
vi.mock('../../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: toastError } }));

import { EventComposer } from '../event-form/EventComposer';
import { EventType } from '../../constants/enums';
import { DEFAULT_TRAINING_DETAILS } from './trainingDetailsModel';

type User = ReturnType<typeof userEvent.setup>;

const onSubmit = vi.fn();
const onSubmitUpdate = vi.fn();

const renderForm = () =>
  renderWithRouter(<EventComposer lockedType={EventType.TRAINING} onSubmit={onSubmit} onCancel={vi.fn()} />);

const next = (user: User) => user.click(screen.getByRole('button', { name: 'Next' }));

/** Title and a start; the end follows two hours later. */
async function fillEventDetails(user: User) {
  await user.type(screen.getByLabelText(/^Title/), 'CPR recert night');
  await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
}

async function fillAndReachReview(user: User) {
  await fillEventDetails(user);
  await next(user); // to Training Info
  await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
  await user.type(screen.getByLabelText(/Course Name/), 'CPR');
  await next(user); // to Settings
  await next(user); // to Review
}

const submit = (user: User) => user.click(screen.getByRole('button', { name: 'Create Training Session' }));

describe('TrainingEventWizard › refusals on their fields', () => {
  beforeEach(() => {
    for (const mock of [
      getUsers,
      getCourses,
      getLocations,
      getVisibleEventTypesWithCategories,
      getMandatoryTiers,
      onSubmit,
      onSubmitUpdate,
      toastError,
    ]) {
      mock.mockReset();
    }
    getUsers.mockResolvedValue([]);
    getCourses.mockResolvedValue([]);
    getLocations.mockResolvedValue([]);
    getMandatoryTiers.mockResolvedValue({ everyone: false, tier_ids: [], unmapped: [] });
    getVisibleEventTypesWithCategories.mockResolvedValue({
      visible_event_types: ['training'],
      custom_event_categories: [],
      visible_custom_categories: [],
      membership_types: [{ value: 'active', label: 'Active Member' }],
    });
    onSubmit.mockResolvedValue(undefined);
    onSubmitUpdate.mockResolvedValue(undefined);
  });

  it("takes the officer back to the server's refused title, flagged and focused", async () => {
    onSubmit.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'title', message: 'String should have at most 200 characters' }] },
      },
    });
    const user = userEvent.setup();
    renderForm();
    await fillAndReachReview(user);
    await submit(user);

    expect(await screen.findByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    const title = screen.getByLabelText(/^Title/);
    expect(title).toHaveAccessibleDescription(/Title is too long — keep it to 200 characters\./);
    expect(title).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('takes the officer back to a refused training field on Training Info, focused', async () => {
    onSubmit.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [{ field: 'training_details.course_name', message: 'String should have at most 255 characters' }],
        },
      },
    });
    const user = userEvent.setup();
    renderForm();
    await fillAndReachReview(user);
    await submit(user);

    expect(await screen.findByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
    const courseName = screen.getByLabelText(/Course Name/);
    expect(courseName).toHaveAccessibleDescription(/Course name is too long — keep it to 255 characters\./);
    expect(courseName).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(courseName).toHaveFocus());
  });

  it('creates nothing without a course name and flags it on its step', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await next(user);

    const courseName = screen.getByLabelText(/Course Name/);
    expect(courseName).toHaveAccessibleDescription(/Enter a course name\./);
    expect(courseName).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(courseName).toHaveFocus());
    expect(screen.getByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('TrainingEventWizard › a refusal on an earlier step', () => {
  beforeEach(() => {
    for (const mock of [
      getUsers,
      getCourses,
      getLocations,
      getVisibleEventTypesWithCategories,
      getMandatoryTiers,
      onSubmitUpdate,
      toastError,
    ]) {
      mock.mockReset();
    }
    getUsers.mockResolvedValue([]);
    getCourses.mockResolvedValue([]);
    getLocations.mockResolvedValue([]);
    getMandatoryTiers.mockResolvedValue({ everyone: false, tier_ids: [], unmapped: [] });
    getVisibleEventTypesWithCategories.mockResolvedValue({
      visible_event_types: ['training'],
      custom_event_categories: [],
      visible_custom_categories: [],
      membership_types: [{ value: 'active', label: 'Active Member' }],
    });
    onSubmitUpdate.mockResolvedValue(undefined);
  });

  // The event page's "Edit training details" opens on Training Info, so Event
  // Details is first checked by the save. The refusal is read out by the
  // focused field; the toast says only where the form went, so a screen
  // reader does not hear the same sentence twice.
  it('names the step it went back to rather than repeating the refusal', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EventComposer
        initialData={{
          title: '',
          event_type: EventType.TRAINING,
          start_datetime: '2030-05-01T19:00',
          end_datetime: '2030-05-01T21:00',
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        trainingSubmitLabel="Save Changes"
        editing={{
          eventId: 'event-1',
          attendanceLocked: false,
          eventTypeLocked: false,
          storedType: EventType.TRAINING,
          initialTraining: { ...DEFAULT_TRAINING_DETAILS, credit_hours: '2', credit_hours_source: 'manual' },
          trainingAccess: 'edit',
          initialStep: 'training',
          onSubmitUpdate,
        }}
      />
    );
    expect(await screen.findByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
    await next(user); // to Settings
    await next(user); // to Review
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    const title = screen.getByLabelText(/^Title/);
    expect(title).toHaveAccessibleDescription(/Enter a title for the event\./);
    await waitFor(() => expect(title).toHaveFocus());
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Back to Event Details: fix the flagged field');
    expect(onSubmitUpdate).not.toHaveBeenCalled();
  });

  it('says nothing in a toast for a refusal on the step already open', async () => {
    const user = userEvent.setup();
    renderForm();
    await next(user);

    expect(screen.getByLabelText(/^Title/)).toHaveAttribute('aria-invalid', 'true');
    expect(toastError).not.toHaveBeenCalled();
  });
});

/** Everything a screen reader is told without moving to it. */
const announcedText = () =>
  (['alert', 'status', 'log'] as const)
    .flatMap((role) => screen.queryAllByRole(role))
    .map((region) => region.textContent ?? '')
    .join('\n');

// Forms batch 17: the focused field reads its refusal out through its
// description, so a live banner repeating it made a screen reader say it
// twice. Only a refusal no field owns is announced.
describe('TrainingEventWizard › a refusal is announced once', () => {
  beforeEach(() => {
    for (const mock of [
      getUsers,
      getCourses,
      getLocations,
      getVisibleEventTypesWithCategories,
      getMandatoryTiers,
      onSubmit,
      toastError,
    ]) {
      mock.mockReset();
    }
    getUsers.mockResolvedValue([]);
    getCourses.mockResolvedValue([]);
    getLocations.mockResolvedValue([]);
    getMandatoryTiers.mockResolvedValue({ everyone: false, tier_ids: [], unmapped: [] });
    getVisibleEventTypesWithCategories.mockResolvedValue({
      visible_event_types: ['training'],
      custom_event_categories: [],
      visible_custom_categories: [],
      membership_types: [{ value: 'active', label: 'Active Member' }],
    });
    onSubmit.mockResolvedValue(undefined);
  });

  it('leaves a refused Next to the focused field', async () => {
    const user = userEvent.setup();
    renderForm();
    await next(user);

    const title = screen.getByLabelText(/^Title/);
    expect(title).toHaveAccessibleDescription(/Enter a title for the event\./);
    await waitFor(() => expect(title).toHaveFocus());
    expect(announcedText()).not.toContain('Enter a title for the event.');
  });

  it('leaves a refused training field on Next to the focused field', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEventDetails(user);
    await next(user);
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await next(user);

    const courseName = screen.getByLabelText(/Course Name/);
    await waitFor(() => expect(courseName).toHaveFocus());
    expect(courseName).toHaveAccessibleDescription(/Enter a course name\./);
    expect(announcedText()).not.toContain('Enter a course name.');
  });

  it('leaves a mapped 422 to the focused field', async () => {
    onSubmit.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'title', message: 'String should have at most 200 characters' }] },
      },
    });
    const user = userEvent.setup();
    renderForm();
    await fillAndReachReview(user);
    await submit(user);

    const title = await screen.findByLabelText(/^Title/);
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAccessibleDescription(/Title is too long — keep it to 200 characters\./);
    expect(announcedText()).not.toContain('Title is too long');
  });

  it('announces the part of a 422 no field owns, and only that part', async () => {
    onSubmit.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [
            { field: 'training_details.course_name', message: 'String should have at most 255 characters' },
            { field: 'nothing_here', message: 'The session could not be filed.' },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderForm();
    await fillAndReachReview(user);
    await submit(user);

    const courseName = await screen.findByLabelText(/Course Name/);
    await waitFor(() => expect(courseName).toHaveFocus());
    expect(courseName).toHaveAccessibleDescription(/Course name is too long/);
    expect(screen.getByRole('alert')).toHaveTextContent('The session could not be filed.');
    expect(announcedText()).not.toContain('Course name is too long');
  });

  it('announces a refusal with no field to hold it', async () => {
    onSubmit.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'The server is down.' } } });
    const user = userEvent.setup();
    renderForm();
    await fillAndReachReview(user);
    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('The server is down.');
  });
});
