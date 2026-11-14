/**
 * The evaluations list and the draft dialog: a manager may name the
 * evaluator or leave it to the member's supervisor; a conductor is the
 * evaluator of what they draft and is not offered the choice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { BulkDraftPreview, DraftOptions, EvaluationSummary } from '../types/evaluations';

let granted = new Set<string>(['evaluations.conduct', 'evaluations.manage']);
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => granted.has(p) }),
}));

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

const list = vi.fn();
const draftOptions = vi.fn();
const create = vi.fn();
const removed = vi.fn();
const bulkPreview = vi.fn();
const bulkDraft = vi.fn();
const attention = vi.fn();
vi.mock('../services/evaluationsApi', () => ({
  evaluationsService: {
    list: (...a: unknown[]) => list(...a) as unknown,
    attention: (...a: unknown[]) => attention(...a) as unknown,
    draftOptions: (...a: unknown[]) => draftOptions(...a) as unknown,
    create: (...a: unknown[]) => create(...a) as unknown,
    removed: (...a: unknown[]) => removed(...a) as unknown,
    bulkPreview: (...a: unknown[]) => bulkPreview(...a) as unknown,
    bulkDraft: (...a: unknown[]) => bulkDraft(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import EvaluationListPage from './EvaluationListPage';

const SUMMARY: EvaluationSummary = {
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
  current_step: 'Self-evaluation',
  current_step_due: '2027-01-14',
  created_at: null,
};

const OPTIONS: DraftOptions = {
  members: [
    { id: 'm1', name: 'Pat Member' },
    { id: 'e1', name: 'Jordan Captain' },
  ],
  evaluators: [{ id: 'e1', name: 'Jordan Captain' }],
  periods: [{ id: 'p1', name: '2026 Annual', start_date: '2026-01-01', end_date: '2026-12-31' }],
};

const PREVIEW: BulkDraftPreview = {
  period: { id: 'p1', name: '2026 Annual', start_date: '2026-01-01', end_date: '2026-12-31' },
  kind: 'annual',
  rows: [
    {
      member: { id: 'm1', name: 'Pat Member' },
      template: { id: 't1', name: 'Operational Annual' },
      evaluator: { id: 'e1', name: 'Jordan Captain' },
    },
    { member: { id: 'm2', name: 'Lee Recruit' }, skip_reason: 'Served no full month of the period.' },
    { member: { id: 'm3', name: 'Sam Driver' }, template: { id: 't1', name: 'Operational Annual' }, evaluator: null },
    {
      member: { id: 'm4', name: 'Ash Probie' },
      template: { id: 't1', name: 'Operational Annual' },
      evaluator: { id: 'e1', name: 'Jordan Captain' },
    },
  ],
  evaluators: [
    { id: 'e1', name: 'Jordan Captain' },
    { id: 'e2', name: 'Robin Lieutenant' },
  ],
};

describe('EvaluationListPage', () => {
  beforeEach(() => {
    for (const m of [list, draftOptions, create, navigate, removed, bulkPreview, bulkDraft, attention]) m.mockReset();
    attention.mockResolvedValue({ mine: 0, overdue: 0 });
    list.mockResolvedValue([SUMMARY]);
    draftOptions.mockResolvedValue(OPTIONS);
    create.mockResolvedValue({ ...SUMMARY, id: 'new-ev' });
    removed.mockResolvedValue([]);
    bulkPreview.mockResolvedValue(PREVIEW);
    bulkDraft.mockResolvedValue({
      drafted: 1,
      results: [
        { member_id: 'm1', evaluation_id: 'ev9' },
        { member_id: 'm3', error: 'Sam already has an evaluation for 2026 Annual.' },
      ],
    });
    granted = new Set(['evaluations.conduct', 'evaluations.manage']);
  });

  it('lists each evaluation with what it is waiting on', async () => {
    renderWithRouter(<EvaluationListPage />);
    expect(await screen.findByRole('link', { name: 'Pat Member' })).toHaveAttribute('href', '/reports/evaluations/ev1');
    expect(screen.getByText(/Self-evaluation · due/)).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EvaluationListPage />);
    await screen.findByRole('link', { name: 'Pat Member' });
    await user.selectOptions(screen.getByLabelText('Show'), 'finalized');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ status: 'finalized' }));
  });

  it("a manager's draft leaves the evaluator to the server when none is chosen", async () => {
    const user = userEvent.setup();
    renderWithRouter(<EvaluationListPage />);
    await user.click(await screen.findByRole('button', { name: 'New evaluation' }));
    await user.selectOptions(await screen.findByLabelText('Member'), 'm1');
    await user.selectOptions(screen.getByLabelText('Review period'), 'p1');
    expect(screen.getByLabelText('Evaluator')).toHaveValue('');
    const draftButtons = screen.getAllByRole('button', { name: 'Draft evaluation' });
    await user.click(draftButtons[draftButtons.length - 1] as HTMLElement);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ member_id: 'm1', period_id: 'p1', evaluator_id: undefined, kind: 'annual' })
    );
    expect(navigate).toHaveBeenCalledWith('/reports/evaluations/new-ev');
  });

  it('does not offer a conductor the choice of evaluator', async () => {
    granted = new Set(['evaluations.conduct']);
    const user = userEvent.setup();
    renderWithRouter(<EvaluationListPage />);
    await user.click(await screen.findByRole('button', { name: 'New evaluation' }));
    await screen.findByLabelText('Member');
    expect(screen.queryByLabelText('Evaluator')).not.toBeInTheDocument();
    expect(screen.getByText(/You will be the evaluator/)).toBeInTheDocument();
  });

  it('drafts a whole period: previews, lets the manager untick and assign, then reports each one', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EvaluationListPage />);
    await user.click(await screen.findByRole('button', { name: 'Draft a review period' }));
    await user.selectOptions(await screen.findByLabelText('Review period'), 'p1');
    await user.click(screen.getByRole('button', { name: 'Preview members' }));

    expect(await screen.findByText('Served no full month of the period.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Lee Recruit/ })).toBeDisabled();
    // Sam has no evaluator by default, so nothing drafts until one is chosen.
    expect(screen.getByRole('button', { name: 'Draft 3 evaluations' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Evaluator for Sam Driver'), 'e2');
    await user.click(screen.getByRole('checkbox', { name: /Ash Probie/ }));
    await user.click(screen.getByRole('button', { name: 'Draft 2 evaluations' }));

    await waitFor(() =>
      expect(bulkDraft).toHaveBeenCalledWith('p1', 'annual', [
        { member_id: 'm1', evaluator_id: 'e1' },
        { member_id: 'm3', evaluator_id: 'e2' },
      ])
    );
    expect(await screen.findByText(/Drafted 1 evaluation\./)).toBeInTheDocument();
    expect(screen.getByText('Sam Driver: Sam already has an evaluation for 2026 Annual.')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('offers drafting a period only to a manager', async () => {
    granted = new Set(['evaluations.conduct']);
    renderWithRouter(<EvaluationListPage />);
    await screen.findByRole('link', { name: 'Pat Member' });
    expect(screen.queryByRole('button', { name: 'Draft a review period' })).not.toBeInTheDocument();
    expect(removed).not.toHaveBeenCalled();
  });

  it('lists deleted evaluations with their reasons for those who may see them', async () => {
    removed.mockResolvedValue([
      {
        id: 'd1',
        member: { id: 'm1', name: 'Pat Member' },
        period_name: '2025 Annual',
        period_start: '2025-01-01',
        period_end: '2025-12-31',
        template_name: 'Operational Annual',
        evaluator_name: null,
        was_finalized: false,
        reason: 'Drafted twice.',
        deleted_by_name: 'Chief Reyes',
        deleted_at: '2026-02-01T15:00:00Z',
      },
    ]);
    renderWithRouter(<EvaluationListPage />);
    expect(await screen.findByRole('heading', { name: 'Deleted evaluations' })).toBeInTheDocument();
    expect(screen.getByText('Drafted twice.')).toBeInTheDocument();
    expect(screen.getByText(/Pat Member · 2025 Annual/)).toBeInTheDocument();
  });
});
