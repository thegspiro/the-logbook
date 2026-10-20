import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../test/utils';

const getQualifications = vi.fn();
const createQualification = vi.fn();
const getUsers = vi.fn();
const getExercises = vi.fn();
const createExercise = vi.fn();

vi.mock('../services/trainingServices', () => ({
  recertificationService: {},
  competencyService: {},
  instructorService: {
    getQualifications: (...args: unknown[]) => getQualifications(...args) as unknown,
    createQualification: (...args: unknown[]) => createQualification(...args) as unknown,
  },
  effectivenessService: {},
  multiAgencyService: {
    getExercises: (...args: unknown[]) => getExercises(...args) as unknown,
    createExercise: (...args: unknown[]) => createExercise(...args) as unknown,
  },
  reportExportService: {},
}));

vi.mock('../services/api', () => ({
  userService: {
    getUsers: (...args: unknown[]) => getUsers(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import TrainingEnhancementsTab from './TrainingEnhancementsTab';

const MEMBERS = [
  { id: 'b5b0c5d2-0000-4000-8000-000000000002', username: 'zwells', first_name: 'Zoe', last_name: 'Wells' },
  {
    id: 'b5b0c5d2-0000-4000-8000-000000000001',
    username: 'aboone',
    first_name: 'Adam',
    last_name: 'Boone',
    membership_number: '114',
  },
];

describe('TrainingEnhancementsTab instructor qualifications', () => {
  beforeEach(() => {
    getQualifications.mockReset();
    getQualifications.mockResolvedValue([]);
    createQualification.mockReset();
    createQualification.mockResolvedValue({ id: 'qual-1' });
    getUsers.mockReset();
    getUsers.mockResolvedValue(structuredClone(MEMBERS));
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  const openAddModal = async (user: ReturnType<typeof userEvent.setup>) => {
    renderWithRouter(<TrainingEnhancementsTab activeTab="instructors" />);
    await user.click(await screen.findByRole('button', { name: 'Add Qualification' }));
    return screen.getByRole('dialog');
  };

  // The form asked for a raw member UUID in a text box, which nobody filling
  // it in has to hand; the backend's InstructorQualificationCreate.user_id is a UUID.
  it('picks the member from the roster and sends their id', async () => {
    const user = userEvent.setup();
    const dialog = await openAddModal(user);

    const member = within(dialog).getByRole('combobox', { name: /Member/ });
    await waitFor(() => expect(within(member).getByRole('option', { name: 'Adam Boone (#114)' })).toBeInTheDocument());
    expect(
      within(member)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Select a member...', 'Adam Boone (#114)', 'Zoe Wells']);
    expect(within(dialog).queryByPlaceholderText('Member user ID')).not.toBeInTheDocument();

    await user.selectOptions(member, 'Zoe Wells');
    await user.click(within(dialog).getByRole('button', { name: 'Add Qualification' }));

    await waitFor(() => expect(createQualification).toHaveBeenCalledTimes(1));
    expect(createQualification).toHaveBeenCalledWith({
      user_id: 'b5b0c5d2-0000-4000-8000-000000000002',
      qualification_type: 'instructor',
      certification_number: undefined,
      issuing_agency: undefined,
      certification_level: undefined,
      issued_date: undefined,
      expiration_date: undefined,
    });
  });

  it('refuses to save without a member', async () => {
    const user = userEvent.setup();
    const dialog = await openAddModal(user);
    await within(dialog).findByRole('option', { name: 'Zoe Wells' });

    const member = within(dialog).getByRole('combobox', { name: /Member/ });
    expect(member).toBeRequired();
    expect(member).toBeInvalid();
    await user.click(within(dialog).getByRole('button', { name: 'Add Qualification' }));

    expect(createQualification).not.toHaveBeenCalled();
  });

  it('says so when the roster cannot load', async () => {
    getUsers.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    const dialog = await openAddModal(user);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Network Error');
  });
});

describe('TrainingEnhancementsTab multi-agency exercises', () => {
  beforeEach(() => {
    getExercises.mockReset();
    getExercises.mockResolvedValue([]);
    createExercise.mockReset();
    createExercise.mockResolvedValue({ id: 'ex-1' });
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  // The organization is optional: the form's hint says organizations can be
  // added after the exercise is created, so a blank box sends an empty list.
  it('creates an exercise with no participating organization', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingEnhancementsTab activeTab="multi-agency" />);
    await user.click(await screen.findByRole('button', { name: 'Add Exercise' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByPlaceholderText('Agency name')).not.toBeRequired();
    await user.type(within(dialog).getByPlaceholderText('e.g. Regional MCI Drill'), 'County Tabletop');
    await user.click(within(dialog).getByRole('button', { name: 'Create Exercise' }));

    await waitFor(() => expect(createExercise).toHaveBeenCalledTimes(1));
    expect(createExercise.mock.calls[0]?.[0]).toMatchObject({
      exercise_name: 'County Tabletop',
      participating_organizations: [],
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Exercise created');
  });

  it('lists an exercise that has no organizations', async () => {
    getExercises.mockResolvedValue([
      {
        id: 'ex-1',
        organization_id: 'org-1',
        exercise_name: 'County Tabletop',
        exercise_type: 'tabletop',
        exercise_date: '2026-11-12',
        participating_organizations: [],
        nims_compliant: false,
        created_at: '2026-10-20T00:00:00Z',
        updated_at: '2026-10-20T00:00:00Z',
      },
    ]);
    renderWithRouter(<TrainingEnhancementsTab activeTab="multi-agency" />);

    expect(await screen.findByRole('heading', { name: 'County Tabletop' })).toBeInTheDocument();
  });
});
