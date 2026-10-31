import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { ApplicantDetailDialog } from './ApplicantDetailDialog';
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
    // These tests describe a coordinator, who may do everything; what an
    // assigned case manager or interviewer sees is ApplicantDetailDialog.access.test.tsx.
    getMyAccess: () =>
      Promise.resolve({
        roles: [],
        view_all: true,
        can_work: true,
        can_manage: true,
        can_see_full: true,
        can_log_interview: true,
      }),
  },
  // The dialog mounts the Assigned section, which lists on open; an applicant
  // nobody is assigned to shows only the assign form.
  assignmentService: {
    list: () => Promise.resolve([]),
    add: () => Promise.resolve(null),
    remove: () => Promise.resolve(),
  },
  eventLinkService: {
    getLinkedEvents: (...a: unknown[]) => mocks.getLinkedEvents(...a) as unknown,
  },
  // The dialog mounts FollowUpFormsSection, which lists on open; an applicant
  // with no follow-up forms renders nothing, so these tests are unaffected.
  followUpFormService: {
    list: () => Promise.resolve([]),
    send: () => Promise.resolve(null),
    reviewContactChange: () => Promise.resolve(null),
  },
}));

vi.mock('../../../services/api', () => ({
  roleService: {
    getRoles: (...a: unknown[]) => mocks.getRoles(...a) as unknown,
  },
  userService: {
    getUsers: () => Promise.resolve([]),
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
    <ApplicantDetailDialog
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

describe('ApplicantDetailDialog stage progress', () => {
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

describe('ApplicantDetailDialog skip action', () => {
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

describe('ApplicantDetailDialog approval status', () => {
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
    expect(rows.map((r) => r.textContent)).toEqual(['ChiefApproved', 'PresidentPending']);
  });

  it('names each signer by the office label the step response carries, not the stored key', async () => {
    renderDrawer({
      ...signOff,
      current_stage_config: {
        required_approvers: ['ems_supply_officer', ' hose_master '],
        require_notes: false,
        approval_order: 'any',
      },
      current_stage_approver_labels: { ems_supply_officer: 'EMS Supply Officer', ' hose_master ': 'Hose Master' },
    } as unknown as Partial<Applicant>);
    await screen.findByText('Stage History');

    const rows = within(screen.getByRole('list', { name: 'Approval status' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['EMS Supply OfficerPending', 'Hose MasterPending']);
  });
});

describe('ApplicantDetailDialog activity log', () => {
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
    // show" rather than taking the dialog down.
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

describe('ApplicantDetailDialog conversion notes', () => {
  // The Convert dialog's notes are recorded on the transfer's activity entry
  // and nowhere else, so the log has to show them.
  it('shows the notes recorded with a conversion', async () => {
    mocks.getActivity.mockResolvedValue([
      {
        id: 'act-9',
        prospect_id: 'app-1',
        action: 'transferred_to_membership',
        details: { user_id: 'u-9', username: 'rbishop', notes: 'Cleared by the chief on 9/28.' },
        performed_by: 'u-1',
        performer_name: 'Dana Cole',
        created_at: '2026-09-28T14:00:00Z',
      },
    ]);
    renderDrawer();
    await screen.findByText('Stage History');

    await userEvent.click(screen.getByText('Activity Log'));

    expect(await screen.findByText('Cleared by the chief on 9/28.')).toBeInTheDocument();
  });
});

describe('ApplicantDetailDialog address', () => {
  // The dialog showed an address only when it had a city, so an applicant who
  // gave a street and ZIP but no city appeared to have no address at all.
  it('shows an address that has a street but no city', async () => {
    renderDrawer({ address: { street: '1 Main St', zip_code: '62701' } });
    await screen.findByText('Stage History');

    expect(screen.getByText('1 Main St, 62701')).toBeInTheDocument();
  });

  it('shows an address that has only a city', async () => {
    renderDrawer({ address: { city: 'Springfield' } });
    await screen.findByText('Stage History');

    expect(screen.getByText('Springfield')).toBeInTheDocument();
  });
});

describe('ApplicantDetailDialog contact edit', () => {
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

describe('ApplicantDetailDialog checklist stage', () => {
  const checklistApplicant = {
    current_stage_type: 'checklist',
    current_stage_config: {
      items: [{ label: 'Gear issued' }, { label: 'Station tour' }],
      require_all: true,
    },
  } as unknown as Partial<Applicant>;

  // Nothing rendered the items as tickable, so a stage with items configured
  // could never be completed: the server refused every advance.
  it('renders each configured item as a checkbox', async () => {
    renderDrawer(checklistApplicant);
    await screen.findByText('Stage History');

    expect(screen.getByRole('checkbox', { name: 'Gear issued' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Station tour' })).not.toBeChecked();
    expect(screen.getByText(/0 of 2 items done — tick every item to advance/)).toBeInTheDocument();
  });

  it('counts ticks as the officer makes them', async () => {
    const user = userEvent.setup();
    renderDrawer(checklistApplicant);
    await screen.findByText('Stage History');

    await user.click(screen.getByRole('checkbox', { name: 'Gear issued' }));

    expect(screen.getByRole('checkbox', { name: 'Gear issued' })).toBeChecked();
    expect(screen.getByText(/1 of 2 items done/)).toBeInTheDocument();
  });
});

describe('ApplicantDetailDialog referral details', () => {
  it('shows where the applicant came from, who referred them and why', async () => {
    renderDrawer({
      referral_source: 'Attended: Spring Open House',
      referred_by_name: 'Jordan Avery',
      interest_reason: 'Grew up next to the station.',
    });
    await screen.findByText('Stage History');

    const section = screen.getByRole('region', { name: 'How They Found Us' });
    expect(within(section).getByText('Attended: Spring Open House')).toBeInTheDocument();
    expect(within(section).getByText('Jordan Avery')).toBeInTheDocument();
    expect(within(section).getByText('Grew up next to the station.')).toBeInTheDocument();
  });

  it('shows only the parts on file', async () => {
    renderDrawer({ referral_source: 'Website' });
    await screen.findByText('Stage History');

    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.queryByText('Referred by')).not.toBeInTheDocument();
    expect(screen.queryByText('Why they want to join')).not.toBeInTheDocument();
  });

  it('omits the section entirely when nothing is on file', async () => {
    renderDrawer();
    await screen.findByText('Stage History');

    expect(screen.queryByRole('heading', { name: 'How They Found Us' })).not.toBeInTheDocument();
  });
});

/**
 * The dialog shell. This surface was a right-edge `drawer-panel`; it is now a
 * centred dialog on the shared stack, like the shift detail panel.
 */
describe('ApplicantDetailDialog dialog shell', () => {
  function renderWithClose(onClose: () => void) {
    renderWithRouter(
      <ApplicantDetailDialog
        applicant={applicant}
        isOpen
        onClose={onClose}
        onConvert={vi.fn()}
        isLastStage={false}
        isFirstStage={false}
      />
    );
  }

  it('renders as a centred modal dialog, not a side drawer', async () => {
    renderWithClose(vi.fn());
    await screen.findByText('Stage History');

    const dialog = screen.getByRole('dialog', { name: 'Applicant details' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveClass('items-center', 'justify-center');
  });

  it('closes on Escape and on the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithClose(onClose);
    await screen.findByText('Stage History');

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close detail panel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close on a click on the scrim', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithClose(onClose);
    await screen.findByText('Stage History');

    await user.click(screen.getByRole('dialog', { name: 'Applicant details' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderWithRouter(
      <ApplicantDetailDialog
        applicant={applicant}
        isOpen={false}
        onClose={vi.fn()}
        onConvert={vi.fn()}
        isLastStage={false}
        isFirstStage={false}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
