/**
 * The training-event form is a real <form> (forms batch 17, carried over from
 * the Create Training Session wizard this form replaced): Enter in a field
 * moves to the next step, checked as Next checks it, and on Review it creates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

type User = ReturnType<typeof userEvent.setup>;

const onSubmit = vi.fn();

const renderForm = () =>
  renderWithRouter(<EventComposer lockedType={EventType.TRAINING} onSubmit={onSubmit} onCancel={vi.fn()} />);

const next = (user: User) => user.click(screen.getByRole('button', { name: 'Next' }));

function resetMocks() {
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
}

describe('TrainingEventWizard › a real form', () => {
  beforeEach(resetMocks);

  it('moves to the next step on Enter in a field', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/^Title/), 'CPR recert night{Enter}');

    expect(await screen.findByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('checks the step on Enter as Next does, and stays on it', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/^Title/), '{Enter}');

    const title = screen.getByLabelText(/^Title/);
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription(/Enter a title for the event\./);
    expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
  });

  it("creates on Review through the form's submit button, and only then", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/^Title/), 'CPR recert night');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await next(user); // to Training Info
    await next(user); // to Settings
    await next(user); // to Review
    expect(onSubmit).not.toHaveBeenCalled();

    // The form's submit button, so Enter in a field on Review saves too.
    const create = screen.getByRole('button', { name: 'Create Training Session' });
    expect(create).toHaveAttribute('type', 'submit');
    await user.click(create);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'CPR recert night', event_type: 'training' })
    );
  });
});

describe('TrainingEventWizard › the series controls', () => {
  beforeEach(resetMocks);

  // "Duration" was a <label> with no control: it named nothing to a screen
  // reader and was a stray label to every check that looks for them.
  it('names the Duration group rather than labelling nothing', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('checkbox', { name: 'Make this a recurring event' }));

    const duration = screen.getByRole('group', { name: 'Duration' });
    expect(within(duration).getByRole('checkbox', { name: 'Rolling 12-month cycle' })).toBeInTheDocument();
    expect(screen.getByText('Duration')).not.toBeInstanceOf(HTMLLabelElement);
  });
});
