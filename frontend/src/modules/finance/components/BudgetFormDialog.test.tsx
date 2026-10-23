/**
 * The new-line form offers only categories that take new budget lines.
 *
 * A category is closed when it or a parent is inactive; the backend reports
 * the second case as `inactiveThrough` and refuses a new line on it, so the
 * picker leaves both out rather than offering a choice the save will refuse.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { BudgetCategory, FiscalYear } from '../types';

vi.mock('../hooks/useBudgetFormOptions', () => ({
  useBudgetFormOptions: () => ({ positions: [], stations: [] }),
  withCurrent: (options: unknown[]) => options,
}));
vi.mock('../services/api', () => ({
  budgetService: { create: vi.fn(), update: vi.fn() },
}));

import { BudgetFormDialog } from './BudgetFormDialog';

const category = (overrides: Partial<BudgetCategory> & Pick<BudgetCategory, 'id' | 'name'>): BudgetCategory => ({
  organizationId: 'org',
  sortOrder: 0,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const year = { id: 'fy-1', name: 'FY2026', status: 'active' } as FiscalYear;

describe('BudgetFormDialog category choices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves out a category closed by an inactive parent', () => {
    render(
      <BudgetFormDialog
        onClose={vi.fn()}
        onSaved={vi.fn()}
        fiscalYears={[year]}
        categories={[
          category({ id: 'app', name: 'Apparatus', isActive: false, path: ['Apparatus'] }),
          category({
            id: 'pump',
            name: 'Pump repairs',
            parentCategoryId: 'app',
            inactiveThrough: 'Apparatus',
            path: ['Apparatus', 'Pump repairs'],
          }),
          category({ id: 'train', name: 'Training', path: ['Training'] }),
        ]}
      />
    );

    const select = screen.getByLabelText('Category');
    const offered = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toEqual(['Choose a category', 'Training']);
  });
});
