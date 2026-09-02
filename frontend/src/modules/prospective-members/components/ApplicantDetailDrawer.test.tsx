import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { ApplicantDetailDrawer } from './ApplicantDetailDrawer';
import type { Applicant, StageHistoryEntry } from '../types';
import { StepProgressStatus } from '../types';

const mocks = vi.hoisted(() => ({
  storeState: {
    isLoadingApplicant: false,
    fetchApplicant: vi.fn(),
    fetchApplicants: vi.fn(),
    fetchElectionPackage: vi.fn(),
    currentElectionPackage: null,
  },
  getDocuments: vi.fn(),
  getActivity: vi.fn(),
  getLinkedEvents: vi.fn(),
}));

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: Object.assign(() => mocks.storeState, {
    getState: () => mocks.storeState,
  }),
}));

vi.mock('../services/api', () => ({
  applicantService: {
    getDocuments: (...a: unknown[]) => mocks.getDocuments(...a) as unknown,
    getActivity: (...a: unknown[]) => mocks.getActivity(...a) as unknown,
  },
  eventLinkService: {
    getLinkedEvents: (...a: unknown[]) => mocks.getLinkedEvents(...a) as unknown,
  },
}));

function stage(overrides: Partial<StageHistoryEntry> & { id: string; stage_name: string }): StageHistoryEntry {
  return {
    stage_id: `step-${overrides.id}`,
    stage_type: 'manual_approval',
    status: StepProgressStatus.COMPLETED,
    entered_at: '2026-08-01T14:00:00Z',
    artifacts: [],
    ...overrides,
  };
}

// Application Received completed, Background Check skipped by a coordinator
// (the backend stamps `completed_at` and moves the pointer on), Interview
// current.
const applicant = {
  id: 'app-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  email: 'riley.bishop@example.org',
  status: 'active',
  target_membership_type: 'active',
  created_at: '2026-08-01T14:00:00Z',
  current_stage_id: 'step-c',
  current_stage_name: 'Interview',
  total_stages: 4,
  stage_history: [
    stage({ id: 'a', stage_name: 'Application Received', completed_at: '2026-08-02T14:00:00Z' }),
    stage({
      id: 'b',
      stage_name: 'Background Check',
      status: StepProgressStatus.SKIPPED,
      completed_at: '2026-08-04T14:00:00Z',
    }),
    stage({ id: 'c', stage_name: 'Interview', status: StepProgressStatus.IN_PROGRESS }),
  ],
} as unknown as Applicant;

function renderDrawer() {
  return renderWithRouter(
    <ApplicantDetailDrawer
      applicant={applicant}
      isOpen
      onClose={vi.fn()}
      onConvert={vi.fn()}
      isLastStage={false}
      isFirstStage={false}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDocuments.mockResolvedValue([]);
  mocks.getActivity.mockResolvedValue([]);
  mocks.getLinkedEvents.mockResolvedValue([]);
});

describe('ApplicantDetailDrawer stage progress', () => {
  // The strip matched COMPLETED only, so a stage the coordinator deliberately
  // skipped drew as a muted unreached bubble — while the timeline right below
  // it showed the completion stamp the skip had written.
  it('shows a skipped stage as visited in the progress strip, not unreached', async () => {
    renderDrawer();
    // The child sections resolve their own fetches on mount; settle them here
    // so their state updates land inside act().
    await screen.findByText('Stage History');

    expect(screen.getByTitle('Background Check (Skipped)')).toBeInTheDocument();
    expect(screen.queryByTitle('Background Check')).not.toBeInTheDocument();
    // The other two states keep their own labels.
    expect(screen.getByTitle('Application Received (Complete)')).toBeInTheDocument();
    expect(screen.getByTitle('Interview (Current)')).toBeInTheDocument();
  });

  it('names the skipped state in the timeline rather than calling it completed', async () => {
    renderDrawer();

    const heading = await screen.findByText('Stage History');
    // Asserted on the labels, not on formatted dates: the timestamps render in
    // the running timezone, which differs between a laptop and CI.
    const text = heading.parentElement?.textContent ?? '';
    expect(text).toContain('· Skipped');
    // Exactly one stage genuinely completed; the skipped one must not claim it.
    expect(text.match(/· Completed/g) ?? []).toHaveLength(1);
  });

  // A skip is not work done: it stays out of the completion count.
  it('counts only completed stages in the progress summary', async () => {
    renderDrawer();
    await screen.findByText('Stage History');

    expect(screen.getByText(/1 of 4 stages completed/)).toBeInTheDocument();
  });
});

describe('ApplicantDetailDrawer activity log', () => {
  // The reason for a rejection, hold or withdrawal is recorded in the activity
  // entry rather than written over the coordinator's notes, which is where it
  // used to land. The activity log is therefore the only place it can be read,
  // and it rendered nothing but the action name and timestamp.
  it('shows the reason recorded with a status change', async () => {
    mocks.getActivity.mockResolvedValue([
      {
        id: 'act-1',
        prospect_id: 'app-1',
        action: 'prospect_status_changed',
        details: { from: 'active', to: 'rejected', reason: 'Failed the agility test', bulk: false },
        performed_by: 'u-1',
        performer_name: 'Dana Cole',
        created_at: '2026-08-20T14:00:00Z',
      },
    ]);
    renderDrawer();
    await screen.findByText('Stage History');

    await userEvent.click(screen.getByText('Activity Log'));

    expect(await screen.findByText(/Failed the agility test/)).toBeInTheDocument();
    expect(screen.getByText(/active → rejected/)).toBeInTheDocument();
    expect(screen.getByText(/by Dana Cole/)).toBeInTheDocument();
  });

  it('renders an entry whose details are missing or malformed', async () => {
    // `details` is unvalidated JSON: a bad value must degrade to "no detail to
    // show" rather than taking the drawer down.
    mocks.getActivity.mockResolvedValue([
      {
        id: 'act-2',
        prospect_id: 'app-1',
        action: 'prospect_advanced',
        details: null,
        performed_by: 'u-1',
        performer_name: 'Dana Cole',
        created_at: '2026-08-20T14:00:00Z',
      },
      {
        id: 'act-3',
        prospect_id: 'app-1',
        action: 'prospect_status_changed',
        details: { reason: 42, from: [], to: null },
        performed_by: 'u-1',
        performer_name: '',
        created_at: '2026-08-21T14:00:00Z',
      },
    ]);
    renderDrawer();
    await screen.findByText('Stage History');

    await userEvent.click(screen.getByText('Activity Log'));

    expect(await screen.findByText(/prospect advanced/)).toBeInTheDocument();
    expect(screen.getByText(/prospect status changed/)).toBeInTheDocument();
  });
});
