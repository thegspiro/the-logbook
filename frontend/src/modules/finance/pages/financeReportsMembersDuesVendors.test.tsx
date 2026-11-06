/**
 * The three board reports built for the owner's 2026-11-01 decision: expenses
 * by member, dues delinquency and purchases by vendor. The page shows the
 * server's figures as given (Pitfall #29) and downloads the server's CSV.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import type {
  DuesDelinquencyReport,
  ExpenseSummaryByMemberReport,
  FiscalYear,
  PurchasesByVendorReport,
} from '../types';

const mockListYears = vi.fn();
const mockMembers = vi.fn();
const mockMembersCsv = vi.fn();
const mockDues = vi.fn();
const mockDuesCsv = vi.fn();
const mockVendors = vi.fn();
const mockVendorsCsv = vi.fn();

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  fiscalYearService: { list: (...args: unknown[]) => mockListYears(...args) as unknown },
  financeReportService: {
    expenseSummaryByMember: (...args: unknown[]) => mockMembers(...args) as unknown,
    expenseSummaryByMemberCsv: (...args: unknown[]) => mockMembersCsv(...args) as unknown,
    duesDelinquency: (...args: unknown[]) => mockDues(...args) as unknown,
    duesDelinquencyCsv: (...args: unknown[]) => mockDuesCsv(...args) as unknown,
    purchasesByVendor: (...args: unknown[]) => mockVendors(...args) as unknown,
    purchasesByVendorCsv: (...args: unknown[]) => mockVendorsCsv(...args) as unknown,
  },
}));

const mockSaveFile = vi.fn();
vi.mock('@/utils/fileDownload', () => ({
  saveFile: (...args: unknown[]) => mockSaveFile(...args) as unknown,
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-11-06',
}));

import FinanceReportsPage from './FinanceReportsPage';

const members: ExpenseSummaryByMemberReport = {
  start: '2026-11-01',
  end: '2026-11-06',
  rows: [
    { memberId: 'u-a', memberName: 'Alice Ames', reportCount: 2, voidedChecks: 0, amount: '100.00' },
    { memberId: 'u-b', memberName: 'Bob Burr', reportCount: 1, voidedChecks: 1, amount: '25.50' },
  ],
  total: '125.50',
};

const dues: DuesDelinquencyReport = {
  start: '2026-11-01',
  end: '2026-11-06',
  asOf: '2026-11-06',
  expected: '410.00',
  collected: '120.00',
  waived: '100.00',
  outstanding: '190.00',
  membersOverdue: 1,
  rows: [
    {
      memberId: 'u-a',
      memberName: 'Alice Ames',
      overdueRecords: 1,
      amountOverdue: '110.00',
      lateFees: '10.00',
      oldestDue: '2026-11-01',
      daysOverdue: 5,
    },
  ],
  totalOverdue: '110.00',
};

const vendors: PurchasesByVendorReport = {
  fiscalYearId: 'fy-26',
  fiscalYearName: 'FY2026',
  rows: [
    { vendor: 'Acme Supply', orders: 3, open: '150.00', paid: '80.00', total: '230.00' },
    { vendor: null, orders: 1, open: '0.00', paid: '20.00', total: '20.00' },
  ],
  totalOpen: '150.00',
  totalPaid: '100.00',
  total: '250.00',
};

const year = { id: 'fy-26', name: 'FY2026', status: 'active' } as FiscalYear;

const open = (report: string) => {
  window.history.pushState({}, '', `/finance/reports?report=${report}`);
  return renderWithRouter(<FinanceReportsPage />);
};

beforeEach(() => {
  for (const mock of [mockListYears, mockMembers, mockMembersCsv, mockDues, mockDuesCsv, mockVendors, mockVendorsCsv]) {
    mock.mockReset();
  }
  mockSaveFile.mockReset();
  mockListYears.mockResolvedValue([year]);
  mockMembers.mockResolvedValue(members);
  mockDues.mockResolvedValue(dues);
  mockVendors.mockResolvedValue(vendors);
  mockMembersCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'expenses-by-member.csv' });
  mockDuesCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'dues-delinquency.csv' });
  mockVendorsCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'purchases-by-vendor.csv' });
});

describe('Expenses by member', () => {
  it('lists each member with the server’s totals for the month so far', async () => {
    open('expenses-by-member');

    const table = await screen.findByRole('region', { name: 'Members' });
    expect(mockMembers).toHaveBeenCalledWith('2026-11-01', '2026-11-06');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Alice Ames2$100.00');
    expect(rows[2]).toHaveTextContent('One check voided');
    expect(rows[3]).toHaveTextContent('Total$125.50');
  });

  it('downloads the server’s CSV for the same period', async () => {
    const user = userEvent.setup();
    open('expenses-by-member');
    await screen.findByRole('region', { name: 'Members' });

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    expect(mockMembersCsv).toHaveBeenCalledWith('2026-11-01', '2026-11-06');
  });
});

describe('Dues delinquency', () => {
  it('shows the collection totals and the members overdue', async () => {
    open('dues-delinquency');

    const table = await screen.findByRole('region', { name: 'Members overdue' });
    const totals = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(totals).toEqual(['$410.00', '$120.00', '$100.00', '$190.00']);
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Alice Ames');
    expect(rows[1]).toHaveTextContent('5 days ago');
    expect(rows[1]).toHaveTextContent('$10.00');
    expect(rows[1]).toHaveTextContent('$110.00');
    expect(rows[2]).toHaveTextContent('Total (1 member)$110.00');
  });

  it('says so when nobody is overdue', async () => {
    mockDues.mockResolvedValue({ ...dues, rows: [], membersOverdue: 0, totalOverdue: '0.00' });
    open('dues-delinquency');

    expect(await screen.findByText('Nobody is overdue')).toBeInTheDocument();
  });
});

describe('Purchases by vendor', () => {
  it('totals the chosen fiscal year by vendor', async () => {
    open('purchases-by-vendor');

    const table = await screen.findByRole('region', { name: 'Vendors' });
    expect(mockVendors).toHaveBeenCalledWith('fy-26');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Acme Supply3$150.00$80.00$230.00');
    expect(rows[2]).toHaveTextContent('No vendor named');
    expect(rows[3]).toHaveTextContent('Total$150.00$100.00$250.00');
  });
});
