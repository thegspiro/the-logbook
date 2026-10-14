import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import type {
  AdvancesReport,
  AmendmentLogReport,
  BudgetVsActualReport,
  FiscalYear,
  FunctionalExpensesReport,
  FundBalancesReport,
  LateSubstantiationReport,
  PaymentsRegisterReport,
} from '../types';

const mockListYears = vi.fn();
const mockBudgetVsActual = vi.fn();
const mockBudgetVsActualCsv = vi.fn();
const mockAmendmentLog = vi.fn();
const mockAmendmentLogCsv = vi.fn();
const mockRegister = vi.fn();
const mockRegisterCsv = vi.fn();
const mockLate = vi.fn();
const mockFunctional = vi.fn();
const mockFunctionalCsv = vi.fn();
const mockLateCsv = vi.fn();
const mockFunds = vi.fn();
const mockFundsCsv = vi.fn();
const mockAdvances = vi.fn();
const mockAdvancesCsv = vi.fn();

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  fiscalYearService: { list: (...args: unknown[]) => mockListYears(...args) as unknown },
  financeReportService: {
    budgetVsActual: (...args: unknown[]) => mockBudgetVsActual(...args) as unknown,
    budgetVsActualCsv: (...args: unknown[]) => mockBudgetVsActualCsv(...args) as unknown,
    amendmentLog: (...args: unknown[]) => mockAmendmentLog(...args) as unknown,
    amendmentLogCsv: (...args: unknown[]) => mockAmendmentLogCsv(...args) as unknown,
    paymentsRegister: (...args: unknown[]) => mockRegister(...args) as unknown,
    paymentsRegisterCsv: (...args: unknown[]) => mockRegisterCsv(...args) as unknown,
    lateSubstantiation: (...args: unknown[]) => mockLate(...args) as unknown,
    functionalExpenses: (...args: unknown[]) => mockFunctional(...args) as unknown,
    functionalExpensesCsv: (...args: unknown[]) => mockFunctionalCsv(...args) as unknown,
    lateSubstantiationCsv: (...args: unknown[]) => mockLateCsv(...args) as unknown,
    fundBalances: (...args: unknown[]) => mockFunds(...args) as unknown,
    fundBalancesCsv: (...args: unknown[]) => mockFundsCsv(...args) as unknown,
    advances: (...args: unknown[]) => mockAdvances(...args) as unknown,
    advancesCsv: (...args: unknown[]) => mockAdvancesCsv(...args) as unknown,
  },
}));

const mockSaveFile = vi.fn();
vi.mock('@/utils/fileDownload', () => ({
  saveFile: (...args: unknown[]) => mockSaveFile(...args) as unknown,
}));

vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-12',
}));

import FinanceReportsPage from './FinanceReportsPage';

const year = (id: string, name: string, status: FiscalYear['status']): FiscalYear =>
  ({
    id,
    name,
    status,
    organizationId: 'org',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    isLocked: false,
  }) as FiscalYear;

const throughToday: BudgetVsActualReport = {
  fiscalYearId: 'fy-26',
  fiscalYearName: 'FY2026',
  asOf: '2026-10-12',
  includesCommitted: true,
  rows: [
    {
      budgetId: 'b-gear',
      categoryName: 'Gear',
      stationName: 'Station 1',
      originalBudget: '1000.00',
      amendments: '200.00',
      budget: '1200.00',
      spent: '170.00',
      committed: '60.00',
      remaining: '970.00',
      percentUsed: 14.2,
      runningSpent: '199.00',
      runningSpentDiffers: true,
    },
  ],
  totals: {
    originalBudget: '1000.00',
    amendments: '200.00',
    budget: '1200.00',
    spent: '170.00',
    committed: '60.00',
    remaining: '970.00',
  },
};

const throughMarch: BudgetVsActualReport = {
  ...throughToday,
  asOf: '2026-03-31',
  includesCommitted: false,
  rows: throughToday.rows.map((row) => ({ ...row, committed: null, runningSpent: null, runningSpentDiffers: false })),
  totals: { ...throughToday.totals, committed: null },
};

const amendments: AmendmentLogReport = {
  fiscalYearId: 'fy-26',
  fiscalYearName: 'FY2026',
  confirmedNet: '200.00',
  rows: [
    {
      amendmentId: 'a-1',
      budgetId: 'b-gear',
      categoryName: 'Gear',
      amount: '200.00',
      isReversal: false,
      reason: 'New hose',
      approvedBy: 'Board vote 3/14',
      approvedOn: '2026-03-14',
      enteredByName: 'Pat Treasurer',
      enteredAt: '2026-03-14T18:00:00Z',
      status: 'confirmed',
      decidedByName: 'Robin President',
      decidedAt: '2026-03-15T16:00:00Z',
    },
  ],
};

const april: PaymentsRegisterReport = {
  start: '2026-10-01',
  end: '2026-10-12',
  total: '-40.00',
  rows: [
    {
      paidOn: '2026-10-02',
      kind: 'check_void',
      entityId: 'cr-1',
      number: 'CR-2026-0001',
      payee: 'Glove Depot',
      description: 'Gloves',
      budgetLine: 'Gear, FY2026',
      checkNumber: '1001',
      amount: '-80.00',
    },
    {
      paidOn: '2026-10-05',
      kind: 'check_request',
      entityId: 'cr-2',
      number: 'CR-2026-0002',
      payee: 'County Fuel',
      description: 'Diesel',
      budgetLine: 'Fuel, FY2026',
      checkNumber: '1002',
      amount: '40.00',
    },
  ],
};

const functionalReport: FunctionalExpensesReport = {
  start: '2026-10-01',
  end: '2026-10-12',
  total: '195.00',
  classes: [
    {
      functionalClass: 'program',
      total: '100.00',
      categories: [{ categoryId: 'c-gear', categoryName: 'Turnout gear', amount: '100.00' }],
    },
    { functionalClass: 'management_general', total: '0.00', categories: [] },
    {
      functionalClass: 'fundraising',
      total: '65.00',
      categories: [{ categoryId: 'c-raffle', categoryName: 'Raffle', amount: '65.00' }],
    },
    {
      functionalClass: null,
      total: '30.00',
      categories: [{ categoryId: null, categoryName: null, amount: '30.00' }],
    },
  ],
};

const lateReport: LateSubstantiationReport = {
  start: '2026-10-01',
  end: '2026-10-12',
  total: '25.00',
  rows: [
    {
      paidOn: '2026-10-09',
      reportId: 'er-1',
      reportNumber: 'ER-2026-0004',
      memberName: 'Jamie Rivera',
      description: 'Hotel, state conference',
      budgetLine: 'Training, FY2026',
      incurredOn: '2026-06-01',
      submittedOn: '2026-09-15',
      daysToSubmit: 106,
      amount: '25.00',
      acknowledgedByName: 'Pat Treasurer',
    },
  ],
};

const fundBalances: FundBalancesReport = {
  funds: [
    {
      campaignId: 'c-engine',
      name: 'Engine fund',
      purpose: 'Replace Engine 2',
      active: true,
      received: '1000.00',
      spent: '420.00',
      committed: '600.00',
      awaitingApproval: '50.00',
      available: '-20.00',
    },
    {
      campaignId: 'c-roof',
      name: 'Roof fund',
      purpose: null,
      active: false,
      received: '300.00',
      spent: '300.00',
      committed: '0.00',
      awaitingApproval: '0.00',
      available: '0.00',
    },
  ],
  received: '1300.00',
  spent: '720.00',
  committed: '600.00',
  awaitingApproval: '50.00',
  available: '-20.00',
};

const openAt = (search = '') => {
  window.history.pushState({}, '', `/finance/reports${search}`);
  return renderWithRouter(<FinanceReportsPage />);
};

const advancesReport: AdvancesReport = {
  advances: [
    {
      id: 'adv-1',
      requestNumber: 'CK-2026-0001',
      memberId: 'u-1',
      memberName: 'Alice Member',
      amount: '300.00',
      purpose: 'State fire conference',
      checkNumber: '2001',
      issuedAt: '2026-03-10T15:00:00Z',
      dueAt: '2026-07-08T15:00:00Z',
      accounted: '200.00',
      returned: '25.00',
      outstanding: '75.00',
      overdue: true,
    },
    {
      id: 'adv-2',
      requestNumber: 'CK-2026-0009',
      memberId: 'u-2',
      memberName: 'Bo Captain',
      amount: '150.00',
      purpose: null,
      checkNumber: '2010',
      issuedAt: '2026-09-20T15:00:00Z',
      dueAt: '2027-01-18T15:00:00Z',
      accounted: '0.00',
      returned: '0.00',
      outstanding: '150.00',
      overdue: false,
    },
  ],
  outstanding: '225.00',
  overdueOutstanding: '75.00',
};

describe('FinanceReportsPage', () => {
  beforeEach(() => {
    for (const mock of [
      mockListYears,
      mockBudgetVsActual,
      mockBudgetVsActualCsv,
      mockAmendmentLog,
      mockAmendmentLogCsv,
      mockRegister,
      mockRegisterCsv,
      mockLate,
      mockFunctional,
      mockFunctionalCsv,
      mockLateCsv,
      mockFunds,
      mockFundsCsv,
      mockAdvances,
      mockAdvancesCsv,
      mockSaveFile,
    ]) {
      mock.mockReset();
    }
    mockListYears.mockResolvedValue([year('fy-25', 'FY2025', 'closed'), year('fy-26', 'FY2026', 'active')]);
    mockBudgetVsActual.mockImplementation((_id: string, asOf?: string) =>
      Promise.resolve(asOf === '2026-03-31' ? throughMarch : throughToday)
    );
    mockAmendmentLog.mockResolvedValue(amendments);
    mockRegister.mockResolvedValue(april);
    mockLate.mockResolvedValue(lateReport);
    mockFunctional.mockResolvedValue(functionalReport);
    mockFunds.mockResolvedValue(fundBalances);
    mockAdvances.mockResolvedValue(advancesReport);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  describe('budget vs actual', () => {
    it('opens on the active year through today, with commitments', async () => {
      openAt();

      expect(await screen.findByText('Gear (Station 1)')).toBeInTheDocument();
      expect(mockBudgetVsActual).toHaveBeenCalledWith('fy-26', '2026-10-12');
      expect(screen.getByRole('columnheader', { name: 'Committed' })).toBeInTheDocument();
      expect(screen.getByText(/running total reads \$199\.00/)).toBeInTheDocument();
      expect(screen.getByText('FY2026, through Oct 12, 2026')).toBeInTheDocument();
    });

    it('drops the committed column for an earlier date and says why', async () => {
      openAt();
      await screen.findByText('Gear (Station 1)');

      fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-03-31' } });

      expect(await screen.findByText('FY2026, through Mar 31, 2026')).toBeInTheDocument();
      expect(mockBudgetVsActual).toHaveBeenLastCalledWith('fy-26', '2026-03-31');
      expect(screen.queryByRole('columnheader', { name: 'Committed' })).not.toBeInTheDocument();
      expect(screen.getByText(/Commitments are shown only on a report through today/)).toBeInTheDocument();
    });

    it('downloads the CSV for what is on screen', async () => {
      const file = { blob: new Blob(['x']), filename: 'budget-vs-actual.csv' };
      mockBudgetVsActualCsv.mockResolvedValue(file);
      openAt();
      await screen.findByText('Gear (Station 1)');

      await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));

      await waitFor(() => expect(mockSaveFile).toHaveBeenCalledWith(file));
      expect(mockBudgetVsActualCsv).toHaveBeenCalledWith('fy-26', '2026-10-12');
    });

    it('prints with the browser', async () => {
      openAt();
      await screen.findByText('Gear (Station 1)');

      await userEvent.click(screen.getByRole('button', { name: /Print/ }));

      expect(window.print).toHaveBeenCalled();
    });

    it("shows the server's error", async () => {
      mockBudgetVsActual.mockReset();
      mockBudgetVsActual.mockRejectedValue(new Error('Fiscal year not found'));
      openAt();

      expect(await screen.findByRole('alert')).toHaveTextContent('Fiscal year not found');
      expect(screen.getByRole('button', { name: /Download CSV/ })).toBeDisabled();
    });
  });

  describe('amendment log', () => {
    it('lists who entered, approved and confirmed each change', async () => {
      openAt('?report=amendment-log');

      const row = await screen.findByRole('row', { name: /New hose/ });
      expect(within(row).getByText('Pat Treasurer')).toBeInTheDocument();
      expect(within(row).getByText('Board vote 3/14')).toBeInTheDocument();
      expect(within(row).getByText(/Robin President/)).toBeInTheDocument();
      expect(within(row).getByText('Confirmed')).toBeInTheDocument();
      expect(screen.getByText(/Net of confirmed amendments: \$200\.00/)).toBeInTheDocument();
      expect(mockAmendmentLog).toHaveBeenCalledWith('fy-26');
    });
  });

  describe('payments register', () => {
    it('opens on this month so far, a void reading negative', async () => {
      openAt('?report=payments-register');

      const voidRow = await screen.findByRole('row', { name: /Glove Depot/ });
      expect(mockRegister).toHaveBeenCalledWith('2026-10-01', '2026-10-12');
      expect(within(voidRow).getByText('Check voided')).toBeInTheDocument();
      expect(within(voidRow).getByText('-$80.00')).toBeInTheDocument();
      expect(screen.getByText('-$40.00')).toBeInTheDocument();
    });

    it('refuses a period that ends before it starts, without asking the server', async () => {
      openAt('?report=payments-register');
      await screen.findByText('Glove Depot');
      mockRegister.mockClear();

      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-01' } });

      expect(await screen.findByRole('alert')).toHaveTextContent('The end date must be on or after the start date.');
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  it('switches reports from the tabs', async () => {
    openAt();
    await screen.findByText('Gear (Station 1)');

    await userEvent.click(screen.getByRole('tab', { name: 'Payments register' }));

    expect(await screen.findByText('Glove Depot')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payments register' })).toHaveAttribute('aria-selected', 'true');
  });

  describe('outside the accountable plan', () => {
    it('lists late expenses paid this month so far, with who confirmed them', async () => {
      openAt('?report=late-substantiation');

      const row = await screen.findByRole('row', { name: /Hotel, state conference/ });
      expect(mockLate).toHaveBeenCalledWith('2026-10-01', '2026-10-12');
      expect(within(row).getByText('Jamie Rivera')).toBeInTheDocument();
      expect(within(row).getByText('106 days later')).toBeInTheDocument();
      expect(within(row).getByText('Pat Treasurer')).toBeInTheDocument();
    });

    it('downloads the CSV for the period shown', async () => {
      const file = { blob: new Blob(['x']), filename: 'outside-accountable-plan.csv' };
      mockLateCsv.mockResolvedValue(file);
      const user = userEvent.setup();
      openAt('?report=late-substantiation');
      await screen.findByRole('row', { name: /Hotel, state conference/ });

      await user.click(screen.getByRole('button', { name: /Download CSV/ }));

      await waitFor(() => expect(mockSaveFile).toHaveBeenCalledWith(file));
      expect(mockLateCsv).toHaveBeenCalledWith('2026-10-01', '2026-10-12');
    });
  });

  describe('functional expenses', () => {
    it('groups the period by function and flags what is not classified', async () => {
      openAt('?report=functional-expenses');

      const program = await screen.findByRole('rowgroup', { name: 'Program services' });
      expect(mockFunctional).toHaveBeenCalledWith('2026-10-01', '2026-10-12');
      expect(within(program).getByRole('row', { name: /Turnout gear/ })).toHaveTextContent('$100.00');
      expect(
        within(screen.getByRole('rowgroup', { name: 'Management & general' })).getByText('Nothing in this period')
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('rowgroup', { name: 'Unclassified' })).getByText('No budget line')
      ).toBeInTheDocument();
      expect(screen.getByText(/\$30\.00 is not classified yet/)).toBeInTheDocument();
    });

    it('downloads the CSV for the period shown', async () => {
      const file = { blob: new Blob(['x']), filename: 'functional-expenses.csv' };
      mockFunctionalCsv.mockResolvedValue(file);
      const user = userEvent.setup();
      openAt('?report=functional-expenses');
      await screen.findByRole('rowgroup', { name: 'Program services' });

      await user.click(screen.getByRole('button', { name: /Download CSV/ }));

      await waitFor(() => expect(mockSaveFile).toHaveBeenCalledWith(file));
      expect(mockFunctionalCsv).toHaveBeenCalledWith('2026-10-01', '2026-10-12');
    });
  });

  describe('restricted funds', () => {
    it('lists each fund with its balance, and marks one overspent', async () => {
      openAt('?report=fund-balances');

      const engine = await screen.findByRole('row', { name: /Engine fund/ });
      expect(engine).toHaveTextContent('Replace Engine 2');
      expect(engine).toHaveTextContent('$1,000.00');
      expect(engine).toHaveTextContent('-$20.00');
      expect(within(engine).getByText('Overspent')).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Roof fund/ })).toHaveTextContent('(closed)');
    });

    it('says how to start when there are none', async () => {
      mockFunds.mockResolvedValue({
        funds: [],
        received: '0.00',
        spent: '0.00',
        committed: '0.00',
        awaitingApproval: '0.00',
        available: '0.00',
      });
      openAt('?report=fund-balances');

      expect(await screen.findByText('No restricted funds')).toBeInTheDocument();
    });

    it('downloads the CSV', async () => {
      const file = { blob: new Blob(['x']), filename: 'fund-balances.csv' };
      mockFundsCsv.mockResolvedValue(file);
      const user = userEvent.setup();
      openAt('?report=fund-balances');
      await screen.findByRole('row', { name: /Engine fund/ });

      await user.click(screen.getByRole('button', { name: /Download CSV/ }));

      await waitFor(() => expect(mockSaveFile).toHaveBeenCalledWith(file));
    });
  });

  describe('cash advances', () => {
    it("lists what each member still owes, and the server's totals", async () => {
      openAt('?report=advances');

      const alice = await screen.findByRole('row', { name: /CK-2026-0001/ });
      expect(alice).toHaveTextContent('Alice Member');
      expect(alice).toHaveTextContent('$75.00');
      expect(within(alice).getByText('Overdue')).toBeInTheDocument();
      const bo = screen.getByRole('row', { name: /CK-2026-0009/ });
      expect(within(bo).queryByText('Overdue')).not.toBeInTheDocument();
      expect(screen.getByRole('row', { name: /^Outstanding/ })).toHaveTextContent('$225.00');
      expect(screen.getByRole('row', { name: /Of which overdue/ })).toHaveTextContent('$75.00');
    });

    it('says so when nothing is outstanding', async () => {
      mockAdvances.mockResolvedValue({ advances: [], outstanding: '0.00', overdueOutstanding: '0.00' });
      openAt('?report=advances');

      expect(await screen.findByText('Nothing outstanding')).toBeInTheDocument();
    });

    it('downloads the CSV', async () => {
      const file = { blob: new Blob(['x']), filename: 'cash-advances.csv' };
      mockAdvancesCsv.mockResolvedValue(file);
      const user = userEvent.setup();
      openAt('?report=advances');
      await screen.findByRole('row', { name: /CK-2026-0001/ });

      await user.click(screen.getByRole('button', { name: /Download CSV/ }));

      await waitFor(() => expect(mockSaveFile).toHaveBeenCalledWith(file));
    });
  });
});
