/**
 * The substantiation deadline on the expense screens.
 *
 * The form warns a member about a line older than the department's deadline
 * while they enter it — advice only; the server grades lines at submission —
 * and the report's own page says which lines were late and whether an approver
 * has confirmed them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { ExpenseLineItem, ExpenseReport } from '../types';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-12',
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => p === 'finance.approve', user: { id: 'u-chief' } }),
}));
// One object for every render: the form re-seeds its year whenever the list
// changes, so a fresh array per call would re-render it forever.
const formOptions = {
  fiscalYears: [{ id: 'fy-1', name: 'FY2026', status: 'active' }],
  budgetOptions: [],
  fiscalYearsLoaded: true,
};
vi.mock('../hooks/useRequestFormOptions', () => ({
  useRequestFormOptions: () => formOptions,
}));

const mockGetSettings = vi.fn();
vi.mock('../services/api', () => ({
  financeSettingsService: { get: (...args: unknown[]) => mockGetSettings(...args) as unknown },
  approvalService: { manualApprove: vi.fn(), manualDeny: vi.fn() },
  expenseReportService: { uploadLineItemReceipt: vi.fn(), downloadLineItemReceipt: vi.fn() },
}));

import ExpenseReportFormPage from './ExpenseReportFormPage';
import ExpenseReportDetailPage from './ExpenseReportDetailPage';

const rules = (substantiationMode: string, substantiationDays = 60) => ({
  dualApprovalThreshold: null,
  substantiationMode,
  substantiationDays,
});

beforeEach(() => {
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue(rules('warn'));
  storeState = { createExpenseReport: vi.fn() };
});

// ============================================
// The form
// ============================================

const renderForm = () =>
  render(
    <MemoryRouter initialEntries={['/finance/expenses/new']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/finance/expenses/new" element={<ExpenseReportFormPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

const enterDate = async (value: string) => {
  const user = userEvent.setup();
  renderForm();
  await user.click(screen.getByRole('button', { name: /Add Item/ }));
  // Settled before the date goes in, so the warning reads the loaded rule.
  await vi.waitFor(() => expect(mockGetSettings).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Date *'), { target: { value } });
};

describe('the expense form', () => {
  it('warns about a line older than the deadline under "warn"', async () => {
    await enterDate('2026-08-12');

    expect(
      await screen.findByText(/More than 60 days ago. An approver will have to confirm this line/)
    ).toBeInTheDocument();
  });

  it('says the report cannot be submitted under "block"', async () => {
    mockGetSettings.mockResolvedValue(rules('block', 30));
    await enterDate('2026-09-11');

    expect(
      await screen.findByText(/More than 30 days ago. The department does not accept expenses this old/)
    ).toBeInTheDocument();
  });

  it('says nothing on the last day of the deadline', async () => {
    await enterDate('2026-08-13');

    expect(screen.queryByText(/More than 60 days ago/)).not.toBeInTheDocument();
  });

  it('says nothing when the rule is off', async () => {
    mockGetSettings.mockResolvedValue(rules('off'));
    await enterDate('2025-01-01');

    expect(screen.queryByText(/days ago/)).not.toBeInTheDocument();
  });
});

// ============================================
// The report's page
// ============================================

const line = (id: string, description: string, substantiatedLate: boolean): ExpenseLineItem => ({
  id,
  expenseReportId: 'er-1',
  description,
  amount: '50.00',
  dateIncurred: '2026-06-01T00:00:00Z',
  expenseType: 'travel',
  createdAt: '2026-09-15T00:00:00Z',
  substantiatedLate,
});

const renderReport = (over: Partial<ExpenseReport>) => {
  storeState = {
    selectedExpenseReport: {
      id: 'er-1',
      organizationId: 'org-1',
      fiscalYearId: 'fy-1',
      reportNumber: 'ER-2026-0007',
      title: 'Conference',
      submittedBy: 'u-alice',
      totalAmount: '100.00',
      status: 'pending_approval',
      lineItems: [line('li-1', 'Hotel', true), line('li-2', 'Parking', false)],
      approvalSteps: [],
      lateLineCount: 1,
      createdAt: '2026-09-15T00:00:00Z',
      updatedAt: '2026-09-15T00:00:00Z',
      ...over,
    },
    isLoading: false,
    error: null,
    fetchExpenseReport: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={['/finance/expenses/er-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/finance/expenses/:id" element={<ExpenseReportDetailPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
};

describe("the report's page", () => {
  it('marks the late line and says an approver has to confirm it', () => {
    renderReport({});

    expect(
      screen.getByText('1 line was submitted after the department’s deadline for claiming expenses.')
    ).toBeInTheDocument();
    expect(screen.getByText(/An approver has to confirm reviewing them/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Hotel/ })).toHaveTextContent('Submitted late');
    expect(screen.getByRole('row', { name: /Parking/ })).not.toHaveTextContent('Submitted late');
  });

  it('says when an approver confirmed them', () => {
    renderReport({ status: 'approved', lateAcknowledgedAt: '2026-09-20T15:00:00Z' });

    expect(screen.getByText(/An approver confirmed reviewing them on/)).toBeInTheDocument();
  });

  it('says nothing about a report with no late lines', () => {
    renderReport({ lateLineCount: 0, lineItems: [line('li-2', 'Parking', false)] });

    expect(screen.queryByText(/deadline for claiming expenses/)).not.toBeInTheDocument();
  });
});
