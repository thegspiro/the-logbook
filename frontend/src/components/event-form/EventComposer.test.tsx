/**
 * EventComposer draws the single-page event form for every type but Training
 * and the training-event form for Training, from one model, so a type change
 * either way carries everything typed (owner decision, 2026-11-10).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const getUsers = vi.fn();
const getCourses = vi.fn();
const getLocations = vi.fn();
const getVisibleEventTypesWithCategories = vi.fn();

vi.mock('../../services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
  trainingService: { getCourses: (...args: unknown[]) => getCourses(...args) as unknown },
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

import { EventComposer } from './EventComposer';

type User = ReturnType<typeof userEvent.setup>;

const onSubmit = vi.fn();
const onSubmitRecurring = vi.fn();
const onCancel = vi.fn();

function resetMocks() {
  for (const mock of [
    getUsers,
    getCourses,
    getLocations,
    getVisibleEventTypesWithCategories,
    onSubmit,
    onSubmitRecurring,
  ]) {
    mock.mockReset();
  }
  onCancel.mockReset();
  getUsers.mockResolvedValue([]);
  getCourses.mockResolvedValue([]);
  getLocations.mockResolvedValue([]);
  getVisibleEventTypesWithCategories.mockResolvedValue({
    visible_event_types: ['business_meeting', 'training', 'social'],
    custom_event_categories: [{ value: 'drill', label: 'Company Drill', color: '#991b1b' }],
    visible_custom_categories: ['drill'],
    membership_types: [{ value: 'active', label: 'Active Member' }],
  });
  onSubmit.mockResolvedValue(undefined);
  onSubmitRecurring.mockResolvedValue(undefined);
}

const renderComposer = () =>
  renderWithRouter(
    <EventComposer
      onSubmit={onSubmit}
      onSubmitRecurring={onSubmitRecurring}
      onCancel={onCancel}
      trainingSubmitLabel="Create Event"
      trainingRecurringSubmitLabel="Create Recurring Events"
    />
  );

const typePicker = () => screen.getByRole('combobox', { name: /Event Type/ });

/** The values the single-page form is given before the type changes. */
async function fillSinglePage(user: User) {
  await user.type(screen.getByLabelText(/^Title/), 'Monday Night Drill');
  await user.type(screen.getByLabelText(/^Description/), 'Hose deployment');
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Category' }), 'drill');
  fireEvent.change(screen.getByLabelText(/Start Date & Time/), { target: { value: '2030-05-06' } });
  await user.click(screen.getByRole('checkbox', { name: /Make this a recurring event/ }));
  await user.click(screen.getByRole('checkbox', { name: 'Rolling 12-month cycle' }));
  fireEvent.change(screen.getByLabelText('Date to skip'), { target: { value: '2030-05-27' } });
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await user.click(screen.getByLabelText(/mandatory attendance/i));
  await user.click(screen.getByLabelText('Active Member'));
}

describe('EventComposer hand-off to the training form', () => {
  beforeEach(resetMocks);

  it('opens the step-by-step form on Training, carrying every value typed', async () => {
    const user = userEvent.setup();
    renderComposer();
    await fillSinglePage(user);

    await user.selectOptions(typePicker(), 'training');

    expect(screen.getByRole('status')).toHaveTextContent('Switched to the training form');
    expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    // The picker stays, first on the step, says how to go back, and has focus:
    // the one the officer was using was replaced.
    expect(typePicker()).toHaveValue('training');
    expect(typePicker()).toHaveAccessibleDescription(
      'Training uses this step-by-step form. Pick another type to go back to the single-page form; your entries carry over.'
    );
    await waitFor(() => expect(typePicker()).toHaveFocus());
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Monday Night Drill');
    expect(screen.getByLabelText(/^Description/)).toHaveValue('Hose deployment');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('drill');
    expect(screen.getByRole('checkbox', { name: /Make this a recurring event/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Rolling 12-month cycle' })).toBeChecked();
    expect(screen.getByText('2030-05-27')).toBeInTheDocument();

    // Settings is two steps on; the mandatory choice made on the single page is there.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 3 of 4 · Settings')).toBeInTheDocument();
    expect(screen.getByLabelText(/mandatory attendance/i)).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Only these member types' })).toBeChecked();
    expect(screen.getByLabelText('Active Member')).toBeChecked();
  });

  it('goes back to the single-page form, values intact, from the notice or the picker', async () => {
    const user = userEvent.setup();
    renderComposer();
    await fillSinglePage(user);
    await user.selectOptions(typePicker(), 'training');

    await user.click(screen.getByRole('button', { name: 'Change back to Business Meeting' }));

    expect(screen.queryByText('Step 1 of 4 · Event Details')).not.toBeInTheDocument();
    expect(screen.queryByText('Switched to the training form')).not.toBeInTheDocument();
    expect(typePicker()).toHaveValue('business_meeting');
    await waitFor(() => expect(typePicker()).toHaveFocus());
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Monday Night Drill');
    expect(screen.getByText('2030-05-27')).toBeInTheDocument();
    expect(screen.getByLabelText('Active Member')).toBeChecked();

    // And through the picker on the training form, to a third type.
    await user.selectOptions(typePicker(), 'training');
    await user.selectOptions(typePicker(), 'social');
    expect(typePicker()).toHaveValue('social');
    expect(screen.getByRole('button', { name: 'Create Event' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Monday Night Drill');
  });

  it('keeps the training details through a detour to another type', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByLabelText(/^Title/), 'Ladder Drill');
    fireEvent.change(screen.getByLabelText(/Start Date & Time/), { target: { value: '2030-05-06' } });
    await user.selectOptions(typePicker(), 'training');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.selectOptions(screen.getByLabelText(/^Training Type/), 'refresher');

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await user.selectOptions(typePicker(), 'social');
    await user.selectOptions(typePicker(), 'training');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByLabelText(/^Training Type/)).toHaveValue('refresher');
  });

  it('saves a series from the training form with its training details', async () => {
    const user = userEvent.setup();
    renderComposer();
    await fillSinglePage(user);
    await user.selectOptions(typePicker(), 'training');

    for (let step = 0; step < 3; step += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create Recurring Events' }));

    await waitFor(() => expect(onSubmitRecurring).toHaveBeenCalledTimes(1));
    expect(onSubmitRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Monday Night Drill',
        event_type: 'training',
        custom_category: 'drill',
        rolling_recurrence: true,
        recurrence_exceptions: ['2030-05-27'],
        is_mandatory: true,
        mandatory_membership_types: ['active'],
        training_details: expect.objectContaining({ training_type: 'continuing_education' }) as unknown,
      })
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends no training details once the type has gone back', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByLabelText(/^Title/), 'Ladder Drill');
    fireEvent.change(screen.getByLabelText(/Start Date & Time/), { target: { value: '2030-05-06' } });
    await user.selectOptions(typePicker(), 'training');
    await user.click(screen.getByRole('button', { name: 'Change back to Business Meeting' }));

    await user.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const sent = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.event_type).toBe('business_meeting');
    expect(sent).not.toHaveProperty('training_details');
  });
});

describe('EventComposer opening on Training', () => {
  beforeEach(resetMocks);

  // A Training template opens the training form directly: nothing was
  // switched, so there is nothing to change back to.
  it('draws the training form without the switch notice', () => {
    renderWithRouter(
      <EventComposer
        initialData={{ title: 'Monday Night Drill', event_type: 'training' }}
        onSubmit={onSubmit}
        onSubmitRecurring={onSubmitRecurring}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Step 1 of 4 · Event Details')).toBeInTheDocument();
    expect(typePicker()).toHaveValue('training');
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Monday Night Drill');
    expect(screen.queryByText('Switched to the training form')).not.toBeInTheDocument();
  });

  it('fixes the type for Training Admin and offers no picker', () => {
    renderWithRouter(
      <EventComposer
        lockedType="training"
        onSubmit={onSubmit}
        onSubmitRecurring={onSubmitRecurring}
        onCancel={onCancel}
      />
    );

    expect(screen.queryByRole('combobox', { name: /Event Type/ })).not.toBeInTheDocument();
    expect(screen.getByText('Set by Training Admin. Other event types use the Events page.')).toBeInTheDocument();
  });

  // Ticking Mandatory on the training form with nothing narrower chosen means
  // every member, said on screen (the approved mockup's Settings step).
  it('opens Mandatory for on All members in the training form', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EventComposer
        initialData={{ title: 'Ladder Drill', event_type: 'training' }}
        onSubmit={onSubmit}
        onSubmitRecurring={onSubmitRecurring}
        onCancel={onCancel}
      />
    );
    fireEvent.change(screen.getByLabelText(/Start Date & Time/), { target: { value: '2030-05-06' } });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByLabelText(/mandatory attendance/i));

    expect(screen.getByRole('radio', { name: 'All members' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument();
    expect(screen.getByText('All members')).toBeInTheDocument();
  });

  it('refuses Only these member types with none ticked on Settings, under the field', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EventComposer
        initialData={{ title: 'Ladder Drill', event_type: 'training' }}
        onSubmit={onSubmit}
        onSubmitRecurring={onSubmitRecurring}
        onCancel={onCancel}
      />
    );
    fireEvent.change(screen.getByLabelText(/Start Date & Time/), { target: { value: '2030-05-06' } });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByLabelText(/mandatory attendance/i));
    await user.click(screen.getByRole('radio', { name: 'Only these member types' }));

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Step 3 of 4 · Settings')).toBeInTheDocument();
    const first = screen.getByLabelText('Active Member');
    expect(first).toHaveAccessibleDescription('Select at least one member type, or choose All members.');
    await waitFor(() => expect(first).toHaveFocus());
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one member type, or choose All members.');
  });
});
