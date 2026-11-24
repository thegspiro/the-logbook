/**
 * Training forms batch E: crew training follows the owner's form rule
 * (2026-11-05, docs/KNOWN_LIMITATIONS.md "Forms — Save With an Error").
 * Recording files new submissions, so nothing is sent until every field is
 * fixed, and each refusal is said on its own field — all of them at once,
 * rather than one banner at a time at the foot of the page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getCrewRecordingContext = vi.fn();
const getCrewShiftOptions = vi.fn();
const recordCrewTraining = vi.fn();
const getConfig = vi.fn();
const getCategories = vi.fn();
const getCourses = vi.fn();
const getRequirementsEnhanced = vi.fn();

vi.mock('../services/api', () => ({
  trainingSubmissionService: {
    getCrewRecordingContext: (...args: unknown[]) => getCrewRecordingContext(...args) as unknown,
    getCrewShiftOptions: (...args: unknown[]) => getCrewShiftOptions(...args) as unknown,
    recordCrewTraining: (...args: unknown[]) => recordCrewTraining(...args) as unknown,
    getConfig: (...args: unknown[]) => getConfig(...args) as unknown,
  },
  trainingService: {
    getCategories: (...args: unknown[]) => getCategories(...args) as unknown,
    getCourses: (...args: unknown[]) => getCourses(...args) as unknown,
  },
  trainingProgramService: {
    getRequirementsEnhanced: (...args: unknown[]) => getRequirementsEnhanced(...args) as unknown,
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } })),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import RecordCrewTrainingPage from './RecordCrewTrainingPage';

const MEMBERS = [
  { id: 'me', name: 'Lee Crew' },
  { id: 'ana', name: 'Ana Crew' },
  { id: 'ben', name: 'Ben Crew' },
  { id: 'cal', name: 'Cal Crew' },
];

describe('RecordCrewTrainingPage saves with an error (batch E)', () => {
  beforeEach(() => {
    getCrewRecordingContext.mockReset();
    getCrewRecordingContext.mockResolvedValue({ can_record: true, members: MEMBERS });
    getCrewShiftOptions.mockReset();
    getCrewShiftOptions.mockResolvedValue([]);
    recordCrewTraining.mockReset();
    recordCrewTraining.mockResolvedValue({ crew_batch_id: 'batch-1', submissions: [{}] });
    getConfig.mockReset();
    getConfig.mockResolvedValue({ require_approval: true, field_config: {}, allowed_training_types: null });
    getCategories.mockReset();
    getCategories.mockResolvedValue([]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([]);
    getRequirementsEnhanced.mockReset();
    getRequirementsEnhanced.mockResolvedValue([]);
  });

  it('flags every open problem on its own field and sends nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RecordCrewTrainingPage />);

    const minutes = await screen.findByLabelText(/^Length \(minutes\)/);
    await user.clear(minutes);
    await user.click(screen.getByRole('button', { name: 'Send for review' }));

    const topic = screen.getByLabelText(/^Topic/);
    expect(topic).toHaveAttribute('aria-invalid', 'true');
    expect(topic).toHaveAccessibleDescription(/Enter what the training covered\./);
    expect(screen.getByLabelText(/^Length \(minutes\)/)).toHaveAttribute('aria-invalid', 'true');
    expect(recordCrewTraining).not.toHaveBeenCalled();
  });

  it('puts a server refusal on the field it names', async () => {
    recordCrewTraining.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: { detail: [{ loc: ['body', 'instructor'], msg: 'String should have at most 255 characters' }] },
      },
    });
    const user = userEvent.setup();
    renderWithRouter(<RecordCrewTrainingPage />);

    await user.type(await screen.findByLabelText(/^Topic/), 'Ladder Throws');
    await user.type(screen.getByLabelText(/^Instructor/), 'Capt. Lee');
    await user.click(screen.getByRole('button', { name: 'Send for review' }));

    await waitFor(() => expect(recordCrewTraining).toHaveBeenCalledTimes(1));
    const instructor = await screen.findByLabelText(/^Instructor/);
    expect(instructor).toHaveAttribute('aria-invalid', 'true');
    expect(instructor).toHaveAccessibleDescription('String should have at most 255 characters.');
  });
});
