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
