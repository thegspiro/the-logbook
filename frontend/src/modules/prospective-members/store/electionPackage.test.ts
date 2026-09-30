/**
 * The election package is the server's decision, not the store's.
 *
 * `advanceApplicant` used to create the package itself, in a second request
 * after the advance, when it saw the applicant land on an Election Vote
 * stage. That made it the only path that ever produced one: bulk advance,
 * Skip and Back reached the same stage without it, and those applicants could
 * never be put on a ballot. The server now creates the package in the same
 * transaction as whatever moved the applicant, so the store must not make a
 * second one — the backend endpoint does not deduplicate an explicit create.
 *
 * `createElectionPackage` is the drawer's recovery for applicants who reached
 * the stage before that, and reads the package back rather than trusting the
 * create response, so the drawer shows the same package the advance gate
 * grades.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  advanceStage: vi.fn(),
  createElectionPackage: vi.fn(),
  getApplicant: vi.fn(),
  getApplicants: vi.fn(),
  getElectionPackage: vi.fn(),
  getPipelineStats: vi.fn(),
}));

vi.mock('../services/api', () => ({
  applicantService: {
    advanceStage: (...a: unknown[]) => mocks.advanceStage(...a) as unknown,
    createElectionPackage: (...a: unknown[]) => mocks.createElectionPackage(...a) as unknown,
    getApplicant: (...a: unknown[]) => mocks.getApplicant(...a) as unknown,
    getApplicants: (...a: unknown[]) => mocks.getApplicants(...a) as unknown,
    getElectionPackage: (...a: unknown[]) => mocks.getElectionPackage(...a) as unknown,
  },
  pipelineService: {
    getPipelineStats: (...a: unknown[]) => mocks.getPipelineStats(...a) as unknown,
  },
  interviewService: {},
  eventLinkService: {},
}));

// Import the store only once the mocks are registered.
import { useProspectiveMembersStore } from './prospectiveMembersStore';
import type { Applicant, ElectionPackage, Pipeline } from '../types';

const store = () => useProspectiveMembersStore.getState();

const stage = (id: string, stageType: string, sortOrder: number) => ({
  id,
  pipeline_id: 'pipe-1',
  name: id,
  stage_type: stageType,
  config: {},
  sort_order: sortOrder,
  is_required: true,
  notify_prospect_on_completion: false,
  public_visible: true,
});

const pipeline = {
  id: 'pipe-1',
  name: 'Membership',
  stages: [stage('s1', 'manual_approval', 0), stage('vote', 'election_vote', 1)],
} as unknown as Pipeline;

const applicantOn = (stageId: string) =>
  ({
    id: 'app-1',
    pipeline_id: 'pipe-1',
    first_name: 'Riley',
    last_name: 'Bishop',
    email: 'riley@example.com',
    status: 'active',
    current_stage_id: stageId,
    current_stage_type: stageId === 'vote' ? 'election_vote' : 'manual_approval',
  }) as unknown as Applicant;

const pkg = { id: 'pkg-1', applicant_id: 'app-1', status: 'draft' } as unknown as ElectionPackage;

describe('election package in the store', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.advanceStage.mockResolvedValue(applicantOn('vote'));
    mocks.getApplicant.mockResolvedValue(applicantOn('vote'));
    mocks.getApplicants.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25, total_pages: 1 });
    mocks.getPipelineStats.mockResolvedValue(null);
    mocks.createElectionPackage.mockResolvedValue(pkg);
    mocks.getElectionPackage.mockResolvedValue(pkg);
    useProspectiveMembersStore.setState({
      currentPipeline: pipeline,
      currentApplicant: applicantOn('s1'),
      currentElectionPackage: null,
      filters: {},
      error: null,
    });
  });

  it('does not create the package itself when an advance lands on a vote stage', async () => {
    await store().advanceApplicant('app-1');

    expect(mocks.advanceStage).toHaveBeenCalledWith('app-1', undefined);
    expect(mocks.createElectionPackage).not.toHaveBeenCalled();
    // The applicant is still re-read, so the drawer moves onto the vote stage
    // and its package section loads what the server created.
    expect(mocks.getApplicant).toHaveBeenCalledWith('app-1');
    expect(store().currentApplicant?.current_stage_id).toBe('vote');
    expect(store().error).toBeNull();
  });

  it('createElectionPackage posts the request and reads the package back', async () => {
    await store().createElectionPackage('app-1', {
      applicant_id: 'app-1',
      pipeline_id: 'pipe-1',
      stage_id: 'vote',
    });

    expect(mocks.createElectionPackage).toHaveBeenCalledWith('app-1', {
      applicant_id: 'app-1',
      pipeline_id: 'pipe-1',
      stage_id: 'vote',
    });
    expect(mocks.getElectionPackage).toHaveBeenCalledWith('app-1');
    expect(store().currentElectionPackage).toEqual(pkg);
  });

  it('createElectionPackage reports and rethrows a refusal', async () => {
    mocks.createElectionPackage.mockRejectedValueOnce(new Error('This applicant is rejected'));

    await expect(
      store().createElectionPackage('app-1', { applicant_id: 'app-1', pipeline_id: 'pipe-1', stage_id: 'vote' })
    ).rejects.toThrow('This applicant is rejected');

    expect(mocks.getElectionPackage).not.toHaveBeenCalled();
    expect(store().currentElectionPackage).toBeNull();
    expect(store().error).toBe('This applicant is rejected');
  });
});
