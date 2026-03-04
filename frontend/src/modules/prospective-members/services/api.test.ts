import { describe, it, expect } from 'vitest';
import { mapProspectToApplicant } from './api';
import type {
  BackendProspectResponse,
  BackendStepProgressResponse,
} from '../types';

/** Helper to build a minimal BackendStepProgressResponse */
function makeStepProgress(
  overrides: Partial<BackendStepProgressResponse> & { id: string; step_id: string; status: string },
): BackendStepProgressResponse {
  return {
    prospect_id: 'prospect-1',
    completed_at: null,
    completed_by: null,
    notes: null,
    action_result: null,
    step: {
      id: overrides.step_id,
      pipeline_id: 'pipeline-1',
      name: `Step ${overrides.step_id}`,
      description: null,
      step_type: 'action',
      action_type: 'custom',
      is_first_step: false,
      is_final_step: false,
      sort_order: 0,
      email_template_id: null,
      required: true,
      config: null,
      inactivity_timeout_days: null,
      notify_prospect_on_completion: false,
      public_visible: false,
    },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Helper to build a minimal BackendProspectResponse */
function makeProspectResponse(
  stepProgress: BackendStepProgressResponse[],
): BackendProspectResponse {
  return {
    id: 'prospect-1',
    organization_id: 'org-1',
    pipeline_id: 'pipeline-1',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    phone: null,
    mobile: null,
    date_of_birth: null,
    address_street: null,
    address_city: null,
    address_state: null,
    address_zip: null,
    interest_reason: null,
    referral_source: null,
    referred_by: null,
    notes: null,
    current_step_id: 'step-1',
    status: 'active',
    metadata: null,
    form_submission_id: null,
    status_token: null,
    transferred_user_id: null,
    transferred_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    current_step: null,
    step_progress: stepProgress,
    pipeline_name: 'Default Pipeline',
  };
}

describe('mapProspectToApplicant', () => {
  it('excludes PENDING steps from stage_history', () => {
    const stepProgress = [
      makeStepProgress({ id: 'sp-1', step_id: 'step-1', status: 'in_progress' }),
      makeStepProgress({ id: 'sp-2', step_id: 'step-2', status: 'pending' }),
      makeStepProgress({ id: 'sp-3', step_id: 'step-3', status: 'pending' }),
    ];

    const result = mapProspectToApplicant(makeProspectResponse(stepProgress));

    expect(result.stage_history).toHaveLength(1);
    expect(result.stage_history[0]?.stage_id).toBe('step-1');
  });

  it('sets total_stages to the full step_progress count including PENDING', () => {
    const stepProgress = [
      makeStepProgress({ id: 'sp-1', step_id: 'step-1', status: 'completed', completed_at: '2026-01-02T00:00:00Z' }),
      makeStepProgress({ id: 'sp-2', step_id: 'step-2', status: 'in_progress' }),
      makeStepProgress({ id: 'sp-3', step_id: 'step-3', status: 'pending' }),
      makeStepProgress({ id: 'sp-4', step_id: 'step-4', status: 'pending' }),
    ];

    const result = mapProspectToApplicant(makeProspectResponse(stepProgress));

    expect(result.total_stages).toBe(4);
    expect(result.stage_history).toHaveLength(2);
  });

  it('includes COMPLETED and SKIPPED steps in stage_history', () => {
    const stepProgress = [
      makeStepProgress({ id: 'sp-1', step_id: 'step-1', status: 'completed', completed_at: '2026-01-02T00:00:00Z' }),
      makeStepProgress({ id: 'sp-2', step_id: 'step-2', status: 'skipped' }),
      makeStepProgress({ id: 'sp-3', step_id: 'step-3', status: 'in_progress' }),
      makeStepProgress({ id: 'sp-4', step_id: 'step-4', status: 'pending' }),
    ];

    const result = mapProspectToApplicant(makeProspectResponse(stepProgress));

    expect(result.stage_history).toHaveLength(3);
    expect(result.stage_history.map(s => s.stage_id)).toEqual(['step-1', 'step-2', 'step-3']);
  });

  it('returns empty stage_history when all steps are PENDING', () => {
    const stepProgress = [
      makeStepProgress({ id: 'sp-1', step_id: 'step-1', status: 'pending' }),
      makeStepProgress({ id: 'sp-2', step_id: 'step-2', status: 'pending' }),
    ];

    const result = mapProspectToApplicant(makeProspectResponse(stepProgress));

    expect(result.stage_history).toHaveLength(0);
    expect(result.total_stages).toBe(2);
  });

  it('handles null step_progress gracefully', () => {
    const data = makeProspectResponse([]);
    data.step_progress = null;

    const result = mapProspectToApplicant(data);

    expect(result.stage_history).toHaveLength(0);
    expect(result.total_stages).toBe(0);
  });
});
