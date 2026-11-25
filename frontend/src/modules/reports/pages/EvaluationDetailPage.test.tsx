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
const sign = vi.fn();
const documentBlob = vi.fn();
const remove = vi.fn();
const amend = vi.fn();
const saveResponse = vi.fn();
const submitResponse = vi.fn();
const saveBlob = vi.fn();
const listStepAssigneeCandidates = vi.fn();
const assignStep = vi.fn();
const history = vi.fn();
// The caller's permissions; none unless a test grants one.
let permissions: string[] = [];
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) as unknown }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { full_name: string }; checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ user: { full_name: 'Pat Member' }, checkPermission: (p) => permissions.includes(p) }),
}));
vi.mock('../services/evaluationsApi', () => ({
  evaluationsService: {
    get: (...a: unknown[]) => get(...a) as unknown,
    savePart: (...a: unknown[]) => savePart(...a) as unknown,
    submitPart: (...a: unknown[]) => submitPart(...a) as unknown,
    refreshData: (...a: unknown[]) => refreshData(...a) as unknown,
    completeCalibration: (...a: unknown[]) => completeCalibration(...a) as unknown,
    sign: (...a: unknown[]) => sign(...a) as unknown,
    document: (...a: unknown[]) => documentBlob(...a) as unknown,
    remove: (...a: unknown[]) => remove(...a) as unknown,
    amend: (...a: unknown[]) => amend(...a) as unknown,
    saveResponse: (...a: unknown[]) => saveResponse(...a) as unknown,
    submitResponse: (...a: unknown[]) => submitResponse(...a) as unknown,
    listStepAssigneeCandidates: (...a: unknown[]) => listStepAssigneeCandidates(...a) as unknown,
    assignStep: (...a: unknown[]) => assignStep(...a) as unknown,
    history: (...a: unknown[]) => history(...a) as unknown,
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
    signatures: [],
    document_available: false,
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
    for (const m of [
      get,
      savePart,
      submitPart,
      refreshData,
      completeCalibration,
      sign,
      documentBlob,
      saveBlob,
      remove,
      amend,
      saveResponse,
      submitResponse,
      listStepAssigneeCandidates,
      assignStep,
    ])
      m.mockReset();
    get.mockResolvedValue(detail());
  });

  it('shows the figure and the suggested rating beside the item', async () => {
    renderPage();
    expect(await screen.findAllByText('11.5 h')).not.toHaveLength(0);
    expect(screen.getByText('Suggested: Level 4')).toBeInTheDocument();
  });

  it('shows the last review’s grades and goals, and links to it', async () => {
    get.mockResolvedValue(
      detail({
        previous_review: {
          evaluation_id: 'ev0',
          period_name: '2025 Annual',
          period_start: '2025-01-01',
          period_end: '2025-12-31',
          overall: 'Exceeds expectations',
          sections: [{ key: 'core', title: 'Core duties', label: 'Meets expectations' }],
          goals: [{ key: 'next', label: 'Goals for next year', text: 'Finish driver training.' }],
        },
      })
    );
    renderPage();

    const panel = await screen.findByRole('region', { name: 'Last review' });
    expect(within(panel).getByText('Exceeds expectations')).toBeInTheDocument();
    expect(within(panel).getByText('Meets expectations')).toBeInTheDocument();
    expect(within(panel).getByText('Finish driver training.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Open the last review' })).toHaveAttribute(
      'href',
      '/reports/evaluations/ev0'
    );
  });

  describe('review history', () => {
    beforeEach(() => {
      history.mockReset();
      history.mockResolvedValue([]);
      permissions = [];
    });

    it("lists the member's other finalized reviews with their grades for view_all", async () => {
      permissions = ['evaluations.view_all'];
      history.mockResolvedValue([
        {
          evaluation_id: 'ev-2025',
          template_name: 'Operational Annual',
          period_name: '2025 Annual',
          period_start: '2025-01-01',
          period_end: '2025-12-31',
          overall: 'Meets expectations',
        },
        {
          evaluation_id: 'ev-2024',
          template_name: 'Probationary Check-in',
          period_name: null,
          period_start: '2024-01-01',
          period_end: '2024-06-30',
          overall: null,
        },
      ]);
      renderPage();

      const panel = await screen.findByRole('region', { name: 'Review history' });
      // The section is drawn before its effect asks for the history, so the
      // call is only certain once an entry has arrived.
      expect(await within(panel).findByRole('link', { name: '2025 Annual' })).toHaveAttribute(
        'href',
        '/reports/evaluations/ev-2025'
      );
      expect(history).toHaveBeenCalledWith('ev1');
      expect(within(panel).getByText('Meets expectations')).toBeInTheDocument();
      expect(within(panel).getByText('Probationary Check-in')).toBeInTheDocument();
      expect(within(panel).getByText('No overall result')).toBeInTheDocument();
    });

    it('says when there is no other review', async () => {
      permissions = ['evaluations.view_all'];
      renderPage();

      expect(await screen.findByText('No other finalized reviews of this member.')).toBeInTheDocument();
    });

    it('is neither shown nor asked for without view_all', async () => {
      renderPage();
      expect(await screen.findAllByText('11.5 h')).not.toHaveLength(0);

      expect(screen.queryByRole('region', { name: 'Review history' })).not.toBeInTheDocument();
      expect(history).not.toHaveBeenCalled();
    });
  });

  describe('self-evaluation beside the evaluation', () => {
    const part = (kind: string, status: 'draft' | 'submitted', rating: number) => ({
      kind,
      status,
      content: { answers: { training: { rating } } },
      submitted_at: status === 'submitted' ? '2027-01-10T12:00:00Z' : null,
      updated_at: null,
    });

    it("marks an item far apart, following the evaluator's draft as they rate", async () => {
      get.mockResolvedValue(
        detail({ parts: [part('self_evaluation', 'submitted', 5), part('evaluator', 'draft', 2)] })
      );
      const user = userEvent.setup();
      renderPage();

      const panel = await screen.findByRole('region', { name: 'Self-evaluation beside the evaluation' });
      expect(within(panel).getByText('Far apart')).toBeInTheDocument();
      expect(within(panel).getByText('Level 5')).toBeInTheDocument();
      expect(within(panel).getByText('Level 2')).toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: /Level 4/ }));

      expect(within(panel).queryByText('Far apart')).not.toBeInTheDocument();
      expect(within(panel).getByText('No rated item is far apart.')).toBeInTheDocument();
    });

    it('is not shown until the member has submitted their self-evaluation', async () => {
      get.mockResolvedValue(detail({ parts: [part('self_evaluation', 'draft', 5), part('evaluator', 'draft', 2)] }));
      renderPage();
      expect(await screen.findAllByText('11.5 h')).not.toHaveLength(0);

      expect(screen.queryByRole('region', { name: 'Self-evaluation beside the evaluation' })).not.toBeInTheDocument();
    });
  });

  it('shows no last review when the server sends none', async () => {
    renderPage();
    expect(await screen.findAllByText('11.5 h')).not.toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Last review' })).not.toBeInTheDocument();
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

  it('saves unsaved edits before Update figures replaces the part', async () => {
    const saved = (content: unknown) =>
      detail({
        parts: [
          { kind: 'evaluator', status: 'draft', content: content as never, submitted_at: null, updated_at: null },
        ],
      });
    let stored: unknown = { answers: {} };
    savePart.mockImplementation((_id: string, _kind: string, content: unknown) => {
      stored = content;
      return Promise.resolve(saved(content));
    });
    refreshData.mockImplementation(() => Promise.resolve(saved(stored)));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /Level 4/ }));
    await user.click(screen.getByRole('button', { name: 'Update figures' }));

    await waitFor(() => expect(refreshData).toHaveBeenCalledWith('ev1'));
    expect(savePart).toHaveBeenCalledTimes(1);
    expect(savePart.mock.invocationCallOrder[0]).toBeLessThan(refreshData.mock.invocationCallOrder[0] ?? 0);
    expect(screen.getByRole('radio', { name: /Level 4/ })).toBeChecked();
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
    await waitFor(() => expect(completeCalibration).toHaveBeenCalledWith('ev1', []));
  });

  it('lets a calibrator flag the evaluator’s items to revisit', async () => {
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
    await user.click(screen.getByRole('checkbox', { name: 'Training' }));
    await user.click(screen.getByRole('button', { name: 'Mark complete, 1 flagged' }));
    await waitFor(() => expect(completeCalibration).toHaveBeenCalledWith('ev1', ['training']));
  });

  it('marks the items the calibrator flagged on the evaluator’s form', async () => {
    get.mockResolvedValue(detail({ calibration_flags: ['training'] }));
    renderPage();
    expect(await screen.findByText('Flagged at calibration')).toBeInTheDocument();
  });

  describe('signing', () => {
    const memberViewer = {
      is_member: true,
      is_evaluator: false,
      can_edit_self_evaluation: false,
      can_edit_evaluation: false,
      can_refresh_data: false,
      can_calibrate: false,
      can_sign: {
        step_key: 'member_acknowledgement',
        label: 'Member acknowledgement',
        dispositions: ['acknowledged', 'refused'] as ('acknowledged' | 'refused')[],
      },
    };

    beforeEach(() => {
      get.mockResolvedValue(detail({ viewer: memberViewer }));
    });

    it('signs only once a name is typed and the intent confirmed, saying so on each field', async () => {
      sign.mockResolvedValue({
        outcome: 'finalized',
        evaluation: detail({
          status: 'finalized',
          document_available: true,
          viewer: { ...memberViewer, can_sign: null },
        }),
      });
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Member acknowledgement' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/does not mean you agree with it/)).toBeInTheDocument();
      const submit = within(dialog).getByRole('button', { name: 'Acknowledge receipt' });
      await user.click(submit);
      expect(within(dialog).getByLabelText(/^Type your full name to sign/)).toHaveAccessibleDescription(
        'Type your full name to sign.'
      );

      await user.type(within(dialog).getByLabelText(/^Type your full name to sign/), 'Pat Member');
      await user.click(submit);
      expect(within(dialog).getByRole('checkbox', { name: /intend this typed name/ })).toHaveAccessibleDescription(
        'Confirm that the typed name is your signature.'
      );
      expect(sign).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('checkbox', { name: /intend this typed name/ }));
      await user.click(submit);

      await waitFor(() =>
        expect(sign).toHaveBeenCalledWith('ev1', {
          signed_name: 'Pat Member',
          disposition: 'acknowledged',
          comment: undefined,
          intent_confirmed: true,
        })
      );
      expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    });

    it('asks for a reason before a refusal can be sent', async () => {
      sign.mockResolvedValue({ outcome: 'finalized', evaluation: detail() });
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Member acknowledgement' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('radio', { name: /Refuse to sign/ }));
      await user.type(within(dialog).getByLabelText(/^Type your full name to sign/), 'Pat Member');
      await user.click(within(dialog).getByRole('checkbox', { name: /intend this typed name/ }));
      const submit = within(dialog).getByRole('button', { name: 'Refuse to sign' });
      await user.click(submit);
      expect(within(dialog).getByLabelText(/Reason for refusing/)).toHaveAccessibleDescription(
        'Say why you are refusing to sign.'
      );
      expect(sign).not.toHaveBeenCalled();
      await user.type(within(dialog).getByLabelText(/Reason for refusing/), 'I dispute the rating.');
      await user.click(submit);
      await waitFor(() =>
        expect(sign).toHaveBeenCalledWith(
          'ev1',
          expect.objectContaining({ disposition: 'refused', comment: 'I dispute the rating.' })
        )
      );
    });
  });

  it('lists the signatures and downloads the frozen PDF', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    documentBlob.mockResolvedValue(blob);
    get.mockResolvedValue(
      detail({
        status: 'finalized',
        document_available: true,
        signatures: [
          {
            step_key: 'member_acknowledgement',
            label: 'Member acknowledgement',
            signed_name: 'Pat Member',
            disposition: 'refused',
            comment: 'I dispute the rating.',
            signed_at: '2027-01-20T14:15:00Z',
          },
        ],
      })
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/Refused to sign by/)).toBeInTheDocument();
    expect(screen.getByText('Reason: I dispute the rating.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'evaluation-2026-12-31.pdf'));
  });

  it('deletes only with a reason, and only when the server offers it', async () => {
    remove.mockResolvedValue({});
    get.mockResolvedValue(detail({ viewer: { ...detail().viewer, can_delete: true } }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirmDelete = screen.getByRole('button', { name: 'Delete evaluation' });
    await user.click(confirmDelete);
    expect(screen.getByLabelText(/Reason \(shown to Pat Member\)/)).toHaveAccessibleDescription(
      'Give a reason. Pat Member will read it.'
    );
    expect(remove).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Reason \(shown to Pat Member\)/), '  Drafted twice.  ');
    await user.click(confirmDelete);
    await waitFor(() => expect(remove).toHaveBeenCalledWith('ev1', 'Drafted twice.'));
  });

  it('returns a reader without the conduct list to where they came from after a delete', async () => {
    permissions = ['evaluations.delete'];
    remove.mockResolvedValue({});
    get.mockResolvedValue(
      detail({ viewer: { ...detail().viewer, can_delete: true, can_edit_evaluation: false, can_refresh_data: false } })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.type(screen.getByLabelText(/Reason \(shown to Pat Member\)/), 'Drafted twice.');
    await user.click(screen.getByRole('button', { name: 'Delete evaluation' }));

    await waitFor(() => expect(window.location.pathname).toBe('/members/my-crew'));
    permissions = [];
  });

  it('offers no delete when the server does not', async () => {
    renderPage();
    await screen.findAllByText('11.5 h');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('amends only with a reason, and shows the amendment with its reason', async () => {
    const amended = detail({
      revision: 2,
      amendments: [
        {
          from_revision: 1,
          to_revision: 2,
          reason: 'Corrected a comment.',
          amended_by_name: 'Chief Reyes',
          amended_at: '2027-02-01T15:00:00Z',
        },
      ],
    });
    amend.mockResolvedValue(amended);
    get.mockResolvedValue(detail({ status: 'finalized', viewer: { ...detail().viewer, can_amend: true } }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Amend' }));
    const confirmAmend = screen.getByRole('button', { name: 'Amend evaluation' });
    await user.click(confirmAmend);
    expect(screen.getByLabelText(/Reason \(shown to Pat Member\)/)).toHaveAccessibleDescription(
      'Give a reason. Pat Member will read it.'
    );
    expect(amend).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Reason \(shown to Pat Member\)/), ' Corrected a comment. ');
    await user.click(confirmAmend);
    await waitFor(() => expect(amend).toHaveBeenCalledWith('ev1', 'Corrected a comment.'));
    expect(await screen.findByRole('heading', { name: 'Amendments' })).toBeInTheDocument();
    expect(screen.getByText('Reason: Corrected a comment.')).toBeInTheDocument();
  });

  it('puts a 422 on the delete reason and announces it', async () => {
    remove.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'reason', message: 'String should have at most 2000 characters' }] },
      },
    });
    get.mockResolvedValue(detail({ viewer: { ...detail().viewer, can_delete: true } }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.type(screen.getByLabelText(/Reason \(shown to Pat Member\)/), 'Drafted twice.');
    await user.click(screen.getByRole('button', { name: 'Delete evaluation' }));

    const reason = screen.getByLabelText(/Reason \(shown to Pat Member\)/);
    await waitFor(() => expect(reason).toHaveAccessibleDescription('Reason is too long — keep it to 2000 characters.'));
    expect(reason).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks before the amend reason is thrown away', async () => {
    get.mockResolvedValue(detail({ status: 'finalized', viewer: { ...detail().viewer, can_amend: true } }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Amend' }));
    await user.type(screen.getByLabelText(/Reason \(shown to Pat Member\)/), 'Corrected a comment.');
    await user.click(screen.getByRole('button', { name: 'Keep it final' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(screen.getByLabelText(/Reason \(shown to Pat Member\)/)).toHaveValue('Corrected a comment.');
  });

  describe('the member’s written response', () => {
    const member = {
      is_member: true,
      is_evaluator: false,
      can_edit_self_evaluation: false,
      can_edit_evaluation: false,
      can_refresh_data: false,
      can_calibrate: false,
    };
    const responsePart = (status: 'draft' | 'submitted', text: string) => ({
      kind: 'member_response' as const,
      status,
      content: { answers: {}, overall_comment: text },
      submitted_at: status === 'submitted' ? '2027-02-01T15:00:00Z' : null,
      updated_at: null,
    });

    it('saves a draft, then submits it only after confirming', async () => {
      const open = detail({
        status: 'finalized',
        response_due: '2027-03-01',
        viewer: { ...member, can_respond: true },
      });
      get.mockResolvedValue(open);
      saveResponse.mockResolvedValue({ ...open, parts: [responsePart('draft', 'I led two drills.')] });
      submitResponse.mockResolvedValue({
        ...open,
        parts: [responsePart('submitted', 'I led two drills.')],
        viewer: { ...member, can_respond: false },
      });
      const user = userEvent.setup();
      renderPage();
      const box = await screen.findByLabelText('Response');
      expect(screen.getByRole('button', { name: 'Submit response' })).toBeDisabled();
      await user.type(box, '  I led two drills.  ');
      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(saveResponse).toHaveBeenCalledWith('ev1', 'I led two drills.'));

      await user.click(await screen.findByRole('button', { name: 'Submit response' }));
      const confirmButtons = await screen.findAllByRole('button', { name: 'Submit response' });
      await user.click(confirmButtons[confirmButtons.length - 1] as HTMLElement);
      await waitFor(() => expect(submitResponse).toHaveBeenCalledWith('ev1'));
      expect(await screen.findByText(/Submitted .*after the evaluation was final/)).toBeInTheDocument();
      expect(screen.queryByLabelText('Response')).not.toBeInTheDocument();
    });

    it('shows officers the submitted response and offers the signed PDF beside it', async () => {
      const blob = new Blob(['%PDF'], { type: 'application/pdf' });
      documentBlob.mockResolvedValue(blob);
      get.mockResolvedValue(
        detail({
          status: 'finalized',
          document_available: true,
          response_document_available: true,
          parts: [responsePart('submitted', 'I disagree with item two.')],
        })
      );
      const user = userEvent.setup();
      renderPage();
      expect(await screen.findByRole('heading', { name: "Member's written response" })).toBeInTheDocument();
      expect(screen.getByText('I disagree with item two.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Signed PDF, without response' }));
      await waitFor(() => expect(documentBlob).toHaveBeenCalledWith('ev1', 'signed'));
      await user.click(screen.getByRole('button', { name: 'Download PDF' }));
      await waitFor(() => expect(saveBlob).toHaveBeenLastCalledWith(blob, 'evaluation-2026-12-31-with-response.pdf'));
    });
  });
});

describe('EvaluationDetailPage — naming who takes a step', () => {
  const approval = {
    key: 'chief_approval',
    type: 'approval' as const,
    label: 'Chief approval',
    order: 2,
    status: 'pending' as const,
    due_date: '2027-02-10',
    completed_at: null,
  };
  const managed = (overrides: Partial<EvaluationDetail> = {}) =>
    detail({
      steps: [...detail().steps, approval],
      viewer: { ...detail().viewer, is_evaluator: false, can_edit_evaluation: false, can_assign_steps: true },
      ...overrides,
    });

  beforeEach(() => {
    get.mockReset();
    listStepAssigneeCandidates.mockReset();
    assignStep.mockReset();
    listStepAssigneeCandidates.mockResolvedValue([
      { id: 'u2', name: 'Riley Lieutenant' },
      { id: 'u3', name: 'Sam Captain' },
    ]);
  });

  it('names the chosen member on the step and shows them', async () => {
    get.mockResolvedValue(managed());
    assignStep.mockResolvedValue(
      managed({ steps: [...detail().steps, { ...approval, assignee: { id: 'u2', name: 'Riley Lieutenant' } }] })
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Assign Chief approval' }));
    expect(listStepAssigneeCandidates).toHaveBeenCalledWith('ev1', 'chief_approval');
    const select = await screen.findByLabelText('Completed by');
    await screen.findByRole('option', { name: 'Riley Lieutenant' });
    await user.selectOptions(select, 'u2');
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(assignStep).toHaveBeenCalledWith('ev1', 'chief_approval', 'u2'));
    expect(await screen.findByText('Assigned to Riley Lieutenant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change who takes Chief approval' })).toBeInTheDocument();
  });

  it('hands a named step back to the position with null', async () => {
    const named = { ...approval, assignee: { id: 'u2', name: 'Riley Lieutenant' } };
    get.mockResolvedValue(managed({ steps: [...detail().steps, named] }));
    assignStep.mockResolvedValue(managed());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Change who takes Chief approval' }));
    await screen.findByRole('option', { name: 'Riley Lieutenant' });
    await user.selectOptions(screen.getByLabelText('Completed by'), '');
    await user.click(screen.getByRole('button', { name: 'Hand back' }));

    await waitFor(() => expect(assignStep).toHaveBeenCalledWith('ev1', 'chief_approval', null));
  });

  it('offers no assigning to a viewer the server did not allow it', async () => {
    get.mockResolvedValue(detail({ steps: [...detail().steps, approval] }));
    renderPage();

    expect(await screen.findByText('Chief approval')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign Chief approval/ })).not.toBeInTheDocument();
  });
});
