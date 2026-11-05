import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OperationsDashboard, OperationsItem } from '../../services/api';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { renderWithRouter } from '../../test/utils';
import ChiefOperationsDashboard from './ChiefOperationsDashboard';

const item = (key: string, label: string, count: number, extra: Partial<OperationsItem> = {}): OperationsItem => ({
  key,
  label,
  severity: 'info',
  count,
  href: `/${key}`,
  ...extra,
});

const board = (sections: OperationsDashboard['sections']): OperationsDashboard => ({
  generated_at: '2026-11-05T12:00:00Z',
  timezone: 'America/New_York',
  sections,
});

const quietExceptions = {
  key: 'critical_exceptions',
  title: 'Critical exceptions',
  items: [
    item('unassigned_shift_officers', 'Shifts without an officer', 0),
    item('equipment_checks', 'Failed equipment checks', 0),
  ],
};

describe('ChiefOperationsDashboard', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('folds a section with nothing open into one all-clear line', async () => {
    renderWithRouter(<ChiefOperationsDashboard data={board([quietExceptions])} />);

    const section = screen.getByRole('region', { name: 'Critical exceptions' });
    expect(within(section).getByText('All clear · 2 checks')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /Shifts without an officer/ })).not.toBeVisible();

    // The rows are still one click away, so each check can be opened.
    await userEvent.setup().click(within(section).getByText('All clear · 2 checks'));
    const row = within(section).getByRole('button', { name: /Shifts without an officer/ });
    expect(row).toBeVisible();
    expect(row).toHaveTextContent('None');
  });

  it('keeps a section open when any of its rows has something in it', () => {
    renderWithRouter(
      <ChiefOperationsDashboard
        data={board([
          {
            ...quietExceptions,
            items: [
              item('unassigned_shift_officers', 'Shifts without an officer', 2, { most_urgent: 'Nov 6 day shift' }),
              item('equipment_checks', 'Failed equipment checks', 0),
            ],
          },
        ])}
      />
    );

    const section = screen.getByRole('region', { name: 'Critical exceptions' });
    expect(within(section).queryByText(/All clear/)).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /Shifts without an officer/ })).toHaveTextContent(
      'Nov 6 day shift'
    );
  });

  it('describes an empty row in the terms of its own section', () => {
    renderWithRouter(
      <ChiefOperationsDashboard
        data={board([
          {
            key: 'operational_readiness',
            title: 'Operational readiness',
            items: [item('today_shifts', "Today's shifts", 0)],
          },
          {
            key: 'period_trends',
            title: 'Period-over-period trends',
            items: [item('training_records', 'Training records (+0)', 0)],
          },
        ])}
      />
    );

    expect(screen.getByRole('button', { name: /Today's shifts/ })).toHaveTextContent('None scheduled');
    expect(screen.getByRole('button', { name: /Training records/ })).toHaveTextContent('None this period');
    expect(screen.queryByText('None pending')).not.toBeInTheDocument();
  });

  it('opens the row it was given', async () => {
    renderWithRouter(
      <ChiefOperationsDashboard
        data={board([
          { key: 'pending_approvals', title: 'Pending approvals', items: [item('admin_hours', 'Admin hours', 3)] },
        ])}
      />
    );

    await userEvent.setup().click(screen.getByRole('button', { name: /Admin hours/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/admin_hours');
  });
});
