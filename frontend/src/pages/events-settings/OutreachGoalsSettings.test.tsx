import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OutreachGoalsResponse } from '../../services/outreachGoalServices';
import type { CrrActivityType } from '../../types/crr';

const list = vi.fn();
const create = vi.fn();
const updateTarget = vi.fn();
const remove = vi.fn();
vi.mock('../../services/outreachGoalServices', () => ({
  outreachGoalService: {
    list: (...args: unknown[]) => list(...args) as unknown,
    create: (...args: unknown[]) => create(...args) as unknown,
    updateTarget: (...args: unknown[]) => updateTarget(...args) as unknown,
    remove: (...args: unknown[]) => remove(...args) as unknown,
  },
}));
const getCatalogue = vi.fn();
vi.mock('../../services/crrServices', () => ({
  crrService: { getCatalogue: (...args: unknown[]) => getCatalogue(...args) as unknown },
}));

import { renderWithRouter } from '../../test/utils';
import OutreachGoalsSettings from './OutreachGoalsSettings';

const smoke: CrrActivityType = {
  id: 't-smoke',
  code: 'smoke_alarm_install',
  name: 'Smoke alarm install',
  description: null,
  is_system: true,
  is_active: true,
  sort_order: 0,
  measures: [
    { id: 'm-alarms', code: 'alarms_installed', label: 'Alarms installed', is_active: true, sort_order: 0 },
    { id: 'm-old', code: 'old', label: 'Retired count', is_active: false, sort_order: 1 },
  ],
  tag_ids: [],
  admin_hours_category_id: null,
};

const METRICS: OutreachGoalsResponse['metrics'] = [
  { value: 'events_held', label: 'Events held' },
  { value: 'people_reached', label: 'People reached' },
  { value: 'member_hours', label: 'Member hours' },
];

const response = (overrides: Partial<OutreachGoalsResponse> = {}): OutreachGoalsResponse => ({
  year: 2026,
  current_year: 2026,
  year_fraction: 0.5,
  year_complete: false,
  goals: [
    {
      id: 'g-events',
      year: 2026,
      kind: 'outreach',
      measure_id: null,
      outreach_metric: 'events_held',
      label: 'Events held',
      target: 40,
      actual: 24,
      pace_target: 20,
      met: false,
      on_pace: true,
    },
  ],
  metrics: METRICS,
  ...overrides,
});

describe('OutreachGoalsSettings', () => {
  beforeEach(() => {
    for (const mock of [list, create, updateTarget, remove, getCatalogue]) mock.mockReset();
    list.mockResolvedValue(response());
    getCatalogue.mockResolvedValue({ activity_types: [smoke], tags: [] });
  });

  it("lists this year's goals and offers last year and next year", async () => {
    renderWithRouter(<OutreachGoalsSettings />);

    const goals = await screen.findByRole('list', { name: 'Goals for 2026' });
    expect(within(goals).getByRole('listitem', { name: 'Events held' })).toBeInTheDocument();
    const years = screen.getByRole('group', { name: 'Year' });
    expect(
      within(years)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['2025', '2026', '2027']);
    expect(within(years).getByRole('button', { name: '2026' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers only figures without a goal, and only active counts', async () => {
    renderWithRouter(<OutreachGoalsSettings />);

    const picker = await screen.findByLabelText('Figure');
    const offered = within(picker)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(offered).toEqual(['Choose a figure…', 'People reached', 'Member hours', 'Alarms installed']);
  });

  it('adds a goal for a CRR count', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue(response());
    renderWithRouter(<OutreachGoalsSettings />);

    await user.selectOptions(await screen.findByLabelText('Figure'), 'measure:m-alarms');
    await user.type(screen.getByLabelText('Target', { selector: '#goal-new-target' }), '200');
    await user.click(screen.getByRole('button', { name: 'Add goal' }));

    expect(create).toHaveBeenCalledWith({
      year: 2026,
      target: 200,
      measure_id: 'm-alarms',
      outreach_metric: undefined,
    });
  });

  it('adds a goal for an outreach figure', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue(response());
    renderWithRouter(<OutreachGoalsSettings />);

    await user.selectOptions(await screen.findByLabelText('Figure'), 'metric:people_reached');
    await user.type(screen.getByLabelText('Target', { selector: '#goal-new-target' }), '1500');
    await user.click(screen.getByRole('button', { name: 'Add goal' }));

    expect(create).toHaveBeenCalledWith({
      year: 2026,
      target: 1500,
      measure_id: undefined,
      outreach_metric: 'people_reached',
    });
  });

  it("changes a goal's target", async () => {
    const user = userEvent.setup();
    updateTarget.mockResolvedValue(response());
    renderWithRouter(<OutreachGoalsSettings />);

    const item = await screen.findByRole('listitem', { name: 'Events held' });
    const field = within(item).getByLabelText('Target');
    await user.clear(field);
    await user.type(field, '55');
    await user.click(within(item).getByRole('button', { name: 'Save' }));

    expect(updateTarget).toHaveBeenCalledWith('g-events', 55);
  });

  it('removes a goal only after confirming', async () => {
    const user = userEvent.setup();
    remove.mockResolvedValue(undefined);
    renderWithRouter(<OutreachGoalsSettings />);

    await user.click(await screen.findByRole('button', { name: 'Remove the goal for Events held' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove the goal for Events held' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(remove).toHaveBeenCalledWith('g-events');
  });

  it('loads another year when it is chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutreachGoalsSettings />);

    list.mockResolvedValue(response({ year: 2027, goals: [] }));
    await user.click(await screen.findByRole('button', { name: '2027' }));

    expect(list).toHaveBeenLastCalledWith(2027);
    expect(await screen.findByText('No goals set for 2027.')).toBeInTheDocument();
  });

  it('shows its load error', async () => {
    list.mockRejectedValue(new Error('The server is down'));
    renderWithRouter(<OutreachGoalsSettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The server is down');
  });
});
