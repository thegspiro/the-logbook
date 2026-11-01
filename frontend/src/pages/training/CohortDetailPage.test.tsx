import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderWithRouter } from '../../test/utils';
import { useAuthStore } from '../../stores/authStore';
import type { CourseCohortClass, CourseCohortDetail } from '../../types/training';

const getCohort = vi.fn();
const toastError = vi.fn();

vi.mock('../../services/api', () => ({
  courseCohortService: {
    getCohort: (...args: unknown[]) => getCohort(...args) as unknown,
  },
  inventoryService: {},
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args) as unknown,
    success: vi.fn(),
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

import { CohortDetailPage } from './CohortDetailPage';

const hoseClass: CourseCohortClass = {
  id: 'cl1',
  organization_id: 'org-1',
  cohort_id: 'c1',
  sequence: 1,
  title: 'Hose Handling',
  scheduled_start: '2026-11-02T23:00:00Z',
  scheduled_end: '2026-11-03T02:00:00Z',
  status: 'scheduled',
  counts_toward_certification: true,
  created_at: '2026-10-01T12:00:00Z',
  credit_hours: 3,
  instructor: 'Capt. Rivera',
};

const cohortBase: CourseCohortDetail = {
  id: 'c1',
  organization_id: 'org-1',
  course_id: 'course-1',
  name: 'Recruit School 26-2',
  start_date: '2026-11-02',
  status: 'in_progress',
  date_roll_policy: 'next_business_day',
  requires_rsvp: true,
  auto_create_records: true,
  created_at: '2026-10-01T12:00:00Z',
  course_name: 'Firefighter I',
  class_count: 1,
  member_count: 0,
  classes: [hoseClass],
  members: [],
};

/** The response a member on the roster receives: no roster, no attendance. */
const memberResponse = (): CourseCohortDetail => structuredClone(cohortBase);

/** The response an officer receives: the roster and attendance counts. */
const officerResponse = (): CourseCohortDetail => ({
  ...structuredClone(cohortBase),
  member_count: 1,
  classes: [{ ...structuredClone(hoseClass), rsvp_count: 12, checked_in_count: 0 }],
  members: [
    {
      id: 'm1',
      organization_id: 'org-1',
      cohort_id: 'c1',
      user_id: 'u2',
      status: 'active',
      full_name: 'Dana Classmate',
      display_name: 'Dana Classmate',
      email: 'dana@example.com',
      progress_percentage: 40,
    },
  ],
});

const notFound = () =>
  Object.assign(new Error('Request failed with status code 404'), {
    response: { status: 404, statusText: 'Not Found', data: { detail: 'Cohort not found' } },
  });

const signInWith = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u1', permissions } as never, isAuthenticated: true });
};

const renderPage = () => {
  window.history.pushState({}, '', '/training/cohorts/c1');
  return renderWithRouter(
    <Routes>
      <Route path="/training/cohorts/:cohortId" element={<CohortDetailPage />} />
    </Routes>
  );
};

describe('CohortDetailPage', () => {
  beforeEach(() => {
    getCohort.mockReset();
    toastError.mockReset();
    signInWith([]);
  });

  describe('a member on the roster', () => {
    beforeEach(() => {
      signInWith([]);
      getCohort.mockResolvedValue(memberResponse());
    });

    it('shows the class timeline', async () => {
      renderPage();

      expect(await screen.findByRole('heading', { level: 1, name: 'Recruit School 26-2' })).toBeInTheDocument();
      expect(getCohort).toHaveBeenCalledWith('c1');
      expect(screen.getByRole('heading', { name: 'Class schedule' })).toBeInTheDocument();
      expect(screen.getByText('Hose Handling')).toBeInTheDocument();
      expect(screen.getByText('Capt. Rivera')).toBeInTheDocument();
    });

    it('draws no roster tab and no officer actions', async () => {
      renderPage();
      await screen.findByText('Hose Handling');

      expect(screen.queryByRole('button', { name: /Roster/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Classes \(/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Shift remaining/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reschedule Hose Handling' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel Hose Handling' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add member/ })).not.toBeInTheDocument();
      expect(screen.queryByText('No event')).not.toBeInTheDocument();
      // The officer-only Cohorts list is not offered as a way back.
      expect(screen.queryByRole('link', { name: 'Cohorts' })).not.toBeInTheDocument();
    });
  });

  describe('a training officer', () => {
    beforeEach(() => {
      signInWith(['training.manage']);
      getCohort.mockResolvedValue(officerResponse());
    });

    it('keeps the roster and the class actions', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Hose Handling');

      expect(screen.getByRole('button', { name: 'Reschedule Hose Handling' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Shift remaining/ })).toBeInTheDocument();
      expect(screen.getByText('12 signed up')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Roster (1)' }));
      expect(await screen.findByText('Dana Classmate')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add member/ })).toBeInTheDocument();
    });
  });

  describe('a member not on the roster', () => {
    beforeEach(() => {
      signInWith([]);
      getCohort.mockRejectedValue(notFound());
    });

    it('shows a plain not-found state, with no error toast and no officer view', async () => {
      renderPage();

      expect(await screen.findByText('Cohort not found')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back to My Training' })).toBeInTheDocument();
      expect(screen.queryByText(/Access Denied/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Back to cohorts/ })).not.toBeInTheDocument();
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  it('still reports a failure that is not a 404', async () => {
    getCohort.mockRejectedValue(new Error('Network Error'));
    renderPage();

    expect(await screen.findByText('Cohort not found')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith('Network Error');
  });
});
