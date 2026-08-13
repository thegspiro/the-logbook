import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TrainingLinkageFields, type TrainingLinkageValue } from './TrainingLinkageFields';
import type { TrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import type { ProgramPhase, TrainingCourse, TrainingProgram, TrainingRequirement } from '../../types/training';

const requirement = (overrides: Partial<TrainingRequirement> & { id: string; name: string }): TrainingRequirement => ({
  organization_id: 'org-1',
  requirement_type: 'hours',
  source: 'department',
  frequency: 'annual',
  applies_to_all: true,
  due_date_type: 'calendar_period',
  active: true,
  created_at: '',
  updated_at: '',
  ...overrides,
});

const COURSE: TrainingCourse = {
  id: 'course-1',
  organization_id: 'org-1',
  name: 'CPR / BLS',
  training_type: 'certification',
  category_ids: ['cat-ems'],
  active: true,
  created_at: '',
  updated_at: '',
};

const PROGRAM: TrainingProgram = {
  id: 'prog-1',
  organization_id: 'org-1',
  name: 'Recruit School',
  version: 1,
  structure_type: 'sequential',
  enrolled_count: 0,
  allows_concurrent_enrollment: false,
  warning_days_before: 7,
  is_template: false,
  active: true,
  recert_enabled: false,
  created_at: '',
  updated_at: '',
};

const PHASE: ProgramPhase = {
  id: 'phase-1',
  program_id: 'prog-1',
  phase_number: 2,
  name: 'Live Fire',
  requires_manual_advancement: false,
  created_at: '',
  updated_at: '',
};

const DATA: TrainingLinkageData = {
  categories: [
    {
      id: 'cat-ems',
      organization_id: 'org-1',
      name: 'EMS',
      sort_order: 1,
      active: true,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'cat-fire',
      organization_id: 'org-1',
      name: 'Fire',
      sort_order: 2,
      active: true,
      created_at: '',
      updated_at: '',
    },
  ],
  requirements: [
    // Matches the course by explicit course link
    requirement({ id: 'req-cpr', name: 'CPR Renewal', required_courses: ['course-1'] }),
    // Matches by shared category
    requirement({ id: 'req-ems-hours', name: 'EMS Continuing Ed', category_ids: ['cat-ems'] }),
    // Matches nothing — only reachable through the full list
    requirement({ id: 'req-hazmat', name: 'Hazmat Awareness', registry_code: 'NFPA 472' }),
  ],
  programs: [PROGRAM],
  phases: [PHASE],
};

const renderFields = (value: TrainingLinkageValue = {}, selectedCourse?: TrainingCourse) => {
  const onChange = vi.fn();
  render(<TrainingLinkageFields data={DATA} value={value} onChange={onChange} selectedCourse={selectedCourse} />);
  return { onChange };
};

describe('TrainingLinkageFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suggests requirements that explicitly list the selected course', () => {
    renderFields({}, COURSE);

    expect(screen.getByText('This course counts toward:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /CPR Renewal/ })).toBeInTheDocument();
  });

  it('suggests requirements sharing a category with the selected course', () => {
    renderFields({}, COURSE);

    // req-ems-hours is tagged cat-ems, which the course also carries
    expect(screen.getByRole('button', { name: /EMS Continuing Ed/ })).toBeInTheDocument();
  });

  it('does not suggest unrelated requirements', () => {
    renderFields({}, COURSE);

    expect(screen.queryByRole('button', { name: /Hazmat Awareness/ })).not.toBeInTheDocument();
  });

  it('suggests by the chosen category even with no course selected', () => {
    renderFields({ category_id: 'cat-ems' });

    expect(screen.getByText('Requirements in this category:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /EMS Continuing Ed/ })).toBeInTheDocument();
  });

  it('links a requirement when its suggestion chip is tapped', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({}, COURSE);

    await user.click(screen.getByRole('button', { name: /CPR Renewal/ }));

    expect(onChange).toHaveBeenCalledWith({ requirement_id: 'req-cpr' });
  });

  it('hides the suggestion chips once a requirement is linked', () => {
    renderFields({ requirement_id: 'req-cpr' }, COURSE);

    expect(screen.queryByText('This course counts toward:')).not.toBeInTheDocument();
  });

  it('offers every requirement in the dropdown, suggested ones grouped first', () => {
    renderFields({}, COURSE);

    const select = screen.getByLabelText('Requirement');
    // The unsuggested requirement is still reachable through the full list
    expect(select).toHaveTextContent('Hazmat Awareness');
    expect(select).toHaveTextContent('CPR Renewal');
  });

  it('clears the phase when the program changes, so a stale phase cannot survive', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFields({ program_id: 'prog-1', phase_id: 'phase-1' });

    await user.selectOptions(screen.getByLabelText('Training Program'), '');

    expect(onChange).toHaveBeenCalledWith({ program_id: undefined, phase_id: undefined });
  });

  it('offers the phase picker only once a program is chosen', () => {
    renderFields({});
    expect(screen.queryByLabelText('Program Phase')).not.toBeInTheDocument();

    renderFields({ program_id: 'prog-1' });
    expect(screen.getByLabelText('Program Phase')).toBeInTheDocument();
  });

  it('explains that a requirement plus program advances enrolled members', () => {
    renderFields({ program_id: 'prog-1', requirement_id: 'req-cpr' });

    expect(screen.getByText(/advance "CPR Renewal" for members enrolled in Recruit School/)).toBeInTheDocument();
  });

  it('explains the category-only case without promising pipeline progress', () => {
    renderFields({ category_id: 'cat-ems' });

    expect(screen.getByText(/tagged "EMS" and count toward department requirements/)).toBeInTheDocument();
  });

  it('prompts for a program when only a requirement is linked', () => {
    renderFields({ requirement_id: 'req-cpr' });

    expect(screen.getByText(/Also select a training program/)).toBeInTheDocument();
  });

  it('says nothing when no links are set', () => {
    renderFields({});

    expect(screen.queryByText(/Attendance will advance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/count toward department requirements/)).not.toBeInTheDocument();
  });
});
