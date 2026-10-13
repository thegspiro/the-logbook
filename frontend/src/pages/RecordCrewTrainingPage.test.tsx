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

describe('RecordCrewTrainingPage', () => {
  beforeEach(() => {
    getCrewRecordingContext.mockReset();
    getCrewRecordingContext.mockResolvedValue({ can_record: true, members: MEMBERS });
    getCrewShiftOptions.mockReset();
    getCrewShiftOptions.mockResolvedValue([]);
    recordCrewTraining.mockReset();
    recordCrewTraining.mockResolvedValue({ crew_batch_id: 'batch-1', submissions: [{}, {}, {}] });
    getConfig.mockReset();
    getConfig.mockResolvedValue({ require_approval: true, field_config: {}, allowed_training_types: null });
    getCategories.mockReset();
    getCategories.mockResolvedValue([]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([{ id: 'c1', name: 'Hose Advancement', active: true }]);
    getRequirementsEnhanced.mockReset();
    getRequirementsEnhanced.mockResolvedValue([
      { id: 'r1', name: 'Annual Hazmat Refresher', active: true },
      { id: 'r2', name: 'Retired Requirement', active: false },
    ]);
  });

  it('explains itself to a member who cannot serve as a shift officer', async () => {
    getCrewRecordingContext.mockResolvedValue({ can_record: false, members: [] });
    renderWithRouter(<RecordCrewTrainingPage />);

    expect(await screen.findByText('Shift officers only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send for review' })).not.toBeInTheDocument();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('suggests active course and requirement names for the topic', async () => {
    renderWithRouter(<RecordCrewTrainingPage />);
    const topic = await screen.findByLabelText<HTMLInputElement>(/Topic/);

    // A datalist's options have no accessible role, so they are read through
    // the input's own `list` association rather than a DOM query.
    const options = Array.from(topic.list?.options ?? []).map((option) => option.value);
    expect(options).toEqual(['Annual Hazmat Refresher', 'Hose Advancement']);
  });

  it('records the drill for the recorder and everyone checked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RecordCrewTrainingPage />);

    await user.type(await screen.findByLabelText(/Topic/), 'Hose Advancement');
    const minutes = screen.getByLabelText('Length (minutes)');
    await user.clear(minutes);
    await user.type(minutes, '45');
    await user.click(screen.getByRole('checkbox', { name: 'Ana Crew' }));
    await user.click(screen.getByRole('checkbox', { name: 'Ben Crew' }));
    await user.click(screen.getByRole('button', { name: 'Send for review' }));

    await waitFor(() => expect(recordCrewTraining).toHaveBeenCalledTimes(1));
    const payload = recordCrewTraining.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      course_name: 'Hose Advancement',
      training_type: 'skills_practice',
      hours_completed: 0.75,
    });
    expect(payload.member_ids).toEqual(['me', 'ana', 'ben']);
    // Blank optional fields are omitted, never sent as empty strings.
    expect(payload).not.toHaveProperty('instructor', '');
    expect(payload.instructor).toBeUndefined();
    expect(await screen.findByText('Sent for review')).toBeInTheDocument();
  });

  it('checks everyone on a shift when the officer picks it', async () => {
    getCrewShiftOptions.mockResolvedValue([
      {
        id: 'shift-1',
        start_time: '2026-10-11T11:00:00Z',
        end_time: '2026-10-11T23:00:00Z',
        platoon: 'A',
        shift_officer_name: 'Lee Crew',
        member_ids: ['ana', 'cal'],
      },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<RecordCrewTrainingPage />);

    await user.selectOptions(await screen.findByLabelText('Shift (optional)'), 'shift-1');

    expect(screen.getByRole('checkbox', { name: 'Ana Crew' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Cal Crew' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ben Crew' })).not.toBeChecked();
    expect(screen.getByText('3 members selected')).toBeInTheDocument();
  });

  it('refuses to send with nobody present', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RecordCrewTrainingPage />);

    await user.type(await screen.findByLabelText(/Topic/), 'Ladder Throws');
    await user.click(screen.getByRole('checkbox', { name: 'Lee Crew (you)' }));
    await user.click(screen.getByRole('button', { name: 'Send for review' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one member who was present.');
    expect(recordCrewTraining).not.toHaveBeenCalled();
  });

  it('shows the server refusal', async () => {
    recordCrewTraining.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'Hours exceed maximum of 2 per submission' } },
    });
    const user = userEvent.setup();
    renderWithRouter(<RecordCrewTrainingPage />);

    await user.type(await screen.findByLabelText(/Topic/), 'Ladder Throws');
    await user.click(screen.getByRole('button', { name: 'Send for review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Hours exceed maximum of 2 per submission');
  });
});
