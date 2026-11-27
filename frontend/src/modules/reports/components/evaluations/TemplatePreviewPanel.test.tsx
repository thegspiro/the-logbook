/**
 * The builder's preview: the unsaved form, filled with sample figures or —
 * for a builder who may read them — a chosen member's, and shown as either
 * the evaluator's form or the member's self-evaluation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';
import type { PreviewOptions, TemplateDefinition, TemplatePreview, TemplateWorkflow } from '../../types/evaluations';

const previewOptions = vi.fn();
const preview = vi.fn();
const previewPdf = vi.fn();
vi.mock('../../services/evaluationsApi', () => ({
  evaluationTemplatesService: {
    previewOptions: (...a: unknown[]) => previewOptions(...a) as unknown,
    preview: (...a: unknown[]) => preview(...a) as unknown,
    previewPdf: (...a: unknown[]) => previewPdf(...a) as unknown,
  },
}));

const saveBlob = vi.fn();
vi.mock('../../../../utils/saveBlob', () => ({
  saveBlob: (...a: unknown[]) => saveBlob(...a) as unknown,
}));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { error: (...a: unknown[]) => toastError(...a) as unknown },
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

const workflow: TemplateWorkflow = {
  steps: [
    {
      key: 'ack',
      type: 'member_acknowledgement',
      label: 'Member acknowledgement',
      actor: { kind: 'member', position_id: null },
      due_days: 58,
    },
  ],
  reminder_days_before: 3,
  evaluator_may_proceed_without_self_evaluation: true,
  response_window_days: 30,
};

const panel = <TemplatePreviewPanel definition={definition} workflow={workflow} templateName="Operational Annual" />;

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

const PDF = new Blob(['%PDF-'], { type: 'application/pdf' });

describe('TemplatePreviewPanel', () => {
  beforeEach(() => {
    previewOptions.mockReset();
    preview.mockReset();
    previewPdf.mockReset();
    saveBlob.mockReset();
    toastError.mockReset();
    previewOptions.mockResolvedValue(OPTIONS);
    preview.mockResolvedValue(result());
    previewPdf.mockResolvedValue(PDF);
  });

  it('shows the unsaved form with sample figures over the latest period', async () => {
    renderWithRouter(panel);

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
    renderWithRouter(panel);
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
    renderWithRouter(panel);
    await screen.findByText('Scene performance');

    await user.selectOptions(screen.getByLabelText('Show the form as'), 'self_evaluation');

    expect(screen.getByText('Training participation')).toBeInTheDocument();
    expect(screen.queryByText('Scene performance')).not.toBeInTheDocument();
    expect(screen.queryByText(/Suggested:/)).not.toBeInTheDocument();
  });

  it('says what went wrong when the preview fails', async () => {
    preview.mockRejectedValue(new Error('Review period not found.'));
    renderWithRouter(panel);

    expect(await screen.findByText('Review period not found.')).toBeInTheDocument();
  });

  describe('downloading the PDF', () => {
    it('sends the form, workflow and choices on screen, and saves the file under the template name', async () => {
      const user = userEvent.setup();
      renderWithRouter(panel);
      await screen.findByText('36 h');
      await user.selectOptions(screen.getByLabelText('Show the form as'), 'self_evaluation');

      await user.click(screen.getByRole('button', { name: 'Download PDF' }));

      await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(PDF, 'Operational Annual - preview.pdf'));
      expect(previewPdf).toHaveBeenCalledWith({
        definition,
        workflow,
        name: 'Operational Annual',
        part: 'self_evaluation',
        memberId: '',
        periodId: 'p1',
      });
      // Sample figures identify nobody, so nothing is asked first.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it("asks before a member's figures leave the Logbook, and sends nothing when declined", async () => {
      previewOptions.mockResolvedValue({
        ...OPTIONS,
        can_use_member_data: true,
        members: [{ id: 'm1', name: 'Pat Member' }],
      });
      preview.mockResolvedValue(result({ sample: false, member_name: 'Pat Member', note: null }));
      const user = userEvent.setup();
      renderWithRouter(panel);
      await screen.findByText('36 h');
      await user.selectOptions(screen.getByLabelText('Figures from'), 'm1');
      await screen.findByText(/Pat Member's figures/);

      await user.click(screen.getByRole('button', { name: 'Download PDF' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('This PDF will show Pat Member’s figures');
      await user.click(screen.getByRole('button', { name: 'Go back' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(previewPdf).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Download PDF' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Download PDF' }));

      await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(PDF, 'Operational Annual - preview.pdf'));
      expect(previewPdf).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm1', part: 'evaluator' }));
    });

    it('says why when the PDF cannot be made, and saves nothing', async () => {
      previewPdf.mockRejectedValue(new Error('Review period not found.'));
      const user = userEvent.setup();
      renderWithRouter(panel);
      await screen.findByText('36 h');

      await user.click(screen.getByRole('button', { name: 'Download PDF' }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith('Review period not found.'));
      expect(saveBlob).not.toHaveBeenCalled();
    });

    it('offers no PDF of a form with nothing in it', async () => {
      renderWithRouter(
        <TemplatePreviewPanel
          definition={{ ...definition, sections: [] }}
          workflow={workflow}
          templateName="Operational Annual"
        />
      );

      await screen.findByText(/Add a section on the Sections/);
      expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    });
  });
});
