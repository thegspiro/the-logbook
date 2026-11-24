/**
 * Training forms batch E: the four create dialogs on Training Enhancements
 * name what is wrong on its own field (owner rule, 2026-11-05, "Forms — Save
 * With an Error" in docs/KNOWN_LIMITATIONS.md) instead of a toast that
 * vanishes, place a 422 on the field it names, and ask before discarding.
 *
 * Each is a create form, so nothing is created until every flagged field is
 * fixed: creating the record without the refused value would leave the flag on
 * a dialog that has already closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../test/utils';

const getPathways = vi.fn();
const getMyRenewalTasks = vi.fn();
const createPathway = vi.fn();
const getMatrices = vi.fn();
const createMatrix = vi.fn();
const getQualifications = vi.fn();
const createQualification = vi.fn();
const getExercises = vi.fn();
const createExercise = vi.fn();
const getUsers = vi.fn();

vi.mock('../services/trainingServices', () => ({
  recertificationService: {
    getPathways: (...args: unknown[]) => getPathways(...args) as unknown,
    getMyRenewalTasks: (...args: unknown[]) => getMyRenewalTasks(...args) as unknown,
    createPathway: (...args: unknown[]) => createPathway(...args) as unknown,
  },
  competencyService: {
    getMatrices: (...args: unknown[]) => getMatrices(...args) as unknown,
    createMatrix: (...args: unknown[]) => createMatrix(...args) as unknown,
  },
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
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import TrainingEnhancementsTab from './TrainingEnhancementsTab';

const MEMBER = {
  id: 'b5b0c5d2-0000-4000-8000-000000000002',
  username: 'zwells',
  first_name: 'Zoe',
  last_name: 'Wells',
  status: 'active',
};

const validation422 = (loc: string[], msg: string) => ({
  response: { status: 422, data: { detail: [{ loc, msg, type: 'value_error' }] } },
});

const open = async (
  user: ReturnType<typeof userEvent.setup>,
  activeTab: 'recertification' | 'competency' | 'instructors' | 'multi-agency',
  opener: string
) => {
  renderWithRouter(<TrainingEnhancementsTab activeTab={activeTab} />);
  await user.click(await screen.findByRole('button', { name: opener }));
  return screen.getByRole('dialog');
};

describe('Training Enhancements create dialogs (forms batch E)', () => {
  beforeEach(() => {
    for (const fn of [getPathways, getMyRenewalTasks, getMatrices, getQualifications, getExercises]) {
      fn.mockReset();
      fn.mockResolvedValue([]);
    }
    createPathway.mockReset();
    createPathway.mockResolvedValue({ id: 'p-1' });
    createMatrix.mockReset();
    createMatrix.mockResolvedValue({ id: 'm-1' });
    createQualification.mockReset();
    createQualification.mockResolvedValue({ id: 'q-1' });
    createExercise.mockReset();
    createExercise.mockResolvedValue({ id: 'e-1' });
    getUsers.mockReset();
    getUsers.mockResolvedValue([structuredClone(MEMBER)]);
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  it('a pathway with no name is flagged on the name, not in a toast, and nothing is created', async () => {
    const user = userEvent.setup();
    const dialog = await open(user, 'recertification', 'Add Pathway');

    await user.type(within(dialog).getByLabelText('Required Hours'), '40');
    await user.click(within(dialog).getByRole('button', { name: 'Create Pathway' }));

    const name = within(dialog).getByLabelText(/^Name/);
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription(/name/i);
    expect(name).toHaveFocus();
    expect(createPathway).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // What was typed elsewhere is kept.
    expect(within(dialog).getByLabelText('Required Hours')).toHaveValue(40);
  });

  it('a renewal window out of range is flagged on its box before anything is sent', async () => {
    const user = userEvent.setup();
    const dialog = await open(user, 'recertification', 'Add Pathway');

    await user.type(within(dialog).getByLabelText(/^Name/), 'NREMT');
    const window = within(dialog).getByLabelText('Renewal Window (days)');
    await user.clear(window);
    await user.type(window, '400');
    await user.click(within(dialog).getByRole('button', { name: 'Create Pathway' }));

    await waitFor(() => expect(window).toHaveAttribute('aria-invalid', 'true'));
    expect(createPathway).not.toHaveBeenCalled();
  });

  it('a 422 on the pathway name is shown on the name field', async () => {
    createPathway.mockRejectedValue(validation422(['body', 'name'], 'String should have at most 255 characters'));
    const user = userEvent.setup();
    const dialog = await open(user, 'recertification', 'Add Pathway');

    await user.type(within(dialog).getByLabelText(/^Name/), 'NREMT');
    await user.click(within(dialog).getByRole('button', { name: 'Create Pathway' }));

    const name = within(dialog).getByLabelText(/^Name/);
    await waitFor(() => expect(name).toHaveAccessibleDescription('String should have at most 255 characters.'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a matrix with no position is flagged on the position and keeps the name typed', async () => {
    const user = userEvent.setup();
    const dialog = await open(user, 'competency', 'Add Matrix');

    await user.type(within(dialog).getByLabelText(/^Name/), 'FF I');
    await user.click(within(dialog).getByRole('button', { name: 'Create Matrix' }));

    const position = within(dialog).getByLabelText(/^Position/);
    await waitFor(() => expect(position).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('FF I');
    expect(within(dialog).getByLabelText(/^Name/)).not.toHaveAttribute('aria-invalid');
    expect(createMatrix).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a qualification with no member is flagged on the member, and the text boxes carry the schema limits', async () => {
    const user = userEvent.setup();
    const dialog = await open(user, 'instructors', 'Add Qualification');
    await within(dialog).findByRole('option', { name: 'Zoe Wells' });

    expect(within(dialog).getByLabelText('Certification Number')).toHaveAttribute('maxLength', '100');
    expect(within(dialog).getByLabelText('Issuing Agency')).toHaveAttribute('maxLength', '255');
    expect(within(dialog).getByLabelText('Certification Level')).toHaveAttribute('maxLength', '50');

    await user.click(within(dialog).getByRole('button', { name: 'Add Qualification' }));

    const member = within(dialog).getByRole('combobox', { name: /Member/ });
    await waitFor(() => expect(member).toHaveAttribute('aria-invalid', 'true'));
    expect(member).toHaveAccessibleDescription(/member/i);
    expect(createQualification).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a 422 on the exercise date is shown on the date field', async () => {
    createExercise.mockRejectedValue(validation422(['body', 'exercise_date'], 'Input should be a valid date'));
    const user = userEvent.setup();
    const dialog = await open(user, 'multi-agency', 'Add Exercise');

    await user.type(within(dialog).getByLabelText(/^Exercise Name/), 'County Tabletop');
    await user.click(within(dialog).getByRole('button', { name: 'Create Exercise' }));

    const date = within(dialog).getByLabelText(/^Exercise Date/);
    await waitFor(() => expect(date).toHaveAccessibleDescription('Input should be a valid date.'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a failure no field answers for is said in the dialog, not a toast', async () => {
    createExercise.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    const dialog = await open(user, 'multi-agency', 'Add Exercise');

    await user.type(within(dialog).getByLabelText(/^Exercise Name/), 'County Tabletop');
    await user.click(within(dialog).getByRole('button', { name: 'Create Exercise' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Network Error');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Cancel on a dialog with typed changes asks before discarding them', async () => {
    const user = userEvent.setup();
    const dialog = await open(user, 'competency', 'Add Matrix');

    await user.type(within(dialog).getByLabelText(/^Name/), 'FF I');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText(/^Name/)).toHaveValue('FF I');
  });
});
