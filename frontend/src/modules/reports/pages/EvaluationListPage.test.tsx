/**
 * The evaluations list and the draft dialog: a manager may name the
 * evaluator or leave it to the member's supervisor; a conductor is the
 * evaluator of what they draft and is not offered the choice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { DraftOptions, EvaluationSummary } from '../types/evaluations';

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
vi.mock('../services/evaluationsApi', () => ({
  evaluationsService: {
    list: (...a: unknown[]) => list(...a) as unknown,
    draftOptions: (...a: unknown[]) => draftOptions(...a) as unknown,
    create: (...a: unknown[]) => create(...a) as unknown,
  },
}));

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

describe('EvaluationListPage', () => {
  beforeEach(() => {
    for (const m of [list, draftOptions, create, navigate]) m.mockReset();
    list.mockResolvedValue([SUMMARY]);
    draftOptions.mockResolvedValue(OPTIONS);
    create.mockResolvedValue({ ...SUMMARY, id: 'new-ev' });
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
});
