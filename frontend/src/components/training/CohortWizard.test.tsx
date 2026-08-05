/**
 * Tests for the cohort generation wizard.
 *
 * The preview step is what these protect: an officer must see every computed
 * date (and any that had to move) before fifteen events land on the department
 * calendar, and the edits they make there must reach the generate call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPreviewSchedule = vi.fn();
const mockCreateCohort = vi.fn();
const mockGetCourses = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../../services/api', () => ({
  courseCohortService: {
    previewSchedule: (...args: unknown[]) =>
      mockPreviewSchedule(...args) as unknown,
    createCohort: (...args: unknown[]) => mockCreateCohort(...args) as unknown,
  },
  trainingService: {
    getCourses: (...args: unknown[]) => mockGetCourses(...args) as unknown,
  },
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
  },
}));

import { CohortWizard } from './CohortWizard';

const course = {
  id: 'course-1',
  organization_id: 'org-1',
  name: 'Recruit School',
  training_type: 'orientation' as const,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const preview = {
  course_id: 'course-1',
  course_name: 'Recruit School',
  start_date: '2026-09-08',
  timezone: 'America/New_York',
  suggested_blackout_dates: ['2026-11-26'],
  warnings: [],
  classes: [
    {
      course_class_id: 'cc1',
      sequence: 1,
      title: 'Orientation',
      scheduled_start: '2026-09-08T23:00:00Z',
      scheduled_end: '2026-09-09T02:00:00Z',
      warnings: [],
    },
    {
      course_class_id: 'cc2',
      sequence: 2,
      title: 'SCBA Operations',
      scheduled_start: '2026-09-09T23:00:00Z',
      scheduled_end: '2026-09-10T02:00:00Z',
      warnings: ['Moved from 2026-09-12 to 2026-09-14 — 2026-09-12 is a weekend.'],
    },
  ],
};

const advanceTo = async (
  user: ReturnType<typeof userEvent.setup>,
  step: 'schedule' | 'preview',
) => {
  await user.selectOptions(screen.getByLabelText('Course'), 'course-1');
  await user.click(screen.getByRole('button', { name: /Next/i }));
  if (step === 'preview') {
    await user.click(screen.getByRole('button', { name: /Next/i }));
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCourses.mockResolvedValue([course]);
  mockGetUsers.mockResolvedValue([
    { id: 'u1', first_name: 'Dana', last_name: 'Reyes', email: 'dana@fd.org' },
  ]);
  mockPreviewSchedule.mockResolvedValue(preview);
});

describe('CohortWizard', () => {
  it('starts on the course step with the loaded courses', async () => {
    render(<CohortWizard onComplete={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: /Recruit School/ })).toBeInTheDocument();
  });

  it('requires a course before advancing', async () => {
    const user = userEvent.setup();
    render(<CohortWizard onComplete={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Still on step one — no preview was requested.
    expect(mockPreviewSchedule).not.toHaveBeenCalled();
  });

  it('previews the schedule when leaving the schedule step', async () => {
    const user = userEvent.setup();
    render(<CohortWizard onComplete={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });
    await advanceTo(user, 'preview');

    await waitFor(() => {
      expect(mockPreviewSchedule).toHaveBeenCalledTimes(1);
    });
    const call = mockPreviewSchedule.mock.calls[0]?.[0] as {
      course_id: string;
      date_roll_policy: string;
    };
    expect(call.course_id).toBe('course-1');
    expect(call.date_roll_policy).toBe('none');
  });

  it('shows every computed class, and surfaces dates that had to move', async () => {
    const user = userEvent.setup();
    render(<CohortWizard onComplete={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });
    await advanceTo(user, 'preview');

    await waitFor(() => {
      expect(screen.getByText('Orientation')).toBeInTheDocument();
    });
    expect(screen.getByText('SCBA Operations')).toBeInTheDocument();
    // The roll warning must be visible before anything is created.
    expect(
      screen.getByText(/Moved from 2026-09-12 to 2026-09-14/),
    ).toBeInTheDocument();
  });

  it('offers the holidays inside the course span as blackout dates', async () => {
    const user = userEvent.setup();
    render(<CohortWizard onComplete={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });
    await advanceTo(user, 'preview');

    await waitFor(() => {
      expect(screen.getByText('Holidays in this range')).toBeInTheDocument();
    });
  });

  it('skipping a class removes it from the generated count', async () => {
    const user = userEvent.setup();
    render(<CohortWizard onComplete={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });
    await advanceTo(user, 'preview');

    await waitFor(() => {
      expect(screen.getByText(/2 classes from/)).toBeInTheDocument();
    });

    const skipBoxes = screen.getAllByLabelText('Skip this class');
    await user.click(skipBoxes[0] as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText(/1 class from/)).toBeInTheDocument();
    });
  });

  it('sends skip overrides and the roster to the generate call', async () => {
    mockCreateCohort.mockResolvedValue({ id: 'co1', classes: [{ id: 'x' }] });
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<CohortWizard onComplete={onComplete} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });
    await advanceTo(user, 'preview');

    await waitFor(() => {
      expect(screen.getByText('Orientation')).toBeInTheDocument();
    });

    const skipBoxes = screen.getAllByLabelText('Skip this class');
    await user.click(skipBoxes[1] as HTMLElement);

    // Preview -> Roster
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() => {
      expect(screen.getByText(/Dana/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('checkbox', { name: /Dana/i }));

    // Roster -> Confirm
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await user.click(screen.getByRole('button', { name: /Generate 1 class/i }));

    await waitFor(() => {
      expect(mockCreateCohort).toHaveBeenCalledTimes(1);
    });
    const payload = mockCreateCohort.mock.calls[0]?.[0] as {
      classes?: { course_class_id: string; skip: boolean }[];
      member_user_ids?: string[];
      course_id: string;
    };
    expect(payload.course_id).toBe('course-1');
    expect(payload.classes).toEqual([
      { course_class_id: 'cc2', skip: true, scheduled_start: undefined, scheduled_end: undefined },
    ]);
    expect(payload.member_user_ids).toEqual(['u1']);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels out of the wizard from the first step', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<CohortWizard onComplete={vi.fn()} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Course')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
