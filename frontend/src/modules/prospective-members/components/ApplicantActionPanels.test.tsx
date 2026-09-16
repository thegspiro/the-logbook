/**
 * An applicant can end up on no stage at all — deleting a pipeline's last
 * stage nulls `current_step_id` for everyone on it — and until now there was
 * nothing to do about it. Advance, Back and Skip each need a current stage to
 * work from, and `current_step_id` is protected from the generic update, so
 * the board could show these people and offer only ways of closing the
 * application.
 *
 * The control is recovery only, which is why it appears solely when there is
 * no current stage: every other way of moving an applicant runs a gate (the
 * meeting-attendance check, the required-stage rule, one stage at a time) and
 * a general "set them to any stage" button would be a way around all three.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { ApplicantActionPanels } from './ApplicantActionPanels';
import type { Applicant } from '../types';

const mocks = vi.hoisted(() => {
  const storeState: Record<string, unknown> = {};
  return {
    assignApplicantStage: vi.fn(),
    storeState,
    skipStep: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  };
});

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: Object.assign(() => mocks.storeState, {
    getState: () => mocks.storeState,
  }),
}));

vi.mock('../services/api', () => ({
  applicantService: {
    skipStep: (...a: unknown[]) => mocks.skipStep(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...a: unknown[]) => mocks.toastError(...a) as unknown,
    success: (...a: unknown[]) => mocks.toastSuccess(...a) as unknown,
  },
}));

const pipelineStage = (id: string, name: string, sortOrder: number) =>
  ({
    id,
    pipeline_id: 'pipe-1',
    name,
    stage_type: 'manual_approval',
    config: {},
    sort_order: sortOrder,
    is_required: true,
    notify_prospect_on_completion: false,
    public_visible: true,
  }) as unknown;

const currentPipeline = {
  id: 'pipe-1',
  name: 'Membership',
  // Deliberately out of order, so the picker is shown to sort rather than
  // trusting the server's array order.
  stages: [pipelineStage('s2', 'Interview', 1), pipelineStage('s1', 'Application', 0)],
};

const applicant = {
  id: 'app-1',
  pipeline_id: 'pipe-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  email: 'riley@example.com',
  status: 'active',
  current_stage_id: '',
} as unknown as Applicant;

const renderPanels = (overrides: Partial<Applicant> = {}) =>
  renderWithRouter(
    <ApplicantActionPanels
      applicant={{ ...applicant, ...overrides }}
      isLastStage={false}
      isFirstStage={false}
      onClose={vi.fn()}
      onConvert={vi.fn()}
    />
  );

const placementPanel = () => screen.queryByText('Not on a stage');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignApplicantStage.mockResolvedValue(undefined);
  mocks.storeState = {
    advanceApplicant: vi.fn(),
    regressApplicant: vi.fn(),
    rejectApplicant: vi.fn(),
    holdApplicant: vi.fn(),
    resumeApplicant: vi.fn(),
    withdrawApplicant: vi.fn(),
    reactivateApplicant: vi.fn(),
    fetchApplicants: vi.fn(),
    fetchApplicant: vi.fn(),
    assignApplicantStage: mocks.assignApplicantStage,
    isAdvancing: false,
    isRegressing: false,
    isRejecting: false,
    isHolding: false,
    isResuming: false,
    isWithdrawing: false,
    isReactivating: false,
    isAssigningStage: false,
    currentPipeline,
  };
});

describe('placing an applicant who is on no stage', () => {
  it('offers the control when the applicant has no current stage', () => {
    renderPanels();

    expect(placementPanel()).toBeInTheDocument();
  });

  it('does not offer it to an applicant who is on a stage', () => {
    renderPanels({ current_stage_id: 's1' });

    expect(placementPanel()).toBeNull();
  });

  it('lists the pipeline’s stages in order', () => {
    renderPanels();

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a stage…', 'Application', 'Interview']);
  });

  it('places the applicant on the stage the coordinator picks', async () => {
    const user = userEvent.setup();
    renderPanels();

    await user.selectOptions(screen.getByLabelText('Stage to place this applicant on'), 's2');
    await user.click(screen.getByRole('button', { name: 'Place' }));

    expect(mocks.assignApplicantStage).toHaveBeenCalledWith('app-1', 's2', undefined);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Placed on Interview');
  });

  // currentPipeline is whichever board is open, which is not necessarily the
  // applicant's — offering its stages would let a coordinator put someone onto
  // a stage of a pipeline they are not on.
  it('offers nothing when the open board is a different pipeline', () => {
    mocks.storeState.currentPipeline = { ...currentPipeline, id: 'pipe-2' };
    renderPanels();

    expect(placementPanel()).toBeNull();
  });

  it('surfaces the server’s own refusal rather than a fixed string', async () => {
    const user = userEvent.setup();
    mocks.assignApplicantStage.mockRejectedValueOnce(
      new Error('This applicant is already on a stage. Use Advance or Back to move them.')
    );
    renderPanels();

    await user.selectOptions(screen.getByLabelText('Stage to place this applicant on'), 's1');
    await user.click(screen.getByRole('button', { name: 'Place' }));

    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('already on a stage'));
  });
});

/**
 * The hint is what tells a coordinator a stage will refuse before they click
 * Advance and find out. It covered five of the gated stage types and missed
 * document_upload, whose gate has been enforced on the backend all along, and
 * election_vote, whose gate is new.
 */
describe('stage requirement hints', () => {
  beforeEach(() => {
    mocks.storeState.currentPipeline = currentPipeline;
  });

  const onStage = (stageType: string, config: Record<string, unknown>) =>
    renderPanels({
      current_stage_id: 's1',
      current_stage_type: stageType,
      current_stage_config: config,
    } as unknown as Partial<Applicant>);

  it('names the documents a document_upload stage is waiting on', () => {
    onStage('document_upload', {
      required_document_types: ['Driver’s License', 'Background Check'],
      allow_multiple: true,
    });

    expect(
      screen.getByText('Upload 2 required documents before advancing: Driver’s License, Background Check.')
    ).toBeInTheDocument();
  });

  it('ignores blank document types when counting', () => {
    onStage('document_upload', { required_document_types: ['ID', '  '], allow_multiple: true });

    expect(screen.getByText('Upload 1 required document before advancing: ID.')).toBeInTheDocument();
  });

  it('says nothing for a document_upload stage that requires no named type', () => {
    onStage('document_upload', { required_document_types: [], allow_multiple: true });

    expect(screen.queryByText(/before advancing/)).toBeNull();
  });

  it('warns that a ballot holds an election_vote stage until the result is in', () => {
    onStage('election_vote', { voting_method: 'simple_majority', victory_condition: 'majority' });

    expect(screen.getByText(/cannot advance until the election closes/)).toBeInTheDocument();
  });

  // A meeting stage that names its event is an attendance requirement the
  // server enforces on Advance too, so the hint has to state it before the
  // click rather than leave the refusal to explain it afterwards.
  it('states the attendance requirement for a meeting stage that names its event', () => {
    onStage('meeting', { meeting_type: 'business_meeting', linked_event_type: 'business_meeting' });

    expect(screen.getByText(/must be checked in at this stage’s event/)).toBeInTheDocument();
    expect(screen.getByText(/attendance must be finalized/)).toBeInTheDocument();
  });

  it('adds the auto-advance behaviour only when that box is ticked', () => {
    onStage('meeting', {
      meeting_type: 'business_meeting',
      linked_event_type: 'business_meeting',
      auto_advance: true,
    });

    expect(screen.getByText(/advances on its own as soon as the event is finalized/i)).toBeInTheDocument();
  });

  it('says nothing for a meeting stage that names no event', () => {
    // The stage builder's default shape: an arrangement nothing records, so
    // the coordinator's word is still the only evidence there can be.
    onStage('meeting', { meeting_type: 'chief_meeting', meeting_description: '' });

    expect(screen.queryByText(/checked in/)).toBeNull();
  });

  it('treats a pinned event id alone as naming an event', () => {
    onStage('meeting', { meeting_type: 'chief_meeting', linked_event_id: 'evt-1' });

    expect(screen.getByText(/must be checked in at this stage’s event/)).toBeInTheDocument();
  });
});
