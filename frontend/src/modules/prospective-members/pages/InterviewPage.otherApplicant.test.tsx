/**
 * MP2-12: the interview page rendered whatever applicant the store held,
 * without checking it was the one in the address. Coming from another
 * applicant's page, the previous applicant showed; if this applicant's fetch
 * then failed (a 403 after being unassigned), the previous applicant stayed on
 * screen and the interview form posted to their id. The page now shows only
 * the applicant it was opened for, and an error rather than a spinner when it
 * cannot load them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { Applicant, Interview } from '../types';

const mocks = vi.hoisted(() => ({
  createInterview: vi.fn(),
  updateInterview: vi.fn(),
  deleteInterview: vi.fn(),
  fetchApplicant: vi.fn(),
  fetchInterviews: vi.fn(),
  getMyAccess: vi.fn(),
  getInterviewRequirement: vi.fn(),
  storeState: {},
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ applicantId: 'app-2' }) };
});

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: () => mocks.storeState,
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'user-1', timezone: 'UTC' } }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// The page mounts FollowUpAnswersPanel, which lists the applicant's
// follow-up forms; none are submitted here, so it renders nothing.
vi.mock('../services/api', () => ({
  followUpFormService: {
    list: () => Promise.resolve([]),
    getInterviewAnswers: () => Promise.resolve(null),
  },
  applicantService: {
    getMyAccess: (...a: unknown[]) => mocks.getMyAccess(...a) as unknown,
    getInterviewRequirement: (...a: unknown[]) => mocks.getInterviewRequirement(...a) as unknown,
  },
}));

// A coordinator, who may log an interview for any applicant they can see.
const coordinatorAccess = {
  roles: [],
  view_all: true,
  can_work: true,
  can_manage: true,
  can_see_full: true,
  can_log_interview: true,
  interviewer_title: null,
};

import { InterviewPage } from './InterviewPage';

const previous = {
  id: 'app-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  email: 'riley.bishop@example.org',
  status: 'active',
  created_at: '2026-08-01T14:00:00Z',
  stage_history: [],
} as unknown as Applicant;

describe('InterviewPage opened for a different applicant', () => {
  beforeEach(() => {
    mocks.getMyAccess.mockReset();
    mocks.getMyAccess.mockResolvedValue(coordinatorAccess);
    mocks.getInterviewRequirement.mockReset();
    mocks.getInterviewRequirement.mockResolvedValue(null);
  });

  it("never shows the last applicant's page, and says why this one did not load", async () => {
    mocks.storeState = {
      currentApplicant: previous,
      isLoadingApplicant: false,
      interviews: [] as Interview[],
      isLoadingInterviews: false,
      fetchApplicant: mocks.fetchApplicant,
      fetchInterviews: mocks.fetchInterviews,
      error: 'You do not have access to this applicant',
    };
    renderWithRouter(<InterviewPage />);

    expect(await screen.findByText('You do not have access to this applicant')).toBeInTheDocument();
    expect(screen.queryByText(/Interview: Riley Bishop/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Interview/ })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchApplicant).toHaveBeenCalledWith('app-2'));
  });
});
