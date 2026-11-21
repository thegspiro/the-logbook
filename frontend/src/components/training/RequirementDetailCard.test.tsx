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
  // Shift and call targets round down, so leave can bring one to zero. That
  // is met, and reads as nothing owed rather than 0/0.
  it('says nothing is owed when leave rounds a shift target down to zero', () => {
    render(
      <RequirementDetailCard
        requirement={{
          ...base,
          name: 'Shift Coverage',
          requirement_type: 'shifts',
          required_hours: 0,
          original_required_hours: 3,
          completed_hours: 0,
          progress_percentage: 100,
          is_met: true,
          waived_months: 11,
          leave_months: 11,
          active_months: 1,
        }}
        timezone="UTC"
      />
    );
    expect(screen.getByText('Nothing owed (on leave)')).toBeInTheDocument();
    expect(screen.queryByText(/0\/0/)).not.toBeInTheDocument();
    expect(screen.getByText(/so nothing is owed for this period/)).toBeInTheDocument();
  });

  it('still shows the count when a reduced target is above zero', () => {
    render(
      <RequirementDetailCard
        requirement={{
          ...base,
          name: 'Shift Coverage',
          requirement_type: 'shifts',
          required_hours: 2,
          original_required_hours: 3,
          completed_hours: 1,
          waived_months: 3,
          leave_months: 3,
          active_months: 9,
        }}
        timezone="UTC"
      />
    );
    expect(screen.queryByText('Nothing owed (on leave)')).not.toBeInTheDocument();
    expect(screen.getByText(/adjusted to 2 shifts for 9 active months/)).toBeInTheDocument();
  });

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

  // A certification reads by state and date instead (see "a certification").
  it('shows no unit for a requirement graded done or not done', () => {
    render(
      <RequirementDetailCard
        requirement={{
          ...base,
          name: 'Ladder Skills Check',
          requirement_type: 'skills_evaluation',
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

  describe('an hours requirement', () => {
    const hours: RequirementDetail = {
      ...base,
      name: 'Annual Training Hours',
      requirement_type: 'hours',
      required_hours: 72,
      original_required_hours: 72,
      completed_hours: 83.25,
      progress_percentage: 100,
      is_met: true,
      due_date: null,
      days_until_due: null,
      window_months: 12,
      monthly_average: 6.94,
      monthly_needed: 6,
      monthly_hours: [
        { month: '2026-10', hours: 6.94, waived: false },
        { month: '2026-11', hours: 6.94, waived: false },
      ],
    };

    it('leads with the monthly average and keeps the total underneath', () => {
      render(<RequirementDetailCard requirement={hours} timezone="UTC" />);
      expect(screen.getByText('6.9/6 hrs/mo avg')).toBeInTheDocument();
      expect(screen.getByText('Averaging 6.9 hours a month of 6 needed')).toBeInTheDocument();
      expect(screen.getByText('83.25/72 hrs total')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    it('shows the server average in the monthly panel too', async () => {
      const user = userEvent.setup();
      // The two rows average 6.94, but the server's figure is what prints.
      render(<RequirementDetailCard requirement={{ ...hours, monthly_average: 7.2 }} timezone="UTC" />);
      await user.click(screen.getByRole('button', { name: /show monthly hours/i }));
      expect(screen.getByText(/average 7\.2 hrs\/month/)).toBeInTheDocument();
      expect(screen.getByText('7.2/6 hrs/mo avg')).toBeInTheDocument();
    });

    it('shows the total alone when the server sends no average', () => {
      render(<RequirementDetailCard requirement={{ ...hours, monthly_average: null }} timezone="UTC" />);
      expect(screen.getByText('83.25/72 hrs')).toBeInTheDocument();
      expect(screen.queryByText(/hrs\/mo avg/)).not.toBeInTheDocument();
      expect(screen.queryByText(/total$/)).not.toBeInTheDocument();
    });
  });

  describe('a certification', () => {
    const cpr: RequirementDetail = {
      ...base,
      name: 'CPR/BLS Certification',
      requirement_type: 'certification',
      frequency: 'biannual',
      training_type: 'certification',
      required_hours: 1,
      original_required_hours: 1,
      completed_hours: 1,
      progress_percentage: 100,
      is_met: true,
      due_date: null,
      days_until_due: null,
      expiry_date: '2027-03-14',
    };

    it('reads as on file with its expiry, not 1/1', () => {
      render(<RequirementDetailCard requirement={cpr} timezone="UTC" />);
      expect(screen.getByText('On file')).toBeInTheDocument();
      expect(screen.getByText('(Expires Mar 14, 2027)')).toBeInTheDocument();
      expect(screen.queryByText(/1\/1/)).not.toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    it('reads as on file alone when the certificate never expires', () => {
      render(<RequirementDetailCard requirement={{ ...cpr, expiry_date: null }} timezone="UTC" />);
      expect(screen.getByText('On file')).toBeInTheDocument();
      expect(screen.queryByText(/Expires/)).not.toBeInTheDocument();
    });

    it('says when a lapsed certificate expired, not 0/1', () => {
      render(
        <RequirementDetailCard
          requirement={{
            ...cpr,
            completed_hours: 0,
            progress_percentage: 0,
            is_met: false,
            cert_expired: true,
            blocks_activity: true,
            expiry_date: '2026-03-14',
          }}
          timezone="UTC"
        />
      );
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByText('(Mar 14, 2026)')).toBeInTheDocument();
      expect(screen.queryByText(/0\/1/)).not.toBeInTheDocument();
      expect(screen.getByText(/Certification expired — renew ASAP/)).toBeInTheDocument();
    });

    it('says not recorded when nothing is on file, rather than expired', () => {
      render(
        <RequirementDetailCard
          requirement={{
            ...cpr,
            completed_hours: 0,
            progress_percentage: 0,
            is_met: false,
            cert_expired: true,
            blocks_activity: true,
            expiry_date: null,
          }}
          timezone="UTC"
          audience="officer"
        />
      );
      expect(screen.getAllByText('Not recorded')).toHaveLength(2);
      expect(screen.getByText(/No certification on file\. This may prevent the member/)).toBeInTheDocument();
      expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
    });
  });

  describe('an optional requirement', () => {
    it('does not colour a missing optional certificate as a failure', () => {
      render(
        <RequirementDetailCard
          requirement={{
            ...base,
            name: 'Hazmat Technician',
            requirement_type: 'certification',
            required_hours: 1,
            completed_hours: 0,
            progress_percentage: 0,
            expiry_date: null,
          }}
          timezone="UTC"
          optional
        />
      );
      expect(screen.getByText('Not recorded')).toHaveClass('text-theme-text-primary');
    });

    it('carries an Optional badge and no overdue wording, however late', () => {
      render(
        <RequirementDetailCard
          requirement={{ ...base, name: 'Rope Rescue', due_date: '2026-01-31', days_until_due: -40 }}
          timezone="UTC"
          optional
        />
      );
      expect(screen.getByText('Optional')).toBeInTheDocument();
      expect(screen.getByText('Not required for compliance')).toBeInTheDocument();
      expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
    });

    it('still reads Complete once met', () => {
      render(
        <RequirementDetailCard
          requirement={{ ...base, is_met: true, completed_hours: 4, progress_percentage: 100 }}
          timezone="UTC"
          optional
        />
      );
      expect(screen.getByText('Complete')).toBeInTheDocument();
      expect(screen.queryByText('Not required for compliance')).not.toBeInTheDocument();
    });
  });
});
