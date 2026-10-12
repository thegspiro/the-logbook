import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { SkillEvaluation } from '../../types/skillEvaluation';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const getRoles = vi.fn();

vi.mock('../../services/skillEvaluationService', () => ({
  skillEvaluationService: {
    list: (...args: unknown[]) => list(...args) as unknown,
    create: (...args: unknown[]) => create(...args) as unknown,
    update: (...args: unknown[]) => update(...args) as unknown,
    remove: (...args: unknown[]) => remove(...args) as unknown,
  },
}));
vi.mock('../../services/api', () => ({
  roleService: { getRoles: (...args: unknown[]) => getRoles(...args) as unknown },
  skillsTestingService: { searchCandidates: vi.fn().mockResolvedValue([]) },
}));

import SkillEvaluationsTab from './SkillEvaluationsTab';
import { describeEvaluators } from '../../utils/skillEvaluators';

const skill = (overrides: Partial<SkillEvaluation> = {}): SkillEvaluation => ({
  id: 's1',
  organization_id: 'o1',
  name: 'Pump Operations',
  description: 'Engage and run the pump',
  category: 'Driver',
  evaluation_criteria: ['Engage pump'],
  passing_requirements: 'All steps',
  allowed_evaluators: null,
  active: true,
  checkoff_count: 0,
  evaluator_members: [],
  created_at: null,
  updated_at: null,
  created_by: null,
  ...overrides,
});

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected element was not rendered');
  return value;
}

const roles = [
  {
    id: 'r1',
    organization_id: 'o1',
    name: 'Driver Trainer',
    slug: 'driver-trainer',
    permissions: [],
    is_system: false,
    priority: 0,
    created_at: '',
    updated_at: '',
  },
];

describe('SkillEvaluationsTab', () => {
  beforeEach(() => {
    list.mockReset();
    create.mockReset();
    update.mockReset();
    remove.mockReset();
    getRoles.mockReset();
    list.mockResolvedValue([]);
    create.mockResolvedValue(skill());
    update.mockResolvedValue(skill());
    remove.mockResolvedValue(undefined);
    getRoles.mockResolvedValue(roles);
  });

  it('explains what a skill is for when none exist', async () => {
    renderWithRouter(<SkillEvaluationsTab />);
    expect(await screen.findByText('No skills defined yet')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(false);
  });

  it('creates a skill, omitting blank optional fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SkillEvaluationsTab />);
    await screen.findByText('No skills defined yet');

    await user.click(present(screen.getAllByRole('button', { name: /add skill/i })[0]));
    await user.type(screen.getByLabelText('Name'), '  Ladder Raise ');
    await user.type(screen.getByLabelText(/criteria/i), 'Foot the ladder\n\nRaise');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({
      name: 'Ladder Raise',
      category: undefined,
      description: undefined,
      evaluation_criteria: ['Foot the ladder', 'Raise'],
      passing_requirements: undefined,
      allowed_evaluators: null,
    });
  });

  it('sends cleared fields as null on edit and saves a position rule', async () => {
    list.mockResolvedValue([skill()]);
    const user = userEvent.setup();
    renderWithRouter(<SkillEvaluationsTab />);

    await user.click(await screen.findByRole('button', { name: /edit/i }));
    await user.clear(screen.getByLabelText(/description/i));
    await user.click(screen.getByLabelText('Members holding these positions'));
    await user.click(await screen.findByLabelText('Driver Trainer'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith('s1', {
      name: 'Pump Operations',
      category: 'Driver',
      description: null,
      evaluation_criteria: ['Engage pump'],
      passing_requirements: 'All steps',
      allowed_evaluators: { type: 'roles', roles: ['driver-trainer'] },
    });
  });

  it('refuses a position rule with no position chosen', async () => {
    list.mockResolvedValue([skill()]);
    const user = userEvent.setup();
    renderWithRouter(<SkillEvaluationsTab />);

    await user.click(await screen.findByRole('button', { name: /edit/i }));
    await user.click(screen.getByLabelText('Members holding these positions'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(update).not.toHaveBeenCalled();
  });

  it('offers Delete only for a skill with no sign-offs', async () => {
    list.mockResolvedValue([skill(), skill({ id: 's2', name: 'SCBA', checkoff_count: 3 })]);
    renderWithRouter(<SkillEvaluationsTab />);

    const cards = await screen.findAllByRole('listitem');
    const unused = present(cards.find((c) => within(c).queryByText('Pump Operations')));
    const used = present(cards.find((c) => within(c).queryByText('SCBA')));
    expect(within(unused).getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(within(used).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(within(used).getByText(/3 sign-offs/)).toBeInTheDocument();
  });

  it('deletes after confirming', async () => {
    list.mockResolvedValue([skill()]);
    const user = userEvent.setup();
    renderWithRouter(<SkillEvaluationsTab />);

    await user.click(await screen.findByRole('button', { name: /delete/i }));
    // The card's own button and the dialog's share a label; the dialog renders last.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2));
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(present(deleteButtons[deleteButtons.length - 1]));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('s1'));
  });
});

describe('describeEvaluators', () => {
  it('names the rule in plain words', () => {
    expect(describeEvaluators(skill(), roles)).toBe('Anyone with training management');
    expect(
      describeEvaluators(skill({ allowed_evaluators: { type: 'roles', roles: ['driver-trainer', 'gone'] } }), roles)
    ).toBe('Positions: Driver Trainer, gone');
    expect(
      describeEvaluators(
        skill({
          allowed_evaluators: { type: 'specific_users', user_ids: ['u1'] },
          evaluator_members: [{ id: 'u1', name: 'Dana X' }],
        }),
        roles
      )
    ).toBe('Named: Dana X');
  });
});
