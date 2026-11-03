/**
 * The evaluation template builder edits a draft, never a published version,
 * and leaves the decision of whether a draft is ready to the server: it shows
 * the server's list of what is missing rather than re-checking the rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
function echoDraft(
  _id: string,
  definition: TemplateVersion['definition'],
  workflow: TemplateVersion['workflow']
): Promise<EvaluationTemplateDetail> {
  return Promise.resolve(detail({ draft: version({ definition, workflow }) }));
}

function renderBuilder() {
  window.history.pushState({}, '', '/reports/evaluations/templates/t1');
  return renderWithRouter(
    <Routes>
      <Route path="/reports/evaluations/templates/:templateId" element={<EvaluationTemplateBuilderPage />} />
    </Routes>
  );
}

describe('EvaluationTemplateBuilderPage', () => {
  beforeEach(() => {
    for (const m of [get, saveDraft, publish, discardDraft, update, dataSources, builderOptions]) m.mockReset();
    get.mockResolvedValue(detail());
    dataSources.mockResolvedValue([
      {
        key: 'training.session_attendance_pct',
        label: 'Training session attendance',
        unit: 'percent',
        module: 'training',
        description: 'Training events attended out of those held.',
        scoreable: true,
      },
    ]);
    builderOptions.mockResolvedValue({
      positions: [{ id: 'pos-chief', name: 'Chief' }],
      ranks: [{ rank_code: 'lieutenant', display_name: 'Lieutenant', is_active: true }],
    });
  });

  it('saves the edited draft with its keys unchanged', async () => {
    saveDraft.mockImplementation(echoDraft);
    const user = userEvent.setup();
    renderBuilder();

    const title = await screen.findByLabelText('Section title');
    await user.clear(title);
    await user.type(title, 'Training and drills');
    await user.click(screen.getByLabelText('Lieutenant'));
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const [id, definition] = saveDraft.mock.calls[0] as [string, TemplateVersion['definition']];
    expect(id).toBe('t1');
    expect(definition.sections[0]?.key).toBe('training');
    expect(definition.sections[0]?.title).toBe('Training and drills');
    expect(definition.officer_ranks).toEqual(['lieutenant']);
  });

  it('adds a scoring rule to a data block', async () => {
    saveDraft.mockImplementation(echoDraft);
    const user = userEvent.setup();
    renderBuilder();

    await user.selectOptions(
      await screen.findByLabelText('Data shown with this item'),
      'training.session_attendance_pct'
    );
    await user.click(screen.getByRole('button', { name: /add band/i }));
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    const definition = saveDraft.mock.calls[0]?.[1] as TemplateVersion['definition'];
    expect(definition.sections[0]?.items[0]?.data_block).toEqual({
      source: 'training.session_attendance_pct',
      scoring_rule: { bands: [{ min: 0, max: null, score: 1 }] },
    });
  });

  it("lists the server's reasons when a draft is not ready to publish", async () => {
    publish.mockResolvedValue({
      published: false,
      errors: ['Item weights add up to 60%, not 100%.', 'Add at least one item.'],
      template: null,
    });
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^publish$/i }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Item weights add up to 60%, not 100%.')).toBeInTheDocument();
    expect(within(alert).getByText('Add at least one item.')).toBeInTheDocument();
  });

  it('starts from the published version when there is no draft, and says saving opens the next one', async () => {
    get.mockResolvedValue(
      detail({
        has_draft: false,
        published_version: 2,
        draft: null,
        published: version({ id: 'v2', version_number: 2, published_at: '2026-10-01T12:00:00Z' }),
      })
    );
    renderBuilder();

    expect(await screen.findByText(/Saving starts the next version/)).toBeInTheDocument();
    expect(screen.getByLabelText('Section title')).toHaveValue('Training');
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled();
  });

  it('adds an approval step before the acknowledgement', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole('tab', { name: /workflow/i }));
    await user.click(screen.getByRole('button', { name: /^approval$/i }));

    const labels = screen.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value);
    expect(labels).toEqual(['Self-evaluation', 'Evaluator', 'Approval', 'Member acknowledgement']);
    expect(screen.getByLabelText('Who acts')).toHaveValue('pos-chief');
  });

  it('saves details separately, clearing a blank description with null', async () => {
    update.mockResolvedValue(detail({ description: null }));
    get.mockResolvedValue(detail({ description: 'Old text' }));
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole('tab', { name: /details/i }));
    await user.clear(screen.getByLabelText(/description/i));
    await user.click(screen.getByRole('button', { name: /save details/i }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('t1', {
        name: 'Operational Annual',
        description: null,
        member_class: 'operational',
        member_status: null,
        is_active: true,
      })
    );
  });

  it('keeps an unsaved Details edit when a draft is saved', async () => {
    saveDraft.mockImplementation(echoDraft);
    get.mockResolvedValue(detail({ description: 'Old text' }));
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole('tab', { name: /details/i }));
    const description = screen.getByLabelText(/description/i);
    await user.clear(description);
    await user.type(description, 'New text');
    await user.click(screen.getByRole('tab', { name: /sections/i }));
    await user.type(screen.getByLabelText('Section title'), '!');
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: /details/i }));
    expect(screen.getByLabelText(/description/i)).toHaveValue('New text');
  });

  it('keeps edits made while a save is in flight, still unsaved', async () => {
    let answer: (value: EvaluationTemplateDetail) => void = () => undefined;
    saveDraft.mockImplementation(
      () =>
        new Promise<EvaluationTemplateDetail>((resolve) => {
          answer = resolve;
        })
    );
    const user = userEvent.setup();
    renderBuilder();

    const title = await screen.findByLabelText('Section title');
    await user.type(title, ' A');
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await user.type(title, 'B');
    answer(detail());

    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /save draft/i })).toBeEnabled());
    expect(screen.getByLabelText('Section title')).toHaveValue('Training AB');
    expect(screen.getByRole('button', { name: /save draft/i })).toBeEnabled();
  });
});
