/**
 * Next-year planning on the Finance Settings page (Treasurer only).
 *
 * A draft fiscal year offers "Start from last year" — copy another year's
 * lines in, confirmed first — and the request deadline line owners' budget
 * requests close on. Whether requests are open is the backend's
 * `requestsOpen`; the page only words it. A cleared deadline goes as `null`
 * so it is actually cleared (CLAUDE.md pitfall #1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { FiscalYear } from '../types';
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

const startFrom = vi.fn();
const updateYear = vi.fn();
const setPlanningStage = vi.fn();
const activate = vi.fn();
const adopt = vi.fn();
const beginClose = vi.fn();
const openItems = vi.fn();
const lock = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: {
    lock: (...args: unknown[]) => lock(...args) as unknown,
    adopt: (...args: unknown[]) => adopt(...args) as unknown,
    beginClose: (...args: unknown[]) => beginClose(...args) as unknown,
    openItems: (...args: unknown[]) => openItems(...args) as unknown,
    startFrom: (...args: unknown[]) => startFrom(...args) as unknown,
    update: (...args: unknown[]) => updateYear(...args) as unknown,
    setPlanningStage: (...args: unknown[]) => setPlanningStage(...args) as unknown,
    activate: (...args: unknown[]) => activate(...args) as unknown,
  },
  budgetCategoryService: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
}));

import FiscalYearSettingsPage from './FiscalYearSettingsPage';

const year = (id: string, name: string, status: FiscalYear['status'], extra: Partial<FiscalYear> = {}): FiscalYear => ({
  id,
  organizationId: 'org',
  name,
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  status,
  isLocked: status === 'closed',
  requestDeadline: null,
  requestsOpen: false,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const fetchFiscalYears = vi.fn();

const renderPage = (fiscalYears: FiscalYear[]) => {
  storeState = {
    fiscalYears,
    budgetCategories: [],
    isLoading: false,
    error: null,
    fetchFiscalYears,
    fetchBudgetCategories: vi.fn(),
    activateFiscalYear: vi.fn(),
    createFiscalYear: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={['/finance/settings']}>
      <ConfirmProvider>
        <FiscalYearSettingsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );
};

const draft = (extra: Partial<FiscalYear> = {}) =>
  year('fy-draft', 'FY2027', 'draft', { requestsOpen: true, planningStage: 'requests', ...extra });
const years = (extra: Partial<FiscalYear> = {}) => [
  draft(extra),
  year('fy-active', 'FY2026', 'active'),
  year('fy-closed', 'FY2025', 'closed'),
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [startFrom, updateYear, setPlanningStage, activate, adopt, beginClose, openItems, lock]) {
    mock.mockReset();
  }
  startFrom.mockResolvedValue({ created: 2, skipped: 1 });
  updateYear.mockResolvedValue(draft());
  setPlanningStage.mockResolvedValue(draft());
  activate.mockResolvedValue(draft());
  adopt.mockResolvedValue(draft({ planningStage: 'adopted' }));
  beginClose.mockResolvedValue(year('fy-active', 'FY2026', 'closed', { isLocked: false }));
  openItems.mockResolvedValue([]);
  lock.mockResolvedValue(year('fy-active', 'FY2026', 'closed'));
});

describe('the request window on a fiscal year row', () => {
  it('shows a draft year’s deadline and that requests are open', () => {
    renderPage(years({ requestDeadline: '2026-11-15' }));

    expect(screen.getByText('Requests close Nov 15, 2026')).toBeInTheDocument();
    expect(screen.getByText('Requests open')).toBeInTheDocument();
    // Only the draft year carries a request window.
    expect(screen.getAllByText(/Requests (open|closed)/)).toHaveLength(1);
  });

  it('says so when the deadline has passed or there is none', () => {
    renderPage(years({ requestsOpen: false }));

    expect(screen.getByText('No request deadline')).toBeInTheDocument();
    expect(screen.getByText('Requests closed')).toBeInTheDocument();
  });

  it('offers no planning controls on an active or closed year', () => {
    renderPage([year('fy-active', 'FY2026', 'active')]);

    expect(screen.queryByLabelText('Start from last year')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Request deadline')).not.toBeInTheDocument();
  });
});

describe('Start from last year', () => {
  it('copies from the active year after confirming, and reports what it did', async () => {
    const user = userEvent.setup();
    renderPage(years());

    expect(screen.getByLabelText('Start from last year')).toHaveValue('fy-active');
    await user.click(screen.getByRole('button', { name: 'Copy lines' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Copy every budget line from FY2026 into FY2027\?/)).toBeInTheDocument();
    expect(startFrom).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Copy lines' }));

    await waitFor(() => expect(startFrom).toHaveBeenCalledWith('fy-draft', 'fy-active'));
    expect(toastSuccess).toHaveBeenCalledWith('2 lines copied, 1 already there');
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('copies from another year when one is chosen', async () => {
    const user = userEvent.setup();
    startFrom.mockResolvedValue({ created: 1, skipped: 0 });
    renderPage(years());

    await user.selectOptions(screen.getByLabelText('Start from last year'), 'fy-closed');
    await user.click(screen.getByRole('button', { name: 'Copy lines' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Copy lines' }));

    await waitFor(() => expect(startFrom).toHaveBeenCalledWith('fy-draft', 'fy-closed'));
    expect(toastSuccess).toHaveBeenCalledWith('1 line copied, 0 already there');
  });

  it('does nothing when the Treasurer backs out', async () => {
    const user = userEvent.setup();
    renderPage(years());

    await user.click(screen.getByRole('button', { name: 'Copy lines' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(startFrom).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal', async () => {
    const user = userEvent.setup();
    startFrom.mockRejectedValue(new Error('Lines can only be copied into a draft fiscal year that is not locked.'));
    renderPage(years());

    await user.click(screen.getByRole('button', { name: 'Copy lines' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Copy lines' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Lines can only be copied into a draft fiscal year that is not locked.')
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('the request deadline', () => {
  it('saves a deadline', async () => {
    const user = userEvent.setup();
    renderPage(years());

    await user.type(screen.getByLabelText('Request deadline'), '2026-11-15');
    await user.click(screen.getByRole('button', { name: 'Save deadline' }));

    await waitFor(() => expect(updateYear).toHaveBeenCalledWith('fy-draft', { requestDeadline: '2026-11-15' }));
    expect(toastSuccess).toHaveBeenCalledWith('Request deadline saved');
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('clears a deadline with null', async () => {
    const user = userEvent.setup();
    renderPage(years({ requestDeadline: '2026-11-15' }));

    expect(screen.getByLabelText('Request deadline')).toHaveValue('2026-11-15');
    await user.click(screen.getByRole('button', { name: 'Clear deadline' }));

    await waitFor(() => expect(updateYear).toHaveBeenCalledWith('fy-draft', { requestDeadline: null }));
    expect(toastSuccess).toHaveBeenCalledWith('Request deadline cleared');
  });
});

describe('planning stages on a draft year', () => {
  it('moves a draft into leadership review after confirming, with no plain Activate', async () => {
    const user = userEvent.setup();
    renderPage(years());

    expect(screen.getByText('Taking requests')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start leadership review' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Owners can no longer make or change requests');
    await user.click(within(dialog).getByRole('button', { name: 'Start leadership review' }));

    await waitFor(() => expect(setPlanningStage).toHaveBeenCalledWith('fy-draft', 'leadership_review'));
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('offers both directions in leadership review, and hides request planning', () => {
    renderPage(years({ planningStage: 'leadership_review', requestsOpen: false }));

    expect(screen.getByText('Leadership review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to requests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to the board' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Request deadline')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record adoption' })).not.toBeInTheDocument();
  });

  it('shows the API’s refusal when a move is refused', async () => {
    const user = userEvent.setup();
    setPlanningStage.mockRejectedValue(new Error('FY2027 is not a draft fiscal year.'));
    renderPage(years());

    await user.click(screen.getByRole('button', { name: 'Start leadership review' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Start leadership review' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('FY2027 is not a draft fiscal year.'));
  });
});

describe('recording the board’s adoption', () => {
  const inBoardReview = () => years({ planningStage: 'board_review', requestsOpen: false });

  it('adopts with the date, the reference and the notes, then fetches again', async () => {
    const user = userEvent.setup();
    renderPage(inBoardReview());

    await user.click(screen.getByRole('button', { name: 'Record adoption' }));
    const dialog = await screen.findByRole('dialog');
    const date = within(dialog).getByLabelText('Date the board adopted it');
    await user.clear(date);
    await user.type(date, '2026-01-05');
    await user.type(within(dialog).getByLabelText('Motion or minutes reference'), '  Motion 2026-01 ');
    await user.type(within(dialog).getByLabelText('Notes (optional)'), 'Passed 5-0');
    await user.click(within(dialog).getByRole('button', { name: 'Record adoption' }));

    await waitFor(() =>
      expect(adopt).toHaveBeenCalledWith('fy-draft', {
        adoptedOn: '2026-01-05',
        adoptionReference: 'Motion 2026-01',
        adoptionNotes: 'Passed 5-0',
      })
    );
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('needs the motion or minutes reference', async () => {
    const user = userEvent.setup();
    renderPage(inBoardReview());

    await user.click(screen.getByRole('button', { name: 'Record adoption' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Record adoption' }));

    expect(await within(dialog).findByText(/Enter the motion or minutes reference/)).toBeInTheDocument();
    expect(adopt).not.toHaveBeenCalled();
  });

  it('never sends a date in the future', async () => {
    const user = userEvent.setup();
    renderPage(inBoardReview());

    await user.click(screen.getByRole('button', { name: 'Record adoption' }));
    const dialog = await screen.findByRole('dialog');
    const date = within(dialog).getByLabelText('Date the board adopted it');
    // The input's max stops the browser submitting it; the dialog's own check
    // backs that up for a browser that ignores max.
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    await user.type(within(dialog).getByLabelText('Motion or minutes reference'), 'Motion 9');
    await user.click(within(dialog).getByRole('button', { name: 'Record adoption' }));

    expect(date).toBeInvalid();
    expect(adopt).not.toHaveBeenCalled();
  });

  it('shows the adoption on a year that was adopted', () => {
    renderPage([
      year('fy-active', 'FY2026', 'active', { adoptedOn: '2025-12-10', adoptionReference: 'Motion 2025-31' }),
    ]);

    expect(screen.getByText('Adopted by the board Dec 10, 2025 · Motion 2025-31')).toBeInTheDocument();
  });
});

describe('starting an adopted year', () => {
  const adopted = () =>
    years({ planningStage: 'adopted', requestsOpen: false, adoptedOn: '2026-09-10', adoptionReference: 'Motion 4' });

  it('starts it after confirming, and fetches again', async () => {
    const user = userEvent.setup();
    renderPage(adopted());

    expect(screen.getByText('Adopted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to|Send to the board/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start the year' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('each line owner is emailed their adopted amounts');
    await user.click(within(dialog).getByRole('button', { name: 'Start the year' }));

    await waitFor(() => expect(activate).toHaveBeenCalledWith('fy-draft'));
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('shows the API’s refusal, such as another year still active', async () => {
    const user = userEvent.setup();
    activate.mockRejectedValue(new Error('FY2026 is still the active fiscal year. Begin its year-end close first.'));
    renderPage(adopted());

    await user.click(screen.getByRole('button', { name: 'Start the year' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Start the year' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('FY2026 is still the active fiscal year. Begin its year-end close first.')
    );
  });
});

describe('the year-end close', () => {
  it('begins the active year’s close after confirming', async () => {
    const user = userEvent.setup();
    renderPage([year('fy-active', 'FY2026', 'active')]);

    expect(screen.queryByRole('button', { name: 'Lock' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Begin year-end close' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('No new purchase requests, expense reports or check requests');
    await user.click(within(dialog).getByRole('button', { name: 'Begin close' }));

    await waitFor(() => expect(beginClose).toHaveBeenCalledWith('fy-active'));
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('nudges the Treasurer once the year has ended', () => {
    renderPage([year('fy-active', 'FY2026', 'active', { closeDue: true })]);

    expect(screen.getByRole('status')).toHaveTextContent('FY2026 ended 12/31/2026. Begin its year-end close');
  });

  it('says nothing while the year is still running', () => {
    renderPage([year('fy-active', 'FY2026', 'active', { closeDue: false })]);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a closing year as Closing, with reopen and lock', () => {
    renderPage([year('fy-active', 'FY2026', 'closed', { isLocked: false, closingStartedAt: '2027-01-04T15:00:00Z' })]);

    expect(screen.getByText('Closing')).toBeInTheDocument();
    expect(screen.getByText(/Year-end close began 1\/4\/2027/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument();
  });

  it('shows a locked year as Closed with its sign-off, and offers nothing', () => {
    renderPage([
      year('fy-closed', 'FY2025', 'closed', { lockedAt: '2026-02-01T15:00:00Z', lockNotes: 'Reconciled to the bank' }),
    ]);

    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Locked 2/1/2026 · Reconciled to the bank')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Lock|Reopen|Begin year-end close/ })).not.toBeInTheDocument();
  });
});

describe('locking a closing year', () => {
  const closing = () => [year('fy-active', 'FY2026', 'closed', { isLocked: false })];

  it('lists what is still open and will not lock', async () => {
    const user = userEvent.setup();
    openItems.mockResolvedValue([
      {
        kind: 'purchase_request',
        entityId: 'pr-1',
        number: 'PR-2026-0042',
        description: 'Hose',
        status: 'approved',
        amount: '250.00',
      },
    ]);
    renderPage(closing());

    await user.click(screen.getByRole('button', { name: 'Lock' }));
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByRole('link', { name: 'PR-2026-0042' })).toHaveAttribute(
      'href',
      '/finance/purchase-requests/pr-1'
    );
    expect(dialog).toHaveTextContent('1 still open');
    expect(dialog).toHaveTextContent('Purchase request · approved · $250.00');
    expect(within(dialog).getByRole('button', { name: 'Lock the year' })).toBeDisabled();
    expect(openItems).toHaveBeenCalledWith('fy-active');
  });

  it('links a pending amendment to the budget line where it is confirmed', async () => {
    const user = userEvent.setup();
    openItems.mockResolvedValue([
      {
        kind: 'budget_amendment',
        entityId: 'b-gear',
        number: 'Amendment to Gear',
        description: 'Nozzles',
        status: 'pending',
        amount: '400.00',
      },
    ]);
    renderPage(closing());

    await user.click(screen.getByRole('button', { name: 'Lock' }));
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByRole('link', { name: 'Amendment to Gear' })).toHaveAttribute(
      'href',
      '/finance/budgets/b-gear'
    );
    expect(dialog).toHaveTextContent('Budget amendment · pending · $400.00');
    expect(within(dialog).getByRole('button', { name: 'Lock the year' })).toBeDisabled();
  });

  it('needs the reconciliation notes, then locks with them', async () => {
    const user = userEvent.setup();
    renderPage(closing());

    await user.click(screen.getByRole('button', { name: 'Lock' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Nothing is open/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Lock the year' }));
    expect(await within(dialog).findByText('Add the reconciliation notes for the sign-off.')).toBeInTheDocument();
    expect(lock).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Reconciliation notes'), '  Reconciled to June 30  ');
    await user.click(within(dialog).getByRole('button', { name: 'Lock the year' }));

    await waitFor(() => expect(lock).toHaveBeenCalledWith('fy-active', { notes: 'Reconciled to June 30' }));
    expect(fetchFiscalYears).toHaveBeenCalled();
  });

  it('shows the API’s refusal', async () => {
    const user = userEvent.setup();
    lock.mockRejectedValue(new Error('FY2026 still has 1 open item: PR-2026-0050.'));
    renderPage(closing());

    await user.click(screen.getByRole('button', { name: 'Lock' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/Nothing is open/);
    await user.type(within(dialog).getByLabelText('Reconciliation notes'), 'Reconciled');
    await user.click(within(dialog).getByRole('button', { name: 'Lock the year' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('FY2026 still has 1 open item: PR-2026-0050.'));
  });
});
