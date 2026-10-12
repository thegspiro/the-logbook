import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import type { AmendmentLogReport, BudgetVsActualReport, FiscalYear, PaymentsRegisterReport } from '../types';

const mockListYears = vi.fn();
const mockBudgetVsActual = vi.fn();
const mockBudgetVsActualCsv = vi.fn();
const mockAmendmentLog = vi.fn();
const mockAmendmentLogCsv = vi.fn();
const mockRegister = vi.fn();
const mockRegisterCsv = vi.fn();

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

const openAt = (search = '') => {
  window.history.pushState({}, '', `/finance/reports${search}`);
  return renderWithRouter(<FinanceReportsPage />);
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
      expect(mockListYears).toHaveBeenCalled();
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
});
