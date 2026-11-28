/**
 * The template builder shows "Unsaved changes" once edited; a refresh or a
 * closed tab must then ask before discarding them, as the evaluation page
 * already does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderWithRouter } from '../../../test/utils';
import type { EvaluationTemplateDetail, TemplateVersion } from '../types/evaluations';
import { defaultLevels } from '../utils/evaluationTemplate';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const get = vi.fn();
const saveDraft = vi.fn();
const publish = vi.fn();
const discardDraft = vi.fn();
const update = vi.fn();
const dataSources = vi.fn();
const builderOptions = vi.fn();
const previewOptions = vi.fn();
const preview = vi.fn();
vi.mock('../services/evaluationsApi', () => ({
  evaluationTemplatesService: {
    get: (...a: unknown[]) => get(...a) as unknown,
    saveDraft: (...a: unknown[]) => saveDraft(...a) as unknown,
    publish: (...a: unknown[]) => publish(...a) as unknown,
    discardDraft: (...a: unknown[]) => discardDraft(...a) as unknown,
    update: (...a: unknown[]) => update(...a) as unknown,
    remove: vi.fn(),
    dataSources: (...a: unknown[]) => dataSources(...a) as unknown,
    builderOptions: (...a: unknown[]) => builderOptions(...a) as unknown,
    previewOptions: (...a: unknown[]) => previewOptions(...a) as unknown,
    preview: (...a: unknown[]) => preview(...a) as unknown,
  },
}));

import EvaluationTemplateBuilderPage from './EvaluationTemplateBuilderPage';

function version(overrides: Partial<TemplateVersion> = {}): TemplateVersion {
  return {
    id: 'v1',
    version_number: 1,
    published_at: null,
    updated_at: null,
    definition: {
      overall_mode: 'weighted',
      officer_ranks: [],
      sections: [
        {
          key: 'training',
          title: 'Training',
          description: null,
          officer_only: false,
          items: [
            {
              key: 'participation',
              label: 'Training participation',
              help_text: null,
              tool: 'labeled_scale',
              levels: defaultLevels('labeled_scale'),
              allow_na: false,
              weight: 100,
              require_example_for: [],
              checklist_options: [],
              comment: 'optional',
              include_in_self_evaluation: true,
              data_block: null,
            },
          ],
        },
      ],
    },
    workflow: {
      reminder_days_before: 3,
      evaluator_may_proceed_without_self_evaluation: true,
      response_window_days: 30,
      steps: [
        {
          key: 'self_evaluation',
          type: 'self_evaluation',
          label: 'Self-evaluation',
          actor: { kind: 'member', position_id: null },
          due_days: 14,
        },
        {
          key: 'evaluator',
          type: 'evaluator',
          label: 'Evaluator',
          actor: { kind: 'evaluator', position_id: null },
          due_days: 30,
        },
        {
          key: 'member_acknowledgement',
          type: 'member_acknowledgement',
          label: 'Member acknowledgement',
          actor: { kind: 'member', position_id: null },
          due_days: 58,
        },
      ],
    },
    ...overrides,
  };
}

function detail(overrides: Partial<EvaluationTemplateDetail> = {}): EvaluationTemplateDetail {
  return {
    id: 't1',
    name: 'Operational Annual',
    description: null,
    kind: 'annual',
    member_class: 'operational',
    member_status: null,
    is_active: true,
    published_version: null,
    has_draft: true,
    evaluations_count: 0,
    updated_at: null,
    draft: version(),
    published: null,
    versions: [],
    ...overrides,
  };
}

/** A save that answers with the draft it was sent, as the server does. */

function renderBuilder() {
  window.history.pushState({}, '', '/reports/evaluations/templates/t1');
  return renderWithRouter(
    <Routes>
      <Route path="/reports/evaluations/templates/:templateId" element={<EvaluationTemplateBuilderPage />} />
    </Routes>
  );
}

describe('EvaluationTemplateBuilderPage unsaved edits', () => {
  beforeEach(() => {
    for (const m of [
      get,
      saveDraft,
      publish,
      discardDraft,
      update,
      dataSources,
      builderOptions,
      previewOptions,
      preview,
    ]) {
      m.mockReset();
    }
    previewOptions.mockResolvedValue({ can_use_member_data: false, members: [], periods: [] });
    get.mockResolvedValue(detail());
    dataSources.mockResolvedValue([]);
    builderOptions.mockResolvedValue({ positions: [], ranks: [] });
  });

  it('asks before a refresh or a closed tab throws them away', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const title = await screen.findByLabelText('Section title');
    await user.type(title, ' and drills');

    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  it('does not ask before any edit', async () => {
    renderBuilder();
    await screen.findByLabelText('Section title');

    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });
});
