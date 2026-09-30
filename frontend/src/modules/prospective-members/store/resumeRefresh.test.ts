/**
 * Resuming an on-hold applicant returns them to the active count, so the stat
 * header has to be refreshed along with the rows. `resumeApplicant` fetched
 * the rows alone and left "Total Active" one short until something else
 * happened to refresh it -- while `holdApplicant`, its mirror image, already
 * went through `refreshPipelineView`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResume = vi.fn();
const mockCompleteStep = vi.fn();
const mockGetApplicants = vi.fn();
const mockGetPipelineStats = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    resumeApplicant: (...args: unknown[]) => mockResume(...args) as unknown,
    completeStep: (...args: unknown[]) => mockCompleteStep(...args) as unknown,
    getApplicants: (...args: unknown[]) => mockGetApplicants(...args) as unknown,
  },
  pipelineService: {
    getPipelineStats: (...args: unknown[]) => mockGetPipelineStats(...args) as unknown,
  },
  interviewService: {},
}));

// Import the store after the mock is registered.
import { useProspectiveMembersStore } from './prospectiveMembersStore';

const store = () => useProspectiveMembersStore.getState();

beforeEach(() => {
  for (const mock of [mockResume, mockCompleteStep, mockGetApplicants, mockGetPipelineStats]) {
    mock.mockReset();
  }
  mockResume.mockResolvedValue(undefined);
  mockCompleteStep.mockResolvedValue(undefined);
  mockGetApplicants.mockResolvedValue({ items: [], total: 0, page: 1, total_pages: 1 });
  mockGetPipelineStats.mockResolvedValue({ pipeline_id: 'pipe-1', total_prospects: 3 });
  localStorage.clear();
  useProspectiveMembersStore.setState({
    filters: { pipeline_id: 'pipe-1' },
    currentPipeline: null,
    currentApplicant: null,
    pipelineStats: null,
    error: null,
  });
});

describe('mutations refresh the stat header with the rows', () => {
  it('resumeApplicant refreshes the pipeline stats', async () => {
    await store().resumeApplicant('a1');

    expect(mockResume).toHaveBeenCalledWith('a1');
    expect(mockGetApplicants).toHaveBeenCalled();
    expect(mockGetPipelineStats).toHaveBeenCalledWith('pipe-1', { search: undefined, event_id: undefined });
  });

  it('completeStep refreshes the pipeline stats', async () => {
    await store().completeStep('a1', 'step-1', 'done');

    expect(mockCompleteStep).toHaveBeenCalledWith('a1', 'step-1', 'done');
    expect(mockGetPipelineStats).toHaveBeenCalledWith('pipe-1', { search: undefined, event_id: undefined });
  });
});
