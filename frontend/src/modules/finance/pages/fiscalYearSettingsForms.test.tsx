/**
 * The Finance Settings page's own forms (forms review F-2 to F-7): Create
 * Fiscal Year, the budget category dialog and a draft year's request
 * deadline.
 *
 * A missing or invalid value is named under its field and takes focus, and
 * nothing is sent; a 422 lands on the field it names; a refusal no field
 * answers for is said inside the surface rather than only in a toast. A
 * category edit follows the owner's single-save rule: a refused field is left
 * out and the rest saves.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { BudgetCategory, FiscalYear } from '../types';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const updateYear = vi.fn();
const createCategory = vi.fn();
const updateCategory = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: {
    update: (...args: unknown[]) => updateYear(...args) as unknown,
    startFrom: vi.fn(),
    setPlanningStage: vi.fn(),
    activate: vi.fn(),
    beginClose: vi.fn(),
    lock: vi.fn(),
    adopt: vi.fn(),
    openItems: vi.fn(),
  },
  budgetCategoryService: {
    create: (...args: unknown[]) => createCategory(...args) as unknown,
    update: (...args: unknown[]) => updateCategory(...args) as unknown,
    delete: vi.fn(),
  },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
}));

import FiscalYearSettingsPage from './FiscalYearSettingsPage';

const year = (extra: Partial<FiscalYear> = {}): FiscalYear => ({
  id: 'fy-draft',
  organizationId: 'org',
  name: 'FY2027',
  startDate: '2027-01-01T00:00:00Z',
  endDate: '2027-12-31T00:00:00Z',
  status: 'draft',
  isLocked: false,
  requestDeadline: null,
  requestsOpen: true,
  planningStage: 'requests',
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const training: BudgetCategory = {
  id: 'cat-training',
  organizationId: 'org',
  name: 'Training',
  sortOrder: 0,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const createFiscalYear = vi.fn();
const fetchFiscalYears = vi.fn();
const fetchBudgetCategories = vi.fn();

const page = () => (
  <MemoryRouter initialEntries={['/finance/settings']}>
    <ConfirmProvider>
      <FiscalYearSettingsPage />
    </ConfirmProvider>
  </MemoryRouter>
);

const setStore = (extra: Record<string, unknown> = {}) => {
  storeState = {
    fiscalYears: [year()],
    budgetCategories: [training],
    isLoading: false,
    error: null,
    fetchFiscalYears,
    fetchBudgetCategories,
    activateFiscalYear: vi.fn(),
    createFiscalYear,
    ...extra,
  };
};

const renderPage = (extra: Record<string, unknown> = {}) => {
  setStore(extra);
  return render(page());
};

const unprocessable = (field: string, message: string) => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});
const refusal = (status: number, detail: string) => ({ response: { status, data: { detail } } });

/** The field's accessible description, which is where its error is read out. */
const expectFlagged = (control: HTMLElement, message: string) => {
  expect(control).toHaveAttribute('aria-invalid', 'true');
  expect(control).toHaveAccessibleDescription(expect.stringContaining(message));
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [updateYear, createCategory, updateCategory, createFiscalYear, fetchFiscalYears]) {
    mock.mockReset();
  }
  updateYear.mockResolvedValue(year());
  createCategory.mockResolvedValue(training);
  updateCategory.mockResolvedValue(training);
  createFiscalYear.mockResolvedValue(year());
});

// =============================================================================
// Create Fiscal Year
// =============================================================================

describe('Create Fiscal Year', () => {
  const open = async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New Fiscal Year' }));
    return { user, dialog: screen.getByRole('dialog', { name: 'Create Fiscal Year' }) };
  };

  it('names each missing value under its field, focuses the first and sends nothing', async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    const name = within(dialog).getByLabelText(/^Name/);
    expectFlagged(name, 'Enter a name for the fiscal year');
    expect(name).toHaveFocus();
    expectFlagged(within(dialog).getByLabelText(/^Start Date/), 'Enter the date the fiscal year starts.');
    expectFlagged(within(dialog).getByLabelText(/^End Date/), 'Enter the date the fiscal year ends.');
    expect(createFiscalYear).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('refuses an end date before the start date', async () => {
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(/^Name/), 'FY 2028');
    await user.type(within(dialog).getByLabelText(/^Start Date/), '2028-01-01');
    await user.type(within(dialog).getByLabelText(/^End Date/), '2027-12-31');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    const end = within(dialog).getByLabelText(/^End Date/);
    expectFlagged(end, 'The end date cannot be before the start date.');
    expect(end).toHaveFocus();
    expect(createFiscalYear).not.toHaveBeenCalled();
  });

  it('submits on Enter with what was typed', async () => {
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(/^Start Date/), '2028-01-01');
    await user.type(within(dialog).getByLabelText(/^End Date/), '2028-12-31');
    await user.type(within(dialog).getByLabelText(/^Name/), ' FY 2028 {Enter}');

    await waitFor(() =>
      expect(createFiscalYear).toHaveBeenCalledWith({ name: 'FY 2028', startDate: '2028-01-01', endDate: '2028-12-31' })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Fiscal year created');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('puts a 422 on the field it names', async () => {
    createFiscalYear.mockRejectedValue(unprocessable('name', 'String should have at most 100 characters'));
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(/^Name/), 'FY 2028');
    await user.type(within(dialog).getByLabelText(/^Start Date/), '2028-01-01');
    await user.type(within(dialog).getByLabelText(/^End Date/), '2028-12-31');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    const name = await within(dialog).findByLabelText(/^Name/);
    await waitFor(() => expectFlagged(name, 'Name is too long — keep it to 100 characters.'));
    expect(name).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Create Fiscal Year' })).toBeInTheDocument();
  });

  it('says a refusal no field answers for inside the dialog, keeping what was typed', async () => {
    createFiscalYear.mockRejectedValue(refusal(403, 'You do not have permission to manage finance'));
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(/^Name/), 'FY 2028');
    await user.type(within(dialog).getByLabelText(/^Start Date/), '2028-01-01');
    await user.type(within(dialog).getByLabelText(/^End Date/), '2028-12-31');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You do not have permission to manage finance');
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('FY 2028');
  });

  it('keeps the dialog and its values through the skeleton the first create shows', async () => {
    const user = userEvent.setup();
    setStore({ fiscalYears: [] });
    const { rerender } = render(page());
    await user.click(screen.getByRole('button', { name: 'New Fiscal Year' }));
    await user.type(screen.getByLabelText(/^Name/), 'FY 2028');

    // What the store does while the first year's create is in flight.
    setStore({ fiscalYears: [], isLoading: true });
    rerender(page());
    setStore({ fiscalYears: [] });
    rerender(page());

    expect(screen.getByRole('dialog', { name: 'Create Fiscal Year' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('FY 2028');
  });

  it('asks before Cancel throws typed values away', async () => {
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(/^Name/), 'FY 2028');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText(/^Name/)).toHaveValue('FY 2028');
  });
});

// =============================================================================
// Budget category dialog
// =============================================================================

describe('the budget category dialog', () => {
  it('names a missing name under its field on create and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New Category' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Budget Category' });
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    const name = within(dialog).getByLabelText(/^Name/);
    expectFlagged(name, 'Enter a name for the category');
    expect(name).toHaveFocus();
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('puts a create 422 on the field it names', async () => {
    createCategory.mockRejectedValue(unprocessable('qb_account_name', 'String should have at most 200 characters'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New Category' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Budget Category' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Fuel');
    await user.type(within(dialog).getByLabelText(/^QuickBooks account/), 'Fuel Expense');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    const account = within(dialog).getByLabelText(/^QuickBooks account/);
    await waitFor(() => expectFlagged(account, 'QuickBooks account is too long — keep it to 200 characters.'));
    expect(account).toHaveFocus();
  });

  it('puts a create 422 on the charge access control it names', async () => {
    createCategory.mockRejectedValue(unprocessable('charge_access', 'Choose who can charge these lines.'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New Category' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Budget Category' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Fuel');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    const access = within(dialog).getByRole('combobox', { name: 'Who can charge these lines' });
    await waitFor(() => expect(access).toHaveAttribute('aria-invalid', 'true'));
    expect(access).toHaveAccessibleDescription(expect.stringContaining('Choose who can charge these lines.'));
    expect(access).toHaveFocus();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a refusal of a field it has no control for inside the dialog', async () => {
    createCategory.mockRejectedValue(unprocessable('fiscal_year_id', 'That fiscal year is closed.'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'New Category' }));
    const dialog = screen.getByRole('dialog', { name: 'Create Budget Category' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Fuel');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That fiscal year is closed.');
  });

  it('keeps the stored charge rule and its positions together when an edit refuses either', async () => {
    updateCategory
      .mockRejectedValueOnce(unprocessable('charge_position_ids', 'Choose at least one position.'))
      .mockResolvedValueOnce(training);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Training' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Budget Category' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(2));
    expect(updateCategory).toHaveBeenLastCalledWith('cat-training', {
      name: 'Training',
      description: null,
      ownerPositionId: null,
      qbAccountName: null,
      functionalClass: null,
      parentCategoryId: null,
    });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Saved, except the field flagged below');
  });

  it('saves the rest of an edit when the server refuses one field, and flags it', async () => {
    updateCategory
      .mockRejectedValueOnce(unprocessable('qb_account_name', 'String should have at most 200 characters'))
      .mockResolvedValueOnce(training);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Training' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Budget Category' });
    await user.type(within(dialog).getByLabelText(/^QuickBooks account/), 'Training Expense');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(2));
    expect(updateCategory).toHaveBeenLastCalledWith('cat-training', {
      name: 'Training',
      description: null,
      ownerPositionId: null,
      functionalClass: null,
      parentCategoryId: null,
      chargeAccess: null,
      chargePositionIds: [],
    });
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Saved, except the field flagged below');
    expectFlagged(
      within(dialog).getByLabelText(/^QuickBooks account/),
      'QuickBooks account is too long — keep it to 200 characters.'
    );
    expect(fetchBudgetCategories).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('leaves a blanked name out of an edit, keeping the stored one, and flags it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Training' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Budget Category' });
    await user.clear(within(dialog).getByLabelText(/^Name/));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(1));
    const [, body] = updateCategory.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('name');
    expect(body).toHaveProperty('description', null);
    const name = within(dialog).getByLabelText(/^Name/);
    expectFlagged(name, 'Enter a name for the category');
    expect(name).toHaveFocus();
  });

  it('says an edit refusal no field answers for inside the dialog', async () => {
    updateCategory.mockRejectedValue(refusal(400, 'A category cannot be its own parent'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Training' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Budget Category' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A category cannot be its own parent');
    expect(updateCategory).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Request deadline
// =============================================================================

describe('the request deadline form', () => {
  it('names an empty deadline on the field when there is none to clear', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Save deadline' }));

    const input = screen.getByLabelText('Request deadline');
    expectFlagged(input, 'Choose the last day line owners can make requests.');
    expect(input).toHaveFocus();
    expect(updateYear).not.toHaveBeenCalled();
  });

  it('saves on Enter', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Request deadline'), '2026-11-15{Enter}');

    await waitFor(() => expect(updateYear).toHaveBeenCalledWith('fy-draft', { requestDeadline: '2026-11-15' }));
  });

  it('puts a 422 on the field', async () => {
    updateYear.mockRejectedValue(unprocessable('request_deadline', 'Invalid date format'));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Request deadline'), '2026-11-15');
    await user.click(screen.getByRole('button', { name: 'Save deadline' }));

    const input = screen.getByLabelText('Request deadline');
    await waitFor(() => expectFlagged(input, 'Request deadline needs a valid date.'));
    expect(input).toHaveFocus();
  });

  it('says a refusal no field answers for in the card, not only in a toast', async () => {
    updateYear.mockRejectedValue(refusal(400, 'Fiscal year is locked and cannot be modified'));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Request deadline'), '2026-11-15');
    await user.click(screen.getByRole('button', { name: 'Save deadline' }));

    const message = await screen.findByText('Fiscal year is locked and cannot be modified');
    expect(message).toHaveAttribute('role', 'alert');
    expect(toastError).not.toHaveBeenCalled();
  });
});
