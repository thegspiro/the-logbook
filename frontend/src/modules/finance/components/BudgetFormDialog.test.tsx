/**
 * The new-line form offers only categories that take new budget lines.
 *
 * A category is closed when it or a parent is inactive; the backend reports
 * the second case as `inactiveThrough` and refuses a new line on it, so the
 * picker leaves both out rather than offering a choice the save will refuse.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { BudgetCategory, FiscalYear } from '../types';

vi.mock('../hooks/useBudgetFormOptions', () => ({
  useBudgetFormOptions: () => ({ positions: [], stations: [] }),
  withCurrent: (options: unknown[]) => options,
}));
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: {
    create: (...args: unknown[]) => mockCreate(...args) as unknown,
    update: (...args: unknown[]) => mockUpdate(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

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
    // The dialog asks before discarding a changed form, so it needs the provider the app shell mounts.
    render(
      <ConfirmProvider>
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
      </ConfirmProvider>
    );

    const select = screen.getByLabelText(/^Category/);
    const offered = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toEqual(['Choose a category', 'Training']);
  });
});

const refusal = (field: string, message: string) => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

const renderDialog = (props: Partial<React.ComponentProps<typeof BudgetFormDialog>> = {}) => {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  render(
    <ConfirmProvider>
      <BudgetFormDialog
        {...handlers}
        fiscalYears={[year]}
        categories={[category({ id: 'train', name: 'Training', path: ['Training'] })]}
        {...props}
      />
    </ConfirmProvider>
  );
  return handlers;
};

describe('BudgetFormDialog server refusals and discarding', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  it("puts a new line's refused amount under the amount and creates nothing", async () => {
    mockCreate.mockRejectedValue(refusal('amount_budgeted', 'Expected a number.'));
    const user = userEvent.setup();
    const { onSaved } = renderDialog();
    await user.selectOptions(screen.getByLabelText(/^Category/), 'train');
    await user.type(screen.getByLabelText(/^Amount budgeted/), '1200');
    await user.click(screen.getByRole('button', { name: 'Add budget line' }));

    const amount = screen.getByLabelText(/^Amount budgeted/);
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    expect(amount).toHaveAccessibleDescription('Amount budgeted needs a number.');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit, keeps the refused notes flagged, and reports the line on close', async () => {
    const budget = {
      id: 'b-1',
      fiscalYearId: 'fy-1',
      categoryId: 'train',
      amountBudgeted: '100.00',
      amountEditable: true,
      notes: 'Old',
    } as React.ComponentProps<typeof BudgetFormDialog>['budget'];
    mockUpdate.mockRejectedValueOnce(refusal('notes', 'Notes must be plain text.'));
    mockUpdate.mockResolvedValueOnce({ id: 'b-1' });
    const user = userEvent.setup();
    const { onSaved } = renderDialog({ budget });
    const notes = screen.getByLabelText('Notes');
    await user.clear(notes);
    await user.type(notes, 'New');
    await user.click(screen.getByRole('button', { name: 'Save budget line' }));

    await waitFor(() => expect(notes).toHaveAttribute('aria-invalid', 'true'));
    expect(notes).toHaveAccessibleDescription('Notes must be plain text.');
    expect(notes).toHaveValue('New');
    expect(mockUpdate).toHaveBeenLastCalledWith('b-1', {
      amountBudgeted: '100.00',
      stationId: null,
      ownerPositionId: null,
    });
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onSaved).toHaveBeenCalledWith({ id: 'b-1' });
  });

  it('asks before Escape or Cancel throws away a changed form', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(screen.getByLabelText('Notes'), 'Half a thought');

    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Notes')).toHaveValue('Half a thought');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
