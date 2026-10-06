/**
 * `auto_transfer_on_approval` across the API boundary.
 *
 * The backend reads the flag on every stage completion and returns it on every
 * pipeline read, but the mapper used to drop it and no payload carried it, so
 * a department could neither see nor change which way it was set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPut = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    delete: vi.fn(),
  }),
}));

import { pipelineService } from './api';
import type { BackendPipelineResponse } from '../types';

const backendPipeline = (overrides: Partial<BackendPipelineResponse> = {}): BackendPipelineResponse => ({
  id: 'pipeline-1',
  organization_id: 'org-1',
  name: 'Recruit',
  description: null,
  is_template: false,
  is_default: true,
  is_active: true,
  auto_transfer_on_approval: true,
  inactivity_config: null,
  conversion_config: {
    operational: { member_class: 'operational', member_status: 'probationary' },
    administrative: { member_class: 'administrative', member_status: 'regular' },
  },
  public_status_enabled: false,
  public_show_future_stages: true,
  report_stage_groups: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  steps: [],
  prospect_count: 0,
  ...overrides,
});

describe('pipelineService auto_transfer_on_approval', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockPost.mockReset();
  });

  it('carries the flag on a read', async () => {
    mockGet.mockResolvedValue({ data: backendPipeline({ auto_transfer_on_approval: true }) });

    const pipeline = await pipelineService.getPipeline('pipeline-1');

    expect(pipeline.auto_transfer_on_approval).toBe(true);
  });

  it('sends the flag on an update', async () => {
    mockPut.mockResolvedValue({ data: backendPipeline({ auto_transfer_on_approval: false }) });

    await pipelineService.updatePipeline('pipeline-1', { auto_transfer_on_approval: false });

    expect(mockPut).toHaveBeenCalledWith('/prospective-members/pipelines/pipeline-1', {
      auto_transfer_on_approval: false,
    });
  });

  it('leaves the flag alone on an update that does not mention it', async () => {
    mockPut.mockResolvedValue({ data: backendPipeline() });

    await pipelineService.updatePipeline('pipeline-1', { name: 'Recruit 2' });

    expect(mockPut).toHaveBeenCalledWith('/prospective-members/pipelines/pipeline-1', { name: 'Recruit 2' });
  });
});
