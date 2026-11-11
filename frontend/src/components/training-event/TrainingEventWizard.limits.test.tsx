/**
 * Each text box of the training-event form takes its limit from the backend
 * schema it saves through (EventBase and TrainingSessionAttach, in
 * backend/app/schemas/event.py and training_session.py), so an over-long value
 * is stopped at the box rather than refused by the server; and Days of the
 * Week is a named group of pressed/unpressed buttons. Both from forms batch 17,
 * carried over from the Create Training Session wizard this form replaced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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
  renderWithRouter(
    <EventComposer lockedType={EventType.TRAINING} onSubmit={onSubmit} onSubmitRecurring={vi.fn()} onCancel={vi.fn()} />
  );

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

describe('TrainingEventWizard › text limits', () => {
  beforeEach(resetMocks);

  it('limits each event box to EventBase', async () => {
    renderForm();
    const title = screen.getByLabelText(/^Title/);
    expect(title).toHaveAttribute('maxLength', '200');
    expect(title).toHaveAttribute('autocomplete', 'off');
    // With no saved locations the location is typed.
    expect(await screen.findByLabelText(/^Location/, { selector: 'input' })).toHaveAttribute('maxLength', '300');
  });

  it('limits each training box to TrainingSessionAttach, with no autofill', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/^Title/), 'CPR recert night');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await next(user);
    await user.click(screen.getByRole('radio', { name: /One-off course name/ }));
    await user.click(screen.getByRole('checkbox', { name: /issues a certification/ }));

    const limits: [RegExp, string][] = [
      [/Course Name/, '255'],
      [/Course Code/, '50'],
      [/Issuing Agency/, '255'],
      [/Cert Number Prefix/, '50'],
    ];
    for (const [label, maxLength] of limits) {
      const box = screen.getByLabelText(label);
      expect(box).toHaveAttribute('maxLength', maxLength);
      expect(box).toHaveAttribute('autocomplete', 'off');
    }
  });
});

describe('TrainingEventWizard › Days of the Week', () => {
  beforeEach(resetMocks);

  it('is a named group of buttons that say whether each day is picked', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('checkbox', { name: /Make this a recurring event/ }));
    await user.selectOptions(screen.getByLabelText(/^Repeats/), 'custom');

    const group = screen.getByRole('group', { name: 'Days of the Week' });
    const tuesday = within(group).getByRole('button', { name: 'Tue' });
    expect(tuesday).toHaveAttribute('aria-pressed', 'false');
    await user.click(tuesday);
    expect(tuesday).toHaveAttribute('aria-pressed', 'true');
  });

  // The group goes with the custom pattern; its refusal used to stay behind,
  // still listed in the banner with nothing on screen to fix.
  it('drops its refusal when another pattern is chosen', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/^Title/), 'CPR recert night');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.click(screen.getByRole('checkbox', { name: /Make this a recurring event/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Rolling 12-month cycle' }));
    await user.selectOptions(screen.getByLabelText(/^Repeats/), 'custom');
    await next(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one day for custom recurrence.');

    await user.selectOptions(screen.getByLabelText(/^Repeats/), 'weekly');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await next(user);
    expect(screen.getByText('Step 2 of 4 · Training Info')).toBeInTheDocument();
  });
});
