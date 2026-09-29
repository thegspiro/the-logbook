/**
 * TrainingDetailsFields is controlled, so each test drives it through a small
 * stateful harness and asserts on the value it reports — which is what the
 * Events form and the event page's card both submit.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetCourses = vi.fn();
const mockGetCategories = vi.fn();
const mockGetRequirements = vi.fn();
const mockGetPrograms = vi.fn();
const mockGetProgramPhases = vi.fn();

vi.mock('../../services/api', () => ({
  trainingService: {
    getCourses: (...args: unknown[]) => mockGetCourses(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    getRequirements: (...args: unknown[]) => mockGetRequirements(...args) as unknown,
  },
  trainingProgramService: {
    getPrograms: (...args: unknown[]) => mockGetPrograms(...args) as unknown,
    getProgramPhases: (...args: unknown[]) => mockGetProgramPhases(...args) as unknown,
  },
}));

import { TrainingDetailsFields } from './TrainingDetailsFields';
import {
  EMPTY_TRAINING_DETAILS,
  hasExplicitTrainingDetails,
  toTrainingDetailsPayload,
  type TrainingDetailsValue,
} from './trainingDetailsValue';

const COURSE = {
  id: 'course-cpr',
  organization_id: 'org-1',
  name: 'CPR / BLS',
  code: 'CPR',
  training_type: 'certification',
  category_ids: ['cat-ems'],
  program_id: 'prog-recruit',
  active: true,
  created_at: '',
  updated_at: '',
};

const base = { organization_id: 'org-1', active: true, created_at: '', updated_at: '' };

const reported = vi.fn();

const Harness: React.FC<{
  initial?: TrainingDetailsValue;
  disabled?: boolean;
  typeRequired?: boolean;
  currentCourseName?: string;
}> = ({ initial = EMPTY_TRAINING_DETAILS, disabled, typeRequired, currentCourseName }) => {
  const [value, setValue] = useState(initial);
  return (
    <TrainingDetailsFields
      value={value}
      onChange={(next) => {
        reported(next);
        setValue(next);
      }}
      disabled={disabled}
      typeRequired={typeRequired}
      currentCourseName={currentCourseName}
    />
  );
};

const lastReported = (): TrainingDetailsValue => {
  const calls = reported.mock.calls;
  return calls[calls.length - 1]?.[0] as TrainingDetailsValue;
};

describe('TrainingDetailsFields', () => {
  beforeEach(() => {
    reported.mockReset();
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([COURSE]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([
      { ...base, id: 'cat-ems', name: 'EMS', sort_order: 1 },
      { ...base, id: 'cat-fire', name: 'Fire', sort_order: 2 },
    ]);
    mockGetRequirements.mockReset();
    mockGetRequirements.mockResolvedValue([]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([
      { ...base, id: 'prog-recruit', name: 'Recruit School' },
      { ...base, id: 'prog-driver', name: 'Driver Training' },
    ]);
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
  });

  it('offers a default type that files the credit as Continuing Education', async () => {
    render(<Harness />);

    const typeSelect = screen.getByLabelText('Training Type');
    expect(typeSelect).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Default (Continuing Education)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Skills Practice' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'CPR - CPR / BLS' })).toBeInTheDocument();
  });

  it('pre-fills type, category and program from a picked course', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(await screen.findByLabelText('Course'), 'course-cpr');

    expect(lastReported()).toEqual({
      ...EMPTY_TRAINING_DETAILS,
      course_id: 'course-cpr',
      training_type: 'certification',
      category_id: 'cat-ems',
      program_id: 'prog-recruit',
    });
  });

  it('never overrides a choice already made when a course is picked', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...EMPTY_TRAINING_DETAILS,
          training_type: 'refresher',
          category_id: 'cat-fire',
          program_id: 'prog-driver',
        }}
      />
    );

    await user.selectOptions(await screen.findByLabelText('Course'), 'course-cpr');

    expect(lastReported()).toEqual({
      ...EMPTY_TRAINING_DETAILS,
      course_id: 'course-cpr',
      training_type: 'refresher',
      category_id: 'cat-fire',
      program_id: 'prog-driver',
    });
  });

  it('reports a cleared linkage pick as a blank, not undefined', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_TRAINING_DETAILS, category_id: 'cat-ems' }} />);

    await screen.findByRole('option', { name: 'EMS' });
    await user.selectOptions(screen.getByLabelText('Training Category'), '');

    expect(lastReported()).toEqual(EMPTY_TRAINING_DETAILS);
  });

  it('disables every control when told to', async () => {
    render(<Harness disabled />);

    expect(screen.getByLabelText('Course')).toBeDisabled();
    expect(screen.getByLabelText('Training Type')).toBeDisabled();
    expect(screen.getByLabelText('Training Category')).toBeDisabled();
    expect(await screen.findByLabelText('Training Program')).toBeDisabled();
  });

  it('drops the default choice when a type is required', () => {
    render(<Harness initial={{ ...EMPTY_TRAINING_DETAILS, training_type: 'certification' }} typeRequired />);

    expect(screen.queryByRole('option', { name: 'Default (Continuing Education)' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Training Type')).toHaveValue('certification');
  });

  it('keeps naming a course that is no longer offered rather than reading "No course"', async () => {
    render(
      <Harness
        initial={{ ...EMPTY_TRAINING_DETAILS, course_id: 'course-retired', training_type: 'certification' }}
        currentCourseName="Pump Operations (2019)"
      />
    );

    await screen.findByRole('option', { name: 'CPR - CPR / BLS' });
    expect(screen.getByLabelText('Course')).toHaveDisplayValue('Pump Operations (2019)');
  });

  describe('payload helpers', () => {
    it('treats an all-blank value as no details', () => {
      expect(hasExplicitTrainingDetails(EMPTY_TRAINING_DETAILS)).toBe(false);
      expect(hasExplicitTrainingDetails({ ...EMPTY_TRAINING_DETAILS, requirement_id: 'req-1' })).toBe(true);
    });

    it('omits blanks from the create payload', () => {
      expect(
        toTrainingDetailsPayload({ ...EMPTY_TRAINING_DETAILS, course_id: 'course-cpr', training_type: 'refresher' })
      ).toStrictEqual({ course_id: 'course-cpr', training_type: 'refresher' });
      expect(toTrainingDetailsPayload(EMPTY_TRAINING_DETAILS)).toStrictEqual({});
    });
  });
});
