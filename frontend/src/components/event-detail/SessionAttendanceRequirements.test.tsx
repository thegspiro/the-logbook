import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSet = vi.fn();
vi.mock('../../services/api', () => ({
  trainingSessionService: {
    setAttendanceRequirements: (...args: unknown[]) => mockSet(...args) as unknown,
  },
}));

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
  const onChange = vi.fn();

  beforeEach(() => {
    mockSet.mockReset();
    onChange.mockReset();
  });

  it('names the requirements a linked session counts toward', () => {
    render(
      <SessionAttendanceRequirements
        session={session(['active'])}
        requirements={REQUIREMENTS}
        canManage={false}
        onChange={onChange}
      />
    );

    expect(screen.getByText('Company drills — active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  it('calls an unlinked session optional, including from a backend without the field', () => {
    render(
      <SessionAttendanceRequirements
        session={session()}
        requirements={REQUIREMENTS}
        canManage={false}
        onChange={onChange}
      />
    );

    expect(screen.getByText('Optional: not counted against anyone.')).toBeInTheDocument();
  });

  it('offers only attendance requirements and saves the whole set', async () => {
    const updated = session(['active', 'senior']);
    mockSet.mockResolvedValue(updated);
    const user = userEvent.setup();
    render(
      <SessionAttendanceRequirements
        session={session(['active'])}
        requirements={REQUIREMENTS}
        canManage
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.queryByRole('checkbox', { name: /Annual hours/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /senior/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSet).toHaveBeenCalledWith('ses-1', ['active', 'senior']);
    expect(onChange).toHaveBeenCalledWith(updated);
  });

  it('shows why a save was refused and keeps the editor open', async () => {
    mockSet.mockRejectedValue(new Error('Invalid attendance requirement'));
    const user = userEvent.setup();
    render(
      <SessionAttendanceRequirements
        session={session(['active'])}
        requirements={REQUIREMENTS}
        canManage
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('checkbox', { name: /active/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSet).toHaveBeenCalledWith('ses-1', []);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid attendance requirement');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders nothing where the department has no attendance requirement', () => {
    const { container } = render(
      <SessionAttendanceRequirements
        session={session()}
        requirements={[REQUIREMENTS[2] ?? requirement({})]}
        canManage
        onChange={onChange}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
