/**
 * The builder's preview: the unsaved form, filled with sample figures or —
 * for a builder who may read them — a chosen member's, and shown as either
 * the evaluator's form or the member's self-evaluation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';
import type { PreviewOptions, TemplateDefinition, TemplatePreview } from '../../types/evaluations';

const previewOptions = vi.fn();
const preview = vi.fn();
vi.mock('../../services/evaluationsApi', () => ({
  evaluationTemplatesService: {
    previewOptions: (...a: unknown[]) => previewOptions(...a) as unknown,
    preview: (...a: unknown[]) => preview(...a) as unknown,
  },
}));

import { TemplatePreviewPanel } from './TemplatePreviewPanel';

const LEVELS = [1, 2, 3, 4, 5].map((value) => ({ value, label: `Level ${value}`, anchor: `Behavior ${value}` }));

const definition: TemplateDefinition = {
  overall_mode: 'none',
  officer_ranks: ['captain'],
  sections: [
    {
      key: 'core',
      title: 'Core',
      description: null,
      officer_only: false,
      items: [
        {
          key: 'training',
          label: 'Training participation',
          help_text: null,
          tool: 'labeled_scale',
          levels: LEVELS,
          allow_na: false,
          weight: 0,
          require_example_for: [],
          checklist_options: [],
          comment: 'optional',
          include_in_self_evaluation: true,
          data_block: { source: 'training.hours', scoring_rule: null },
        },
        {
          key: 'scene',
          label: 'Scene performance',
          help_text: null,
          tool: 'labeled_scale',
          levels: LEVELS,
          allow_na: false,
          weight: 0,
          require_example_for: [],
          checklist_options: [],
          comment: 'optional',
          include_in_self_evaluation: false,
          data_block: null,
        },
      ],
    },
    {
      key: 'leadership',
      title: 'Leadership',
      description: null,
      officer_only: true,
      items: [],
    },
  ],
};

const OPTIONS: PreviewOptions = {
  can_use_member_data: false,
  members: [],
  periods: [
    { id: 'p1', name: '2026 Annual Review', start_date: '2026-01-01', end_date: '2026-12-31', is_closed: false },
  ],
};

function result(overrides: Partial<TemplatePreview> = {}): TemplatePreview {
  return {
    sample: true,
    member_name: null,
    period_name: '2026 Annual Review',
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    coverage_start: null,
    coverage_end: null,
    includes_officer_sections: true,
    sources: [
      {
        key: 'training.hours',
        label: 'Training hours',
        unit: 'hours',
        module: 'training',
        description: '',
        scoreable: true,
      },
    ],
    data: { 'training.hours': { available: true, value: 36 } },
    suggested_scores: { training: 4 },
    overall_levels: [],
    note: 'Sample figures. Choose a member to see real ones.',
    ...overrides,
  };
}

describe('TemplatePreviewPanel', () => {
  beforeEach(() => {
    previewOptions.mockReset();
    preview.mockReset();
    previewOptions.mockResolvedValue(OPTIONS);
    preview.mockResolvedValue(result());
  });

  it('shows the unsaved form with sample figures over the latest period', async () => {
    renderWithRouter(<TemplatePreviewPanel definition={definition} />);

    expect(await screen.findByText('36 h')).toBeInTheDocument();
    expect(screen.getByText('Suggested: Level 4')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(definition, '', 'p1');
    expect(screen.getByLabelText('Figures from')).toBeDisabled();
    expect(screen.getByText(/needs the View all evaluations permission/)).toBeInTheDocument();
  });

  it('measures a chosen member for a builder who may read their figures', async () => {
    previewOptions.mockResolvedValue({
      ...OPTIONS,
      can_use_member_data: true,
      members: [{ id: 'm1', name: 'Pat Member' }],
    });
    const user = userEvent.setup();
    renderWithRouter(<TemplatePreviewPanel definition={definition} />);
    await screen.findByText('36 h');

    preview.mockResolvedValue(
      result({
        sample: false,
        member_name: 'Pat Member',
        includes_officer_sections: false,
        data: { 'training.hours': { available: true, value: 11.5 } },
        suggested_scores: { training: 2 },
        note: null,
      })
    );
    await user.selectOptions(screen.getByLabelText('Figures from'), 'm1');

    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(definition, 'm1', 'p1'));
    expect(await screen.findByText('11.5 h')).toBeInTheDocument();
    expect(screen.getByText(/Pat Member's figures/)).toBeInTheDocument();
    // Not an officer, so the officer-only section is left out and said so.
    expect(screen.queryByText('Leadership')).not.toBeInTheDocument();
    expect(screen.getByText(/One officer-only section is hidden/)).toBeInTheDocument();
  });

  it("shows only the self-evaluation's items, without a suggested rating, as the member", async () => {
    const user = userEvent.setup();
    renderWithRouter(<TemplatePreviewPanel definition={definition} />);
    await screen.findByText('Scene performance');

    await user.selectOptions(screen.getByLabelText('Show the form as'), 'self_evaluation');

    expect(screen.getByText('Training participation')).toBeInTheDocument();
    expect(screen.queryByText('Scene performance')).not.toBeInTheDocument();
    expect(screen.queryByText(/Suggested:/)).not.toBeInTheDocument();
  });

  it('says what went wrong when the preview fails', async () => {
    preview.mockRejectedValue(new Error('Review period not found.'));
    renderWithRouter(<TemplatePreviewPanel definition={definition} />);

    expect(await screen.findByText('Review period not found.')).toBeInTheDocument();
  });
});
