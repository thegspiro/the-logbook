/**
 * Cash advances on the request screens.
 *
 * A member asks for an advance on the check request form; it charges no budget
 * line or fund, and the form warns while one of theirs is overdue (the server
 * refuses the submission). An expense report can account for one of their open
 * advances. The finance office records the cash a member hands back on the
 * advance's own page. Every balance shown is the server's.
 *
 * Owner decisions 2026-11-01: the finance office may raise an advance for a
 * named member, who holds it; a department on the periodic-statement method
 * sees the quarterly statements and the deadline they set.
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
// The permissions the signed-in member holds; a describe that needs the
// finance office sets it in its own beforeEach.
let granted: string[] = [];
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (
    selector: (s: {
      checkPermission: (p: string) => boolean;
      user: { id: string; full_name: string; username: string };
    }) => unknown
  ) =>
    selector({
      checkPermission: (p: string) => granted.includes(p),
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
const mockHolders = vi.fn();
const mockFinanceSettings = vi.fn();
vi.mock('../services/api', () => ({
  advanceService: {
    list: (...args: unknown[]) => mockListAdvances(...args) as unknown,
    get: (...args: unknown[]) => mockGetAdvance(...args) as unknown,
    recordReturn: (...args: unknown[]) => mockRecordReturn(...args) as unknown,
    deleteReturn: (...args: unknown[]) => mockDeleteReturn(...args) as unknown,
    holders: (...args: unknown[]) => mockHolders(...args) as unknown,
  },
  financeSettingsService: { get: (...args: unknown[]) => mockFinanceSettings(...args) as unknown },
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
    granted = [];
    mockListAdvances.mockReset();
    mockListAdvances.mockResolvedValue([]);
    mockHolders.mockReset();
    mockHolders.mockResolvedValue([]);
    mockFinanceSettings.mockReset();
    mockFinanceSettings.mockRejectedValue(new Error('not needed'));
    storeState = { createCheckRequest: vi.fn().mockResolvedValue({ id: 'cr-1' }) };
  });

  it('offers a member no one else to raise it for', async () => {
    const user = userEvent.setup();
    renderAt('/finance/check-requests/new', <CheckRequestFormPage />);

    await user.click(screen.getByLabelText('This is a cash advance to me'));

    expect(screen.queryByLabelText('Advance for')).not.toBeInTheDocument();
    expect(mockHolders).not.toHaveBeenCalled();
  });

  it('words the deadline by the department’s periodic-statement method', async () => {
    mockFinanceSettings.mockResolvedValue({ advanceReturnMethod: 'periodic_statement' });
    const user = userEvent.setup();
    renderAt('/finance/check-requests/new', <CheckRequestFormPage />);

    await user.click(screen.getByLabelText('This is a cash advance to me'));

    expect(await screen.findByText(/statement at the end of each calendar quarter/)).toBeInTheDocument();
    expect(screen.queryByText(/days of the check/)).not.toBeInTheDocument();
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

describe('the finance office raising an advance for a member', () => {
  beforeEach(() => {
    granted = ['finance.manage'];
    mockListAdvances.mockReset();
    mockListAdvances.mockResolvedValue([]);
    mockFinanceSettings.mockReset();
    mockFinanceSettings.mockRejectedValue(new Error('not needed'));
    mockHolders.mockReset();
    mockHolders.mockResolvedValue([
      { id: 'u-alice', name: 'Alice Member', legalName: 'Alice Member' },
      { id: 'u-bob', name: 'Bobby Firefighter', legalName: 'Robert Firefighter' },
    ]);
    storeState = { createCheckRequest: vi.fn().mockResolvedValue({ id: 'cr-1' }) };
  });

  it('names the member, who is the payee and holds the advance', async () => {
    const user = userEvent.setup();
    renderAt('/finance/check-requests/new', <CheckRequestFormPage />);

    await user.click(screen.getByLabelText('This is a cash advance'));
    const holder = screen.getByLabelText('Advance for');
    await screen.findByRole('option', { name: 'Bobby Firefighter' });
    // The officer is offered once, as "Me", not again by name.
    expect(
      within(holder)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Me', 'Bobby Firefighter']);
    expect(screen.getByLabelText('Payee Name *')).toHaveValue('Alice Member');

    await user.selectOptions(holder, 'u-bob');
    // Made out to the member's legal name, and the officer's own overdue
    // advances are no longer the question.
    expect(screen.getByLabelText('Payee Name *')).toHaveValue('Robert Firefighter');
    fireEvent.change(screen.getByLabelText('Amount *'), { target: { value: '400' } });
    await user.selectOptions(screen.getByLabelText('Fiscal Year *'), 'fy-1');
    await user.click(screen.getByRole('button', { name: /Create Check Request/ }));

    const create = storeState.createCheckRequest as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      isAdvance: true,
      advanceHolderId: 'u-bob',
      payeeName: 'Robert Firefighter',
      amount: '400.00',
    });
  });

  it('sends no holder for an advance to the officer themselves', async () => {
    const user = userEvent.setup();
    renderAt('/finance/check-requests/new', <CheckRequestFormPage />);

    await user.click(screen.getByLabelText('This is a cash advance'));
    fireEvent.change(screen.getByLabelText('Amount *'), { target: { value: '50' } });
    await user.selectOptions(screen.getByLabelText('Fiscal Year *'), 'fy-1');
    await user.click(screen.getByRole('button', { name: /Create Check Request/ }));

    const create = storeState.createCheckRequest as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('advanceHolderId');
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

  it('says who raised it on the member’s behalf', async () => {
    mockGetAdvance.mockResolvedValue(detail({ raisedBy: 'u-tess', raisedByName: 'Tess Treasurer' }));
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage />);

    expect(
      await screen.findByText('Raised by Tess Treasurer for Alice Member, who holds the advance.')
    ).toBeInTheDocument();
  });

  it('lists the quarterly statements on the periodic method, and the deadline they set', async () => {
    mockGetAdvance.mockResolvedValue(
      detail({
        returnMethod: 'periodic_statement',
        firstStatementDate: '2026-09-30',
        overdue: true,
        statements: [
          {
            statementDate: '2026-09-30',
            dueDate: '2027-01-28',
            outstanding: '200.00',
            emailedAt: '2026-10-01T12:00:00Z',
            upcoming: false,
          },
          { statementDate: '2026-12-31', dueDate: '2027-04-30', upcoming: true },
        ],
      })
    );
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage={false} />);

    expect(await screen.findByText('Quarterly statements')).toBeInTheDocument();
    expect(screen.getByText(/Quarter ending Sep 30, 2026/)).toHaveTextContent('account for by Jan 28, 2027');
    expect(screen.getByText('Emailed 10/1/2026, listing $200.00')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText(/since this advance's first quarterly statement/)).toBeInTheDocument();
  });

  it('shows no statements on the fixed-date method', async () => {
    mockGetAdvance.mockResolvedValue(detail());
    renderAt('/finance/check-requests/adv-1', <AdvancePanel advanceId="adv-1" canManage={false} />);

    expect(await screen.findByText('ER-2026-0003')).toBeInTheDocument();
    expect(screen.queryByText('Quarterly statements')).not.toBeInTheDocument();
    expect(screen.queryByText(/Raised by/)).not.toBeInTheDocument();
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
