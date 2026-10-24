/**
 * Fixing and withdrawing what a member raised, on the screens.
 *
 * On a draft expense report its member adds, edits and removes lines; they
 * withdraw their own draft report or check request, and the finance office
 * cancels one further along. Whether each is allowed is the server's to say
 * (FinanceService); these prove each button calls it and is offered only to
 * someone it would accept.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-20',
}));
const fundOptions = { funds: [], mode: 'warn' };
vi.mock('../hooks/useFundOptions', () => ({ useFundOptions: () => fundOptions }));

const permissions = new Set<string>();
let userId = 'u-alice';
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => permissions.has(p), user: { id: userId } }),
}));

const mockAddLine = vi.fn();
const mockUpdateLine = vi.fn();
const mockDeleteLine = vi.fn();
const mockCancelReport = vi.fn();
const mockCancelCheck = vi.fn();
vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    financeSettingsService: { get: () => Promise.reject(new Error('not needed')) },
    expenseReportService: {
      ...actual.expenseReportService,
      addLineItem: (...args: unknown[]) => mockAddLine(...args) as unknown,
      updateLineItem: (...args: unknown[]) => mockUpdateLine(...args) as unknown,
      deleteLineItem: (...args: unknown[]) => mockDeleteLine(...args) as unknown,
      cancel: (...args: unknown[]) => mockCancelReport(...args) as unknown,
    },
    checkRequestService: {
      ...actual.checkRequestService,
      cancel: (...args: unknown[]) => mockCancelCheck(...args) as unknown,
    },
  };
});

import ExpenseReportDetailPage from './ExpenseReportDetailPage';
import CheckRequestDetailPage from './CheckRequestDetailPage';

const stamps = {
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  createdAt: '2026-10-01T15:00:00Z',
  updatedAt: '2026-10-01T15:00:00Z',
  approvalSteps: [],
};

const line = (overrides: Record<string, unknown> = {}) => ({
  id: 'li-1',
  expenseReportId: 'er-1',
  description: 'Boots',
  amount: '120.00',
  dateIncurred: '2026-10-10T12:00:00Z',
  expenseType: 'general',
  merchant: 'Gear Shop',
  receiptDocumentId: 'doc-1',
  createdAt: '2026-10-10T12:00:00Z',
  ...overrides,
});

const report = (overrides: Record<string, unknown> = {}) => ({
  ...stamps,
  id: 'er-1',
  reportNumber: 'ER-2026-0004',
  title: 'Uniform',
  submittedBy: 'u-alice',
  totalAmount: '120.00',
  status: 'draft',
  lineItems: [line()],
  ...overrides,
});

const check = (overrides: Record<string, unknown> = {}) => ({
  ...stamps,
  id: 'ck-1',
  requestNumber: 'CK-2026-0009',
  requestedBy: 'u-alice',
  payeeName: 'Hose Supply Co',
  amount: '80.00',
  status: 'draft',
  ...overrides,
});

const fetchReport = vi.fn();
const fetchCheck = vi.fn();

const renderPage = (path: string, route: string, Page: React.FC) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<Page />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

const showReport = (entity: Record<string, unknown>) => {
  storeState = { selectedExpenseReport: entity, isLoading: false, error: null, fetchExpenseReport: fetchReport };
  renderPage('/finance/expenses/er-1', '/finance/expenses/:id', ExpenseReportDetailPage);
};

const showCheck = (entity: Record<string, unknown>) => {
  storeState = { selectedCheckRequest: entity, isLoading: false, error: null, fetchCheckRequest: fetchCheck };
  renderPage('/finance/check-requests/ck-1', '/finance/check-requests/:id', CheckRequestDetailPage);
};

const asMember = () => {
  permissions.clear();
  permissions.add('finance.request');
  userId = 'u-alice';
};

const asOffice = () => {
  permissions.clear();
  permissions.add('finance.manage');
  userId = 'u-treasurer';
};

const confirmIn = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }));
};

describe('a draft expense report', () => {
  beforeEach(() => {
    asMember();
    for (const mock of [mockAddLine, mockUpdateLine, mockDeleteLine, mockCancelReport, fetchReport]) {
      mock.mockReset();
    }
    mockAddLine.mockResolvedValue(line({ id: 'li-2' }));
    mockUpdateLine.mockResolvedValue(line());
    mockDeleteLine.mockResolvedValue(undefined);
    mockCancelReport.mockResolvedValue(report({ status: 'cancelled' }));
  });

  it('lets its member edit a line, sending a cleared merchant as null and leaving the date alone', async () => {
    const user = userEvent.setup();
    showReport(report());

    await user.click(screen.getByRole('button', { name: 'Edit line: Boots' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Date *')).toHaveValue('2026-10-10');
    fireEvent.change(within(dialog).getByLabelText('Amount *'), { target: { value: '115.5' } });
    await user.clear(within(dialog).getByLabelText('Merchant'));
    await user.click(within(dialog).getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(mockUpdateLine).toHaveBeenCalled());
    expect(mockUpdateLine).toHaveBeenCalledWith('er-1', 'li-1', {
      description: 'Boots',
      amount: '115.50',
      expenseType: 'general',
      merchant: null,
      fundCampaignId: null,
    });
    await waitFor(() => expect(fetchReport).toHaveBeenCalledWith('er-1'));
  });

  it('sends a changed date as noon on the day chosen', async () => {
    const user = userEvent.setup();
    showReport(report());

    await user.click(screen.getByRole('button', { name: 'Edit line: Boots' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Date *'), { target: { value: '2026-10-12' } });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(mockUpdateLine).toHaveBeenCalled());
    expect(mockUpdateLine.mock.calls[0]?.[2]).toMatchObject({ dateIncurred: '2026-10-12T12:00:00.000Z' });
  });

  it('adds a line', async () => {
    const user = userEvent.setup();
    showReport(report());

    await user.click(screen.getByRole('button', { name: /Add line/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Description *'), 'Gloves');
    fireEvent.change(within(dialog).getByLabelText('Amount *'), { target: { value: '30' } });
    await user.click(within(dialog).getByRole('button', { name: 'Add line' }));

    await waitFor(() => expect(mockAddLine).toHaveBeenCalled());
    expect(mockAddLine).toHaveBeenCalledWith('er-1', {
      description: 'Gloves',
      amount: '30.00',
      dateIncurred: '2026-10-20T12:00:00.000Z',
      expenseType: 'general',
    });
  });

  it('says what is missing rather than sending a line with no description', async () => {
    const user = userEvent.setup();
    showReport(report());

    await user.click(screen.getByRole('button', { name: /Add line/ }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Amount *'), { target: { value: '30' } });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add line' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Description is required');
    expect(mockAddLine).not.toHaveBeenCalled();
  });

  it('removes a line once the member confirms', async () => {
    const user = userEvent.setup();
    showReport(report());

    await user.click(screen.getByRole('button', { name: 'Remove line: Boots' }));
    await confirmIn(user, 'Remove line');

    await waitFor(() => expect(mockDeleteLine).toHaveBeenCalledWith('er-1', 'li-1'));
  });

  it('offers adding a line when every line has been removed', () => {
    showReport(report({ lineItems: [], totalAmount: '0.00' }));

    expect(screen.getByText(/No lines yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add line/ })).toBeInTheDocument();
  });

  it('is withdrawn by its member once they confirm', async () => {
    const user = userEvent.setup();
    showReport(report());

    await user.click(screen.getByRole('button', { name: /Withdraw Report/ }));
    await confirmIn(user, 'Withdraw report');

    await waitFor(() => expect(mockCancelReport).toHaveBeenCalledWith('er-1'));
  });
});

describe('a submitted expense report', () => {
  beforeEach(() => {
    mockCancelReport.mockReset();
    mockCancelReport.mockResolvedValue(report({ status: 'cancelled' }));
  });

  it('can no longer be changed or withdrawn by its member', () => {
    asMember();
    showReport(report({ status: 'pending_approval' }));

    expect(screen.queryByRole('button', { name: /Add line/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit line: Boots' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw Report|Cancel Report/ })).not.toBeInTheDocument();
  });

  it('is cancelled by the finance office', async () => {
    asOffice();
    const user = userEvent.setup();
    showReport(report({ status: 'approved' }));

    await user.click(screen.getByRole('button', { name: /Cancel Report/ }));
    await confirmIn(user, 'Cancel report');

    await waitFor(() => expect(mockCancelReport).toHaveBeenCalledWith('er-1'));
  });

  it('is not offered for cancelling while a check is paying it', () => {
    asOffice();
    showReport(
      report({
        status: 'approved',
        reimbursementCheckId: 'ck-1',
        reimbursementCheckNumber: 'CK-2026-0001',
        reimbursementCheckStatus: 'pending_approval',
      })
    );

    expect(screen.queryByRole('button', { name: /Cancel Report/ })).not.toBeInTheDocument();
  });
});

describe('a check request', () => {
  beforeEach(() => {
    mockCancelCheck.mockReset();
    mockCancelCheck.mockResolvedValue(check({ status: 'cancelled' }));
  });

  it('is withdrawn by its member while a draft', async () => {
    asMember();
    const user = userEvent.setup();
    showCheck(check());

    await user.click(screen.getByRole('button', { name: /Withdraw Request/ }));
    await confirmIn(user, 'Withdraw request');

    await waitFor(() => expect(mockCancelCheck).toHaveBeenCalledWith('ck-1'));
  });

  it('is cancelled by the finance office before it is issued', async () => {
    asOffice();
    const user = userEvent.setup();
    showCheck(check({ status: 'pending_approval' }));

    await user.click(screen.getByRole('button', { name: /Cancel Request/ }));
    await confirmIn(user, 'Cancel request');

    await waitFor(() => expect(mockCancelCheck).toHaveBeenCalledWith('ck-1'));
  });

  it('is voided, not cancelled, once issued', () => {
    asOffice();
    showCheck(check({ status: 'issued', checkNumber: '1042' }));

    expect(screen.queryByRole('button', { name: /Cancel Request|Withdraw Request/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Void Request/ })).toBeInTheDocument();
  });

  it('cannot be withdrawn by its member once submitted', () => {
    asMember();
    showCheck(check({ status: 'pending_approval' }));

    expect(screen.queryByRole('button', { name: /Cancel Request|Withdraw Request/ })).not.toBeInTheDocument();
  });
});
