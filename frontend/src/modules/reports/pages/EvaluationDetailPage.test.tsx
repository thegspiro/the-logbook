/**
 * The evaluation page renders what the server says this viewer may see and
 * do: the editable part saves as a draft and locks only on a confirmed
 * submit, a departure from the suggested rating asks for a reason, and a
 * member sees nothing of the evaluator's work until it is released.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderWithRouter } from '../../../test/utils';
import type { EvaluationDetail } from '../types/evaluations';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const get = vi.fn();
const savePart = vi.fn();
const submitPart = vi.fn();
const refreshData = vi.fn();
const completeCalibration = vi.fn();
vi.mock('../services/evaluationsApi', () => ({
  evaluationsService: {
    get: (...a: unknown[]) => get(...a) as unknown,
    savePart: (...a: unknown[]) => savePart(...a) as unknown,
    submitPart: (...a: unknown[]) => submitPart(...a) as unknown,
    refreshData: (...a: unknown[]) => refreshData(...a) as unknown,
    completeCalibration: (...a: unknown[]) => completeCalibration(...a) as unknown,
  },
}));

import EvaluationDetailPage from './EvaluationDetailPage';

const LEVELS = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: `Level ${v}`, anchor: `Behavior ${v}` }));

function detail(overrides: Partial<EvaluationDetail> = {}): EvaluationDetail {
  return {
    id: 'ev1',
    member: { id: 'm1', name: 'Pat Member' },
    evaluator: { id: 'e1', name: 'Jordan Captain' },
    period_id: 'p1',
    period_name: '2026 Annual',
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    template_name: 'Operational Annual',
    kind: 'annual',
    status: 'in_progress',
    current_step: 'Evaluator',
    current_step_due: '2027-01-30',
    created_at: null,
    coverage_start: '2026-01-01',
    coverage_end: '2026-12-31',
    excluded_ranges: [],
    includes_officer_sections: false,
    definition: {
      overall_mode: 'weighted',
      officer_ranks: [],
      sections: [
        {
          key: 'core',
          title: 'Core duties',
          description: null,
          officer_only: false,
          items: [
            {
              key: 'training',
              label: 'Training',
              help_text: null,
              tool: 'labeled_scale',
              levels: LEVELS,
              allow_na: false,
              weight: 100,
              require_example_for: [5],
              checklist_options: [],
              comment: 'optional',
              include_in_self_evaluation: true,
              data_block: { source: 'training.hours', scoring_rule: null },
            },
          ],
        },
      ],
    },
    overall_levels: [],
    steps: [
      {
        key: 'self_evaluation',
        type: 'self_evaluation',
        label: 'Self-evaluation',
        order: 0,
        status: 'open',
        due_date: '2027-01-14',
        completed_at: null,
      },
      {
        key: 'evaluator',
        type: 'evaluator',
        label: 'Evaluator',
        order: 1,
        status: 'open',
        due_date: '2027-01-30',
        completed_at: null,
      },
    ],
    data: { 'training.hours': { available: true, value: 11.5 } },
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
    suggested_scores: { training: 4 },
    data_taken_at: '2026-11-01T12:00:00Z',
    parts: [],
    weighted_overall: null,
    viewer: {
      is_member: false,
      is_evaluator: true,
      can_edit_self_evaluation: false,
      can_edit_evaluation: true,
      can_refresh_data: true,
      can_calibrate: false,
    },
    ...overrides,
  };
}

function renderPage() {
  window.history.pushState({}, '', '/reports/evaluations/ev1');
  return renderWithRouter(
    <Routes>
      <Route path="/reports/evaluations/:evaluationId" element={<EvaluationDetailPage />} />
    </Routes>
  );
}

describe('EvaluationDetailPage', () => {
  beforeEach(() => {
    for (const m of [get, savePart, submitPart, refreshData, completeCalibration]) m.mockReset();
    get.mockResolvedValue(detail());
  });

  it('shows the figure and the suggested rating beside the item', async () => {
    renderPage();
    expect(await screen.findAllByText('11.5 h')).not.toHaveLength(0);
    expect(screen.getByText('Suggested: Level 4')).toBeInTheDocument();
  });

  it('asks for a reason only when the rating departs from the suggestion', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /Level 3/ }));
    expect(screen.getByLabelText(/Why does your rating differ/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Level 4/ }));
    expect(screen.queryByLabelText(/Why does your rating differ/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Level 5/ }));
    expect(screen.getByLabelText(/Describe a specific example/)).toBeInTheDocument();
  });

  it('saves a draft with the answers given, without submitting', async () => {
    savePart.mockImplementation((_id: string, _kind: string, content: unknown) =>
      Promise.resolve(
        detail({
          parts: [
            { kind: 'evaluator', status: 'draft', content: content as never, submitted_at: null, updated_at: null },
          ],
        })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /Level 4/ }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(savePart).toHaveBeenCalledTimes(1));
    const [id, kind, content] = savePart.mock.calls[0] as [string, string, { answers: Record<string, unknown> }];
    expect([id, kind]).toEqual(['ev1', 'evaluator']);
    expect(content.answers.training).toEqual({ rating: 4, na: false });
    expect(submitPart).not.toHaveBeenCalled();
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
  });

  it('submits only after the evaluator confirms', async () => {
    submitPart.mockResolvedValue({ outcome: 'submitted', evaluation: detail() });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Submit' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(submitPart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitPart).toHaveBeenCalledWith('ev1', 'evaluator'));
  });

  it('shows a member only what the server released, and no calibration step', async () => {
    get.mockResolvedValue(
      detail({
        data: null,
        sources: [],
        suggested_scores: {},
        steps: [
          {
            key: 'self_evaluation',
            type: 'self_evaluation',
            label: 'Self-evaluation',
            order: 0,
            status: 'completed',
            due_date: null,
            completed_at: null,
          },
          {
            key: 'evaluator',
            type: 'evaluator',
            label: 'Evaluator',
            order: 1,
            status: 'open',
            due_date: null,
            completed_at: null,
          },
        ],
        viewer: {
          is_member: true,
          is_evaluator: false,
          can_edit_self_evaluation: false,
          can_edit_evaluation: false,
          can_refresh_data: false,
          can_calibrate: false,
        },
      })
    );
    renderPage();
    expect(
      await screen.findByText('Your evaluation will appear here once your evaluator has completed it.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByText('Figures')).not.toBeInTheDocument();
  });

  it('lets a calibrator record calibration after confirming', async () => {
    get.mockResolvedValue(
      detail({
        viewer: {
          is_member: false,
          is_evaluator: false,
          can_edit_self_evaluation: false,
          can_edit_evaluation: false,
          can_refresh_data: false,
          can_calibrate: true,
        },
      })
    );
    completeCalibration.mockResolvedValue(detail());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Mark calibration complete' }));
    await user.click(await screen.findByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(completeCalibration).toHaveBeenCalledWith('ev1'));
  });
});
