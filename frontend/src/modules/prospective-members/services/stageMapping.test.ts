/**
 * Stage <-> step mapping at the API boundary.
 *
 * The mapper is where a stage edit is translated into the backend's partial
 * update, and where the response is translated back. Two of its omissions made
 * an edit impossible to save on 2026-08-25: a per-stage inactivity override
 * never came back from the read side (so the editor could not show it), and the
 * write side collapsed an explicit null into undefined, which drops the key —
 * and a dropped key on a `model_dump(exclude_unset=True)` payload means "leave
 * this alone", so clearing the override was acknowledged and never persisted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPut = vi.fn();
const mockGet = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    post: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { pipelineService } from './api';
import type { BackendStepResponse, PipelineStageUpdate } from '../types';

const backendStep = (overrides: Partial<BackendStepResponse> = {}): BackendStepResponse => ({
  id: 'step-1',
  pipeline_id: 'pipeline-1',
  name: 'Interest Meeting',
  description: null,
  step_type: 'meeting',
  action_type: null,
  is_first_step: false,
  is_final_step: false,
  sort_order: 1,
  email_template_id: null,
  required: true,
  config: { meeting_type: 'informational' },
  inactivity_timeout_days: null,
  notify_prospect_on_completion: false,
  public_visible: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

/** The payload the stage dialog hands the service. */
const stageUpdate = (overrides: Partial<PipelineStageUpdate> = {}): PipelineStageUpdate => ({
  name: 'Interest Meeting',
  stage_type: 'meeting',
  config: { meeting_type: 'informational', meeting_description: '' },
  sort_order: 1,
  is_required: true,
  notify_prospect_on_completion: false,
  public_visible: true,
  ...overrides,
});

describe('pipelineService stage mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPut.mockResolvedValue({ data: backendStep() });
  });

  it('sends an explicit null when a stage-level timeout override is cleared', async () => {
    await pipelineService.updateStage('pipeline-1', 'step-1', stageUpdate({ inactivity_timeout_days: null }));

    const payload = mockPut.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toHaveProperty('inactivity_timeout_days', null);
  });

  it('sends the number when an override is set', async () => {
    await pipelineService.updateStage('pipeline-1', 'step-1', stageUpdate({ inactivity_timeout_days: 45 }));

    const payload = mockPut.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toHaveProperty('inactivity_timeout_days', 45);
  });

  it('omits the key entirely when the caller did not touch the override', async () => {
    await pipelineService.updateStage('pipeline-1', 'step-1', stageUpdate());

    const payload = mockPut.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('inactivity_timeout_days');
  });

  it('carries a stored timeout override back to the stage', async () => {
    mockPut.mockResolvedValue({ data: backendStep({ inactivity_timeout_days: 45 }) });

    const stage = await pipelineService.updateStage('pipeline-1', 'step-1', stageUpdate());

    expect(stage.inactivity_timeout_days).toBe(45);
  });

  it('fills the type default for a stage stored without a config', async () => {
    // Seeded and legacy steps carry `{}`; the editor maps over the arrays a
    // config of that type is supposed to have, and threw on every one of them.
    mockPut.mockResolvedValue({ data: backendStep({ step_type: 'checklist', config: {} }) });

    const stage = await pipelineService.updateStage('pipeline-1', 'step-1', stageUpdate());

    expect(stage.stage_type).toBe('checklist');
    expect(stage.config).toEqual(expect.objectContaining({ items: expect.any(Array) as unknown }));
  });

  it.each([
    ['reference_check', 'reference_types'],
    ['checklist', 'items'],
    ['multi_approval', 'required_approvers'],
    ['medical_screening', 'required_screenings'],
  ])('gives a %s stage its own default rather than a manual-approval one', async (stepType, arrayKey) => {
    mockPut.mockResolvedValue({ data: backendStep({ step_type: stepType, config: null }) });

    const stage = await pipelineService.updateStage('pipeline-1', 'step-1', stageUpdate());

    expect(stage.config).toHaveProperty(arrayKey);
    expect(Array.isArray((stage.config as Record<string, unknown>)[arrayKey])).toBe(true);
  });
});
