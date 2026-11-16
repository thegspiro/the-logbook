/**
 * The event page's read-only list of the attendance requirements a session
 * counts toward. The links are changed in the training form now ("Edit
 * training details"), so the list has no editor of its own.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import SessionAttendanceRequirements from './SessionAttendanceRequirements';
import type { TrainingSessionResponse } from '../../services/api';
import type { TrainingRequirement } from '../../types/training';

const requirement = (overrides: Partial<TrainingRequirement>): TrainingRequirement => ({
  id: 'req-x',
  organization_id: 'org-1',
  name: 'Requirement',
  requirement_type: 'session_attendance',
  source: 'department',
  frequency: 'annual',
  year: 2026,
  applies_to_all: true,
  due_date_type: 'calendar_period',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const REQUIREMENTS = [
  requirement({ id: 'active', name: 'Company drills — active', required_attendance_pct: 60 }),
  requirement({ id: 'senior', name: 'Company drills — senior', required_attendance_pct: 30 }),
  requirement({ id: 'hours', name: 'Annual hours', requirement_type: 'hours' }),
];

const session = (attendance_requirement_ids?: string[]): TrainingSessionResponse => ({
  id: 'ses-1',
  organization_id: 'org-1',
  event_id: 'ev-1',
  course_name: 'Company Drill',
  training_type: 'continuing_education',
  credit_hours: 2,
  issues_certification: false,
  counts_toward_certification: true,
  auto_create_records: true,
  require_completion_confirmation: false,
  approval_deadline_days: 7,
  is_finalized: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...(attendance_requirement_ids ? { attendance_requirement_ids } : {}),
});

describe('SessionAttendanceRequirements', () => {
  it('names the requirements a linked session counts toward, with their percentage', () => {
    render(<SessionAttendanceRequirements session={session(['active'])} requirements={REQUIREMENTS} />);

    expect(screen.getByText('Company drills — active (60%)')).toBeInTheDocument();
    expect(screen.queryByText(/senior/)).not.toBeInTheDocument();
  });

  // The editor moved to the training form; nothing here changes the links.
  it('offers no way to change them', () => {
    render(<SessionAttendanceRequirements session={session(['active'])} requirements={REQUIREMENTS} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('says an unlinked session is graded against none, including from a backend without the field', () => {
    render(<SessionAttendanceRequirements session={session()} requirements={REQUIREMENTS} />);

    expect(screen.getByText('None: this session is not graded against an attendance requirement.')).toBeInTheDocument();
  });

  it('names a linked requirement that is no longer active', () => {
    render(<SessionAttendanceRequirements session={session(['retired'])} requirements={REQUIREMENTS} />);

    expect(screen.getByText('A requirement no longer active')).toBeInTheDocument();
  });

  it('says a session linked only to inactive requirements counts against no one', () => {
    render(
      <SessionAttendanceRequirements
        session={session(['retired'])}
        requirements={REQUIREMENTS}
        retiredNames={{ retired: 'Legacy drills' }}
      />
    );

    expect(screen.getByText('Legacy drills (no longer active)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'That requirement is no longer active, so this session counts against no one and members cannot ask to be ' +
        'excused from it.'
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(/Edit training details/);
  });

  it('tells a manager how to fix an inactive link beside an active one', () => {
    render(
      <SessionAttendanceRequirements session={session(['active', 'retired'])} requirements={REQUIREMENTS} canManage />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'The requirement no longer active counts this session against no one. Use Edit training details to link an ' +
        'active requirement or untick the one no longer active.'
    );
  });

  it('adds no notice when every link is active', () => {
    render(<SessionAttendanceRequirements session={session(['active'])} requirements={REQUIREMENTS} canManage />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing where the department has no attendance requirement', () => {
    const { container } = render(
      <SessionAttendanceRequirements session={session()} requirements={[REQUIREMENTS[2] ?? requirement({})]} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
