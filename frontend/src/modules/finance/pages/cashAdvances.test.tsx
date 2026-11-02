/**
 * Cash advances on the request screens.
 *
 * A member asks for an advance on the check request form; it charges no budget
 * line or fund, and the form warns while one of theirs is overdue (the server
 * refuses the submission). An expense report can account for one of their open
 * advances. The finance office records the cash a member hands back on the
 * advance's own page. Every balance shown is the server's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { AdvanceDetail, AdvanceSummary } from '../types';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-14',
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (
    selector: (s: {
      checkPermission: (p: string) => boolean;
      user: { id: string; full_name: string; username: string };
    }) => unknown
  ) =>
    selector({
      checkPermission: () => false,
      user: { id: 'u-alice', full_name: 'Alice Member', username: 'alice' },
    }),
}));
// One object for every render: the forms re-seed their year whenever the list
// changes, so a fresh array per call would re-render them forever.
const formOptions = {
  fiscalYears: [{ id: 'fy-1', name: 'FY2026', status: 'active' }],
  budgetOptions: [{ id: 'b-1', categoryName: 'Training', stationName: null, remaining: '100.00' }],
  fiscalYearsLoaded: true,
};
vi.mock('../hooks/useRequestFormOptions', () => ({
  useRequestFormOptions: () => formOptions,
  budgetOptionLabel: (option: { categoryName: string }) => option.categoryName,
  selectableBudgetOptions: (options: unknown[]) => options,
}));
const fundOptions = { funds: [], mode: 'warn' };
vi.mock('../hooks/useFundOptions', () => ({ useFundOptions: () => fundOptions }));

const mockListAdvances = vi.fn();
const mockGetAdvance = vi.fn();
const mockRecordReturn = vi.fn();
const mockDeleteReturn = vi.fn();
vi.mock('../services/api', () => ({
  advanceService: {
    list: (...args: unknown[]) => mockListAdvances(...args) as unknown,
    get: (...args: unknown[]) => mockGetAdvance(...args) as unknown,
    recordReturn: (...args: unknown[]) => mockRecordReturn(...args) as unknown,
    deleteReturn: (...args: unknown[]) => mockDeleteReturn(...args) as unknown,
  },
  financeSettingsService: { get: () => Promise.reject(new Error('not needed')) },
  // Both form pages render ApprovalRoutePreview, which asks for the route on a
  // debounce. Without this the call reached a mock with no such export, and
  // only when the timer fired before teardown, so it failed intermittently.
  approvalChainService: { routePreview: () => Promise.reject(new Error('not needed')) },
}));

import CheckRequestFormPage from './CheckRequestFormPage';
import ExpenseReportFormPage from './ExpenseReportFormPage';
import { AdvancePanel } from '../components/AdvancePanel';

const advance = (overrides: Partial<AdvanceSummary> = {}): AdvanceSummary => ({
  id: 'adv-1',
  requestNumber: 'CK-2026-0007',
  memberId: 'u-alice',
  memberName: 'Alice Member',
  amount: '300.00',
  purpose: 'State fire conference',
  checkNumber: '2001',
  issuedAt: '2026-09-01T12:00:00Z',
  dueAt: '2026-12-30T12:00:00Z',
  accounted: '100.00',
  returned: '0.00',
  outstanding: '200.00',
  overdue: false,
  ...overrides,
});

const renderAt = (path: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmProvider>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('asking for an advance', () => {
  beforeEach(() => {
    mockListAdvances.mockReset();
    mockListAdvances.mockResolvedValue([]);
    storeState = { createCheckRequest: vi.fn().mockResolvedValue({ id: 'cr-1' }) };
  });

  it('is made out to the member and charges no budget line', async () => {
    const user = userEvent.setup();
    renderAt('/finance/check-requests/new', <CheckRequestFormPage />);
    expect(screen.getByLabelText('Budget')).toBeInTheDocument();

    await user.click(screen.getByLabelText('This is a cash advance to me'));

    expect(screen.queryByLabelText('Budget')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Payee Name *')).toHaveValue('Alice Member');
    fireEvent.change(screen.getByLabelText('Amount *'), { target: { value: '250' } });
    await user.selectOptions(screen.getByLabelText('Fiscal Year *'), 'fy-1');
    await user.click(screen.getByRole('button', { name: /Create Check Request/ }));

    const create = storeState.createCheckRequest as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    const payload = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ payeeName: 'Alice Member', amount: '250.00', isAdvance: true });
    expect(payload).not.toHaveProperty('budgetId');
  });

  it('warns while one of the members advances is overdue', async () => {
    mockListAdvances.mockResolvedValue([
      advance({ overdue: true, requestNumber: 'CK-2026-0001', outstanding: '75.00' }),
    ]);
    const user = userEvent.setup();
    renderAt('/finance/check-requests/new', <CheckRequestFormPage />);
    // Not asked until the request is an advance.
    expect(mockListAdvances).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('This is a cash advance to me'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CK-2026-0001 ($75.00 outstanding)');
    expect(alert).toHaveTextContent('cannot be submitted until it is settled');
    expect(mockListAdvances).toHaveBeenCalledWith({ mine: true, outstandingOnly: true });
  });
});

describe('an expense report accounting for an advance', () => {
  beforeEach(() => {
    mockListAdvances.mockReset();
    storeState = { createExpenseReport: vi.fn().mockResolvedValue({ id: 'er-1' }) };
  });

  it('offers only when the member has an open advance', async () => {
    mockListAdvances.mockResolvedValue([]);
    renderAt('/finance/expenses/new', <ExpenseReportFormPage />);

    await vi.waitFor(() => expect(mockListAdvances).toHaveBeenCalled());
    expect(screen.queryByLabelText('Accounts for a cash advance')).not.toBeInTheDocument();
  });

  it('sends the chosen advance with the report', async () => {
    mockListAdvances.mockResolvedValue([advance()]);
    const user = userEvent.setup();
    renderAt('/finance/expenses/new', <ExpenseReportFormPage />);

    const select = await screen.findByLabelText('Accounts for a cash advance');
    expect(within(select).getByRole('option', { name: /CK-2026-0007: \$200\.00 outstanding/ })).toBeInTheDocument();
    await user.selectOptions(select, 'adv-1');
    await user.type(screen.getByPlaceholderText('Brief title for this expense report'), 'Conference');
    await user.click(screen.getByRole('button', { name: /Add Item/ }));
    await user.type(screen.getByPlaceholderText('What was purchased'), 'Hotel');
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Date *'), { target: { value: '2026-10-01' } });
    await user.click(screen.getByRole('button', { name: 'Create Report' }));

    const create = storeState.createExpenseReport as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({ title: 'Conference', advanceId: 'adv-1' });
  });
});

const detail = (overrides: Partial<AdvanceDetail> = {}): AdvanceDetail => ({
  ...advance(),
  reports: [
    {
      id: 'er-1',
      reportNumber: 'ER-2026-0003',
      title: 'Conference',
      status: 'pending_approval',
      totalAmount: '100.00',
      advanceApplied: '100.00',
      submittedAt: '2026-09-20T12:00:00Z',
    },
  ],
  returns: [
    {
      id: 'ret-1',
      amount: '20.00',
      returnedAt: '2026-10-01T12:00:00Z',
      paymentMethod: 'cash',
      createdAt: '2026-10-01T12:00:00Z',
    },
  ],
  ...overrides,
});

describe("the advance's own page", () => {
  beforeEach(() => {
    mockGetAdvance.mockReset();
    mockRecordReturn.mockReset();
    mockDeleteReturn.mockReset();
  });

  it('shows the servers balance, the reports and the returns', async () => {
    mockGetAdvance.mockResolvedValue(detail());
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage={false} />);

    expect(await screen.findByText('ER-2026-0003')).toBeInTheDocument();
    expect(screen.getByText('$100.00 of $100.00')).toBeInTheDocument();
    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    const values = screen.getAllByRole('definition').map((value) => value.textContent);
    expect(values[terms.indexOf('Outstanding')]).toBe('$200.00');
    expect(screen.getByText(/Due by/)).toBeInTheDocument();
    // A member reads it; only the finance office records or removes returns.
    expect(screen.queryByRole('button', { name: 'Record returned cash' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the/ })).not.toBeInTheDocument();
  });

  it('says when it is overdue', async () => {
    mockGetAdvance.mockResolvedValue(detail({ overdue: true }));
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage />);

    expect(await screen.findByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText(/cannot request another advance until it is settled/)).toBeInTheDocument();
  });

  it('records returned cash, prefilled with what is outstanding', async () => {
    mockGetAdvance.mockResolvedValue(detail());
    mockRecordReturn.mockResolvedValue({});
    const user = userEvent.setup();
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage />);

    await user.click(await screen.findByRole('button', { name: 'Record returned cash' }));
    expect(screen.getByLabelText('Amount returned')).toHaveValue(200);
    await user.selectOptions(screen.getByLabelText(/Method/), 'cash');
    await user.click(screen.getByRole('button', { name: 'Record return' }));

    await vi.waitFor(() => expect(mockRecordReturn).toHaveBeenCalled());
    // Today goes as "now": no date is sent.
    expect(mockRecordReturn).toHaveBeenCalledWith('adv-1', {
      amount: '200.00',
      returnedAt: undefined,
      paymentMethod: 'cash',
      reference: undefined,
      notes: undefined,
    });
  });

  it('refuses more than is outstanding before asking the server', async () => {
    mockGetAdvance.mockResolvedValue(detail());
    const user = userEvent.setup();
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage />);

    await user.click(await screen.findByRole('button', { name: 'Record returned cash' }));
    fireEvent.change(screen.getByLabelText('Amount returned'), { target: { value: '250' } });
    await user.click(screen.getByRole('button', { name: 'Record return' }));

    expect(screen.getByText('Only $200.00 of this advance is outstanding.')).toBeInTheDocument();
    expect(mockRecordReturn).not.toHaveBeenCalled();
  });

  it('removes a return only once confirmed, and never one already exported', async () => {
    mockGetAdvance.mockResolvedValue(
      detail({
        returns: [
          ...detail().returns,
          {
            id: 'ret-2',
            amount: '5.00',
            returnedAt: '2026-10-02T12:00:00Z',
            qbExportedAt: '2026-10-03T12:00:00Z',
            createdAt: '2026-10-02T12:00:00Z',
          },
        ],
      })
    );
    mockDeleteReturn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage />);

    await user.click(await screen.findByRole('button', { name: 'Remove the $20.00 return' }));
    expect(screen.queryByRole('button', { name: 'Remove the $5.00 return' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Remove return' }));

    await vi.waitFor(() => expect(mockDeleteReturn).toHaveBeenCalledWith('adv-1', 'ret-1'));
  });
});
