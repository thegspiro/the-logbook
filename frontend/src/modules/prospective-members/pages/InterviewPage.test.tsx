/**
 * Editing an interview is an update: the backend dumps the payload with
 * `exclude_unset`, so an omitted key means "leave this alone". The form used
 * `|| undefined` for both create and edit, so emptying the notes on an
 * existing interview said "Interview updated" and the old notes came back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    getAnswers: () => Promise.resolve(null),
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

const applicant = {
  id: 'app-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  email: 'riley.bishop@example.org',
  status: 'active',
  created_at: '2026-08-01T14:00:00Z',
  stage_history: [],
} as unknown as Applicant;

const interview: Interview = {
  id: 'iv-1',
  prospect_id: 'app-1',
  interviewer_id: 'user-1',
  interviewer_name: 'Ira Viewer',
  interviewer_role: 'Chief',
  notes: 'Strong candidate',
  recommendation: 'recommend',
  recommendation_notes: 'Keep an eye on availability',
  created_at: '2026-08-10T14:00:00Z',
  updated_at: '2026-08-10T14:00:00Z',
};

describe('InterviewPage interview form', () => {
  beforeEach(() => {
    for (const fn of [
      mocks.createInterview,
      mocks.updateInterview,
      mocks.deleteInterview,
      mocks.fetchApplicant,
      mocks.fetchInterviews,
    ]) {
      fn.mockReset();
      fn.mockResolvedValue(undefined);
    }
    mocks.getMyAccess.mockReset();
    mocks.getMyAccess.mockResolvedValue(coordinatorAccess);
    mocks.getInterviewRequirement.mockReset();
    mocks.getInterviewRequirement.mockResolvedValue(null);
    mocks.storeState = {
      currentApplicant: applicant,
      isLoadingApplicant: false,
      interviews: [interview],
      isLoadingInterviews: false,
      fetchApplicant: mocks.fetchApplicant,
      fetchInterviews: mocks.fetchInterviews,
      createInterview: mocks.createInterview,
      updateInterview: mocks.updateInterview,
      deleteInterview: mocks.deleteInterview,
      error: null,
    };
  });

  it('sends null for each field emptied on an edit', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InterviewPage />);

    await user.click(screen.getByTitle('Edit interview'));
    await user.clear(screen.getByPlaceholderText(/Provide additional context/));
    await user.clear(screen.getByPlaceholderText(/Record your observations/));
    await user.clear(screen.getByPlaceholderText(/Membership Coordinator/));
    await user.selectOptions(screen.getByRole('combobox'), '');
    await user.click(screen.getByRole('button', { name: 'Update Interview' }));

    await waitFor(() => {
      expect(mocks.updateInterview).toHaveBeenCalledWith('iv-1', {
        notes: null,
        recommendation: null,
        recommendation_notes: null,
        interviewer_role: null,
      });
    });
  });

  it('still omits blank fields when submitting a new interview', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InterviewPage />);

    // Offered once the page has the caller's access for this applicant.
    await user.click(await screen.findByRole('button', { name: 'New Interview' }));
    await user.type(screen.getByPlaceholderText(/Record your observations/), 'First impressions');
    await user.click(screen.getByRole('button', { name: 'Submit Interview' }));

    await waitFor(() => {
      expect(mocks.createInterview).toHaveBeenCalledWith('app-1', {
        notes: 'First impressions',
        recommendation: undefined,
        recommendation_notes: undefined,
        interviewer_role: undefined,
      });
    });
  });
});

describe('InterviewPage for an interviewer holding an office', () => {
  beforeEach(() => {
    for (const fn of [mocks.createInterview, mocks.fetchApplicant, mocks.fetchInterviews]) {
      fn.mockReset();
      fn.mockResolvedValue(undefined);
    }
    mocks.getMyAccess.mockReset();
    mocks.getMyAccess.mockResolvedValue({ ...coordinatorAccess, interviewer_title: 'Fire Chief' });
    mocks.getInterviewRequirement.mockReset();
    mocks.getInterviewRequirement.mockResolvedValue({
      step_id: 'step-b',
      required_count: 2,
      recorded_count: 1,
      required_recommendation: null,
      recommendation_met: null,
      positions: [
        { position: 'fire_chief', label: 'Fire Chief', satisfied: true },
        { position: 'board_of_directors', label: 'Board of Directors', satisfied: false },
      ],
      complete: false,
    });
    mocks.storeState = {
      currentApplicant: applicant,
      isLoadingApplicant: false,
      interviews: [],
      isLoadingInterviews: false,
      fetchApplicant: mocks.fetchApplicant,
      fetchInterviews: mocks.fetchInterviews,
      createInterview: mocks.createInterview,
      updateInterview: mocks.updateInterview,
      deleteInterview: mocks.deleteInterview,
      error: null,
    };
  });

  it('offers their position as the title, and they can change it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InterviewPage />);

    await user.click(await screen.findByRole('button', { name: 'New Interview' }));
    const title = screen.getByPlaceholderText(/Membership Coordinator/);
    expect(title).toHaveValue('Fire Chief');

    await user.clear(title);
    await user.type(title, 'Acting Chief');
    await user.click(screen.getByRole('button', { name: 'Submit Interview' }));

    await waitFor(() => {
      expect(mocks.createInterview).toHaveBeenCalledWith('app-1', {
        notes: undefined,
        recommendation: undefined,
        recommendation_notes: undefined,
        interviewer_role: 'Acting Chief',
      });
    });
  });

  it('shows which required positions have interviewed', async () => {
    renderWithRouter(<InterviewPage />);

    const panel = await screen.findByRole('region', { name: 'Interview requirement' });
    expect(mocks.getInterviewRequirement).toHaveBeenCalledWith('app-1');
    expect(panel).toHaveTextContent('1 of 2 interviews recorded');
    expect(panel).toHaveTextContent('Interview by Fire ChiefDone');
    expect(panel).toHaveTextContent('Interview by Board of DirectorsMissing');
    expect(panel).toHaveTextContent('In progress');
  });

  it('re-reads the requirement after an interview is submitted', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InterviewPage />);

    await screen.findByRole('region', { name: 'Interview requirement' });
    await user.click(await screen.findByRole('button', { name: 'New Interview' }));
    await user.type(screen.getByPlaceholderText(/Record your observations/), 'Met with the board');
    await user.click(screen.getByRole('button', { name: 'Submit Interview' }));

    await waitFor(() => expect(mocks.createInterview).toHaveBeenCalled());
    await waitFor(() => expect(mocks.getInterviewRequirement).toHaveBeenCalledTimes(2));
  });
});
