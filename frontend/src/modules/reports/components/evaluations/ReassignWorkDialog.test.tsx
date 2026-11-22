/**
 * Handing over open work: the manager picks the period, whose work and to
 * whom, sees what moves and what is skipped and why, and only then hands it
 * over. Nothing changes before that last step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';
import type { ReassignmentPlan } from '../../types/evaluations';

const listPeriods = vi.fn();
const draftOptions = vi.fn();
const reassignmentHolders = vi.fn();
const reassignmentPreview = vi.fn();
const reassign = vi.fn();
vi.mock('../../services/evaluationsApi', () => ({
  evaluationPeriodsService: { list: (...a: unknown[]) => listPeriods(...a) as unknown },
  evaluationsService: {
    draftOptions: (...a: unknown[]) => draftOptions(...a) as unknown,
    reassignmentHolders: (...a: unknown[]) => reassignmentHolders(...a) as unknown,
    reassignmentPreview: (...a: unknown[]) => reassignmentPreview(...a) as unknown,
    reassign: (...a: unknown[]) => reassign(...a) as unknown,
  },
}));

import { ReassignWorkDialog } from './ReassignWorkDialog';

const plan: ReassignmentPlan = {
  from_name: 'Former Captain',
  to_name: 'New Captain',
  rows: [
    {
      evaluation_id: 'ev1',
      member_name: 'Avery Firefighter',
      moves_evaluator: true,
      steps: [],
      skipped_reason: null,
    },
    {
      evaluation_id: 'ev2',
      member_name: 'New Captain',
      moves_evaluator: true,
      steps: [],
      skipped_reason: 'They are the member being evaluated.',
    },
  ],
};

const onReassigned = vi.fn();

async function choose() {
  const user = userEvent.setup();
  renderWithRouter(<ReassignWorkDialog isOpen onClose={() => undefined} onReassigned={onReassigned} />);
  await user.selectOptions(await screen.findByLabelText('Review period'), 'p1');
  await screen.findByRole('option', { name: 'Former Captain (2 evaluations)' });
  await user.selectOptions(screen.getByLabelText('Hand over the work of'), 'old');
  await user.selectOptions(screen.getByLabelText('To'), 'new');
  return user;
}

describe('ReassignWorkDialog', () => {
  beforeEach(() => {
    for (const mock of [listPeriods, draftOptions, reassignmentHolders, reassignmentPreview, reassign, onReassigned]) {
      mock.mockReset();
    }
    listPeriods.mockResolvedValue([
      {
        id: 'p1',
        name: '2026 Annual',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_closed: false,
        evaluations_count: 2,
      },
    ]);
    draftOptions.mockResolvedValue({
      members: [
        { id: 'new', name: 'New Captain' },
        { id: 'avery', name: 'Avery Firefighter' },
      ],
      evaluators: [],
      periods: [],
    });
    reassignmentHolders.mockResolvedValue([{ user_id: 'old', name: 'Former Captain', evaluations: 2 }]);
    reassignmentPreview.mockResolvedValue(plan);
    reassign.mockResolvedValue(plan);
  });

  it('previews what moves and what is skipped before changing anything', async () => {
    const user = await choose();

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(reassignmentHolders).toHaveBeenCalledWith('p1');
    expect(reassignmentPreview).toHaveBeenCalledWith('p1', 'old', 'new');
    expect(await screen.findByText('Avery Firefighter')).toBeInTheDocument();
    expect(screen.getByText('Evaluator')).toBeInTheDocument();
    expect(screen.getByText('Skipped: They are the member being evaluated.')).toBeInTheDocument();
    expect(reassign).not.toHaveBeenCalled();
  });

  it('hands over only after the preview, and says what was done', async () => {
    const user = await choose();
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await user.click(await screen.findByRole('button', { name: 'Hand over 1 evaluation' }));

    expect(reassign).toHaveBeenCalledWith('p1', 'old', 'new');
    expect(await screen.findByText(/Handed the work below from Former Captain to New Captain/)).toBeInTheDocument();
    expect(onReassigned).toHaveBeenCalled();
  });

  it('does not offer to hand over when everything would be skipped', async () => {
    reassignmentPreview.mockResolvedValue({ ...plan, rows: plan.rows.slice(1) });
    const user = await choose();

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByRole('button', { name: 'Hand over 0 evaluations' })).toBeDisabled();
  });
});
