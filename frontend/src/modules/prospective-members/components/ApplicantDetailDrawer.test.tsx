import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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
  updateApplicant: vi.fn(),
  getRoles: vi.fn(),
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
    updateApplicant: (...a: unknown[]) => mocks.updateApplicant(...a) as unknown,
  },
  eventLinkService: {
    getLinkedEvents: (...a: unknown[]) => mocks.getLinkedEvents(...a) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  roleService: {
    getRoles: (...a: unknown[]) => mocks.getRoles(...a) as unknown,
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

function renderDrawer(overrides: Partial<Applicant> = {}) {
  return renderWithRouter(
    <ApplicantDetailDrawer
      applicant={{ ...applicant, ...overrides }}
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

describe('ApplicantDetailDrawer skip action', () => {
  // The Required flag was stored and badged in the stage list and read by no
  // logic at all: a stage a department had marked required could be stepped
  // over with two clicks. The server refuses it now; the button says so before
  // the click rather than after it.
  it('offers Skip on a stage that is not required', async () => {
    renderDrawer({ current_stage_required: false });
    await screen.findByText('Stage History');

    expect(screen.getByRole('button', { name: /skip/i })).toBeEnabled();
  });

  it('disables Skip on a required stage and says why', async () => {
    renderDrawer({ current_stage_required: true });
    await screen.findByText('Stage History');

    const skip = screen.getByRole('button', { name: /skip/i });
    expect(skip).toBeDisabled();
    expect(skip).toHaveAttribute('title', expect.stringContaining('Required'));
  });
});

describe('ApplicantDetailDrawer approval status', () => {
  // The panel read the required signers off the last history entry's
  // action_result, where they are never stored, so it said "No approval data
  // recorded yet" to the coordinator after the Chief and the President had
  // both signed (workflow review W16-1).
  const signOff = {
    current_stage_id: 'step-d',
    current_stage_name: 'Officer Sign-Off',
    current_stage_type: 'multi_approval',
    current_stage_config: { required_approvers: ['chief', 'president'], require_notes: false, approval_order: 'any' },
    stage_history: [
      stage({ id: 'a', stage_name: 'Application Received', completed_at: '2026-08-02T14:00:00Z' }),
      stage({
        id: 'd',
        stage_name: 'Officer Sign-Off',
        stage_type: 'multi_approval',
        status: StepProgressStatus.IN_PROGRESS,
        action_result: { approvals: [{ role: 'Chief', approved_by: 'user-chief' }] },
      }),
      // A later stage's row after the current one must not be read instead.
      stage({ id: 'e', stage_name: 'Orientation', status: StepProgressStatus.IN_PROGRESS }),
    ],
  } as unknown as Partial<Applicant>;

  it("lists each required signer from the stage's configuration, with who has signed", async () => {
    renderDrawer(signOff);
    await screen.findByText('Stage History');

    expect(screen.queryByText('No approval data recorded yet.')).not.toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Approval status' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['chiefApproved', 'presidentPending']);
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

describe('ApplicantDetailDrawer contact edit', () => {
  beforeEach(() => {
    mocks.updateApplicant.mockReset();
    mocks.updateApplicant.mockResolvedValue({});
    mocks.getRoles.mockReset();
    mocks.getRoles.mockResolvedValue([]);
  });

  // An edit is an update: the backend reads an omitted key as "leave it
  // alone", so `|| undefined` on an emptied box kept the old phone number,
  // birth date and address behind a "Contact info updated" toast.
  it('sends null for every optional contact field the user empties', async () => {
    const user = userEvent.setup();
    renderDrawer({
      phone: '555-0100',
      date_of_birth: '1990-04-02',
      address: { street: '1 Main St', city: 'Springfield', state: 'IL', zip_code: '62701' },
    });
    await screen.findByText('Stage History');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    for (const label of ['Phone number', 'Date of birth', 'Street address', 'City', 'State', 'ZIP code']) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.updateApplicant).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({
        first_name: 'Riley',
        last_name: 'Bishop',
        email: 'riley.bishop@example.org',
        phone: null,
        date_of_birth: null,
        address: { street: null, city: null, state: null, zip_code: null },
        target_role_id: null,
      })
    );
  });
});
