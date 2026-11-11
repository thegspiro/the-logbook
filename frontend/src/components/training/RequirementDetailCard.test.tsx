import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequirementDetailCard } from './RequirementDetailCard';
import type { RequirementDetail } from '../../types/training';

const base: RequirementDetail = {
  id: 'req-ops',
  name: 'Annual Operations Training',
  frequency: 'annual',
  required_hours: 4,
  completed_hours: 1,
  progress_percentage: 25,
  is_met: false,
  due_date: '2027-01-31',
  days_until_due: 86,
};

const courses: RequirementDetail = {
  ...base,
  requirement_type: 'courses',
  course_checklist: [
    { course_id: 'c1', name: 'Hazmat Awareness', code: 'HM-1', completed: true, completed_on: '2026-03-14' },
    { course_id: 'c2', name: 'Ground Ladders', code: null, completed: false, completed_on: null },
    { course_id: 'c3', name: null, code: null, completed: false, completed_on: null },
  ],
};

describe('RequirementDetailCard', () => {
  // Workflow review W80-9: no session held yet read "0/0 sessions" and
  // "Complete", and counted as met. It is now neither.
  it('says no session has been held yet, rather than 0/0 and Complete', () => {
    render(
      <RequirementDetailCard
        requirement={{
          ...base,
          name: 'Monthly Drill Attendance',
          requirement_type: 'session_attendance',
          required_hours: 0,
          completed_hours: 0,
          progress_percentage: 0,
          is_met: false,
          not_applicable: true,
        }}
        timezone="UTC"
      />
    );

    expect(screen.getByText('No sessions held yet')).toBeInTheDocument();
    expect(screen.getByText('Not graded until a session is held')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\/0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Due:/)).not.toBeInTheDocument();
  });

  it('counts a courses requirement in courses, not hours', () => {
    render(<RequirementDetailCard requirement={courses} timezone="UTC" audience="officer" />);
    expect(screen.getByText('1/4 courses')).toBeInTheDocument();
    expect(screen.queryByText(/hrs/)).not.toBeInTheDocument();
  });

  it('shows no unit for a requirement graded done or not done', () => {
    render(
      <RequirementDetailCard
        requirement={{
          ...base,
          name: 'CPR/BLS',
          requirement_type: 'certification',
          required_hours: 1,
          completed_hours: 0,
        }}
        timezone="UTC"
      />
    );
    expect(screen.getByText('0/1')).toBeInTheDocument();
  });

  it('keeps hours for an hours requirement and for one sent without a type', () => {
    const { rerender } = render(
      <RequirementDetailCard requirement={{ ...base, requirement_type: 'hours', required_hours: 42 }} timezone="UTC" />
    );
    expect(screen.getByText('1/42 hrs')).toBeInTheDocument();
    rerender(<RequirementDetailCard requirement={{ ...base, required_hours: 42 }} timezone="UTC" />);
    expect(screen.getByText('1/42 hrs')).toBeInTheDocument();
  });

  it('lists the required courses behind a toggle, with what is done and when', async () => {
    const user = userEvent.setup();
    render(<RequirementDetailCard requirement={courses} timezone="UTC" audience="officer" />);

    expect(screen.queryByRole('list', { name: 'Required courses' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show required courses (3)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Hide required courses' })).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('list', { name: 'Required courses' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Hazmat AwarenessHM-1Completed 3/14/2026',
      'Ground LaddersNot yet completed',
      'Course no longer in the libraryNot yet completed',
    ]);
  });

  it('offers no course list for any other requirement', () => {
    render(<RequirementDetailCard requirement={{ ...base, requirement_type: 'hours' }} timezone="UTC" />);
    expect(screen.queryByRole('button', { name: /required courses/ })).not.toBeInTheDocument();
  });
});
