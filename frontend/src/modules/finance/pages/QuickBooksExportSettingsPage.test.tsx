/**
 * QuickBooks export settings (Treasurer only).
 *
 * The readiness table words the backend's answer per category and decides
 * nothing itself (CLAUDE.md pitfall #29). Mappings are created with blanks
 * omitted, edited with blanks sent as null (pitfall #1), and deleted only
 * after a confirmation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { ExportLog, ExportMapping, ExportReadiness } from '../types';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

const listMappings = vi.fn();
const readiness = vi.fn();
const createMapping = vi.fn();
const updateMapping = vi.fn();
const deleteMapping = vi.fn();
const listLogs = vi.fn();
const runExport = vi.fn();
const setDuesDefaults = vi.fn();
const setAdvanceAccounts = vi.fn();
const mockSaveFile = vi.fn();
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-14',
}));
vi.mock('@/utils/fileDownload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/fileDownload')>()),
  saveFile: (...args: unknown[]) => mockSaveFile(...args) as unknown,
}));
vi.mock('../services/api', () => ({
  exportMappingService: {
    list: (...args: unknown[]) => listMappings(...args) as unknown,
    readiness: (...args: unknown[]) => readiness(...args) as unknown,
    create: (...args: unknown[]) => createMapping(...args) as unknown,
    update: (...args: unknown[]) => updateMapping(...args) as unknown,
    delete: (...args: unknown[]) => deleteMapping(...args) as unknown,
    logs: (...args: unknown[]) => listLogs(...args) as unknown,
    run: (...args: unknown[]) => runExport(...args) as unknown,
    setDuesDefaults: (...args: unknown[]) => setDuesDefaults(...args) as unknown,
    setAdvanceAccounts: (...args: unknown[]) => setAdvanceAccounts(...args) as unknown,
  },
}));

import QuickBooksExportSettingsPage from './QuickBooksExportSettingsPage';

const mapping = (overrides: Partial<ExportMapping>): ExportMapping => ({
  id: 'map-fuel',
  organizationId: 'org',
  internalCategory: 'Fuel',
  qbAccountName: 'Vehicle Expense:Fuel',
  qbAccountNumber: '6100',
  qbOffsetAccountName: 'Operating Checking',
  mappingType: 'expense',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const fuelMapping = mapping({});
const strayMapping = mapping({ id: 'map-stray', internalCategory: 'Fule', qbAccountNumber: null });

const report: ExportReadiness = {
  categories: [
    {
      categoryId: 'cat-training',
      categoryName: 'Training',
      isActive: true,
      status: 'ready',
      accountName: 'Training Expense',
      accountSource: 'category',
      offsetAccountName: 'Operating Checking',
      mappingIds: ['map-training'],
    },
    {
      categoryId: 'cat-fuel',
      categoryName: 'Fuel',
      isActive: true,
      status: 'ready',
      accountName: 'Vehicle Expense:Fuel',
      accountSource: 'mapping',
      offsetAccountName: 'Operating Checking',
      mappingIds: ['map-fuel'],
    },
    {
      categoryId: 'cat-diesel',
      categoryName: 'Diesel',
      isActive: true,
      status: 'ready',
      accountName: 'Vehicle Expense:Fuel',
      accountSource: 'parent',
      accountInheritedFrom: 'Fuel',
      offsetAccountName: 'Operating Checking',
      offsetInheritedFrom: 'Fuel',
      mappingIds: [],
    },
    {
      categoryId: 'cat-gear',
      categoryName: 'Gear',
      isActive: false,
      status: 'no_account',
      accountName: null,
      accountSource: null,
      offsetAccountName: null,
      mappingIds: [],
    },
  ],
  unmatchedMappingIds: ['map-stray'],
  dues: {
    enabled: true,
    defaultIncomeAccount: 'Dues Income',
    defaultDepositAccount: null,
    schedules: [
      {
        scheduleId: 'sch-annual',
        name: 'Annual dues',
        isActive: true,
        status: 'no_deposit',
        incomeAccount: 'Dues Income',
        incomeSource: 'default',
        depositAccount: null,
        depositSource: null,
      },
      {
        scheduleId: 'sch-fines',
        name: 'Fines',
        isActive: true,
        status: 'ready',
        incomeAccount: 'Fines Income',
        incomeSource: 'schedule',
        depositAccount: 'Petty Cash',
        depositSource: 'schedule',
      },
    ],
  },
  advances: { status: 'no_cash_account', advancesAccount: 'Employee Advances', cashAccount: null },
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/finance/settings/quickbooks']}>
      <ConfirmProvider>
        <QuickBooksExportSettingsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const rowFor = async (category: string) => {
  const section = await screen.findByRole('region', { name: 'Budget categories' });
  const row = within(section)
    .getAllByRole('row')
    .find((r) => within(r).queryByText(category) !== null);
  if (!row) throw new Error(`No readiness row for ${category}`);
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [
    listMappings,
    readiness,
    createMapping,
    updateMapping,
    deleteMapping,
    listLogs,
    runExport,
    mockSaveFile,
    setDuesDefaults,
    setAdvanceAccounts,
  ]) {
    mock.mockReset();
  }
  runExport.mockResolvedValue({ blob: new Blob(['x']), filename: 'quickbooks-journal_2026-09-01_2026-09-30.csv' });
  listMappings.mockResolvedValue([fuelMapping, strayMapping]);
  readiness.mockResolvedValue(report);
  createMapping.mockResolvedValue(fuelMapping);
  updateMapping.mockResolvedValue(fuelMapping);
  deleteMapping.mockResolvedValue(undefined);
  listLogs.mockResolvedValue([]);
});

describe('QuickBooksExportSettingsPage readiness', () => {
  it("words each category's state as the backend reports it", async () => {
    renderPage();

    const training = await rowFor('Training');
    expect(within(training).getByText('Set on the category')).toBeInTheDocument();
    expect(within(training).getByText('Ready')).toBeInTheDocument();

    const fuel = await rowFor('Fuel');
    expect(within(fuel).getByText('From its mapping')).toBeInTheDocument();

    // A subcategory with no accounts of its own posts where its parent does.
    const diesel = await rowFor('Diesel');
    expect(within(diesel).getAllByText('From Fuel')).toHaveLength(2);
    expect(within(diesel).getByText('Ready')).toBeInTheDocument();

    const gear = await rowFor('Gear');
    expect(within(gear).getByText('No account')).toBeInTheDocument();
    expect(within(gear).getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 budget category needs its accounts fixed');
  });

  it('flags a category posting to Accounts Payable or Receivable, with what to do', async () => {
    readiness.mockResolvedValue({
      ...report,
      categories: report.categories.map((c) =>
        c.categoryName === 'Fuel'
          ? { ...c, status: 'payable_receivable', offsetAccountName: 'Accounts Payable (A/P)' }
          : c
      ),
    });
    renderPage();

    const fuel = await rowFor('Fuel');
    expect(within(fuel).getByText('Payable/receivable account')).toBeInTheDocument();
    expect(fuel).toHaveTextContent('Use the bank or card account it is paid from');
  });

  it("lists QuickBooks' own import requirements", async () => {
    renderPage();

    const checklist = await screen.findByRole('region', { name: 'Before you import into QuickBooks Online' });
    expect(checklist).toHaveTextContent('Account numbers are turned off');
    expect(checklist).toHaveTextContent('MM/DD/YYYY');
    expect(checklist).toHaveTextContent('fewer than 1,000 rows');
  });

  it('says every category is ready when the backend does', async () => {
    readiness.mockResolvedValue({
      categories: report.categories.filter((c) => c.status === 'ready'),
      unmatchedMappingIds: [],
    });
    renderPage();

    expect(await screen.findByText(/Every budget category has both accounts/)).toBeInTheDocument();
  });

  it('flags a mapping the backend says matches no category', async () => {
    renderPage();

    expect(await screen.findByText('Matches no budget category, so exports never use it')).toBeInTheDocument();
  });

  it('shows the load failure', async () => {
    readiness.mockRejectedValue(new Error('Network down'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });
});

describe('QuickBooksExportSettingsPage mappings', () => {
  it('adds a mapping from a category row, omitting a blank account number', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(await rowFor('Gear')).getByRole('button', { name: 'Add a mapping for Gear' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Budget category')).toHaveValue('Gear');
    await user.type(within(dialog).getByLabelText('QuickBooks account'), 'Equipment Expense');
    await user.type(within(dialog).getByLabelText('Paid from account'), 'Operating Checking');
    await user.click(within(dialog).getByRole('button', { name: 'Add mapping' }));

    await waitFor(() =>
      expect(createMapping).toHaveBeenCalledWith({
        internalCategory: 'Gear',
        qbAccountName: 'Equipment Expense',
        qbAccountNumber: undefined,
        qbOffsetAccountName: 'Operating Checking',
        mappingType: 'expense',
      })
    );
    // The page re-reads readiness after a save rather than guessing the result.
    await waitFor(() => expect(readiness).toHaveBeenCalledTimes(2));
  });

  it('requires the paid-from account the export cannot do without', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(await rowFor('Gear')).getByRole('button', { name: 'Add a mapping for Gear' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('QuickBooks account'), 'Equipment Expense');
    await user.click(within(dialog).getByRole('button', { name: 'Add mapping' }));

    expect(
      await within(dialog).findByText('Enter the QuickBooks account this category is paid from.')
    ).toBeInTheDocument();
    expect(createMapping).not.toHaveBeenCalled();
  });

  it('edits a mapping, sending a cleared account number as null', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(within(await rowFor('Fuel')).getByRole('button', { name: 'Edit the mapping for Fuel' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Account number (optional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Save mapping' }));

    await waitFor(() =>
      expect(updateMapping).toHaveBeenCalledWith('map-fuel', {
        internalCategory: 'Fuel',
        qbAccountName: 'Vehicle Expense:Fuel',
        qbAccountNumber: null,
        qbOffsetAccountName: 'Operating Checking',
        mappingType: 'expense',
      })
    );
  });

  it('keeps an unmatched mapping on its own category name while editing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit the mapping for Fule to Vehicle Expense:Fuel' }));

    expect(within(await screen.findByRole('dialog')).getByLabelText('Budget category')).toHaveValue('Fule');
  });

  it('deletes a mapping only once confirmed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Delete the mapping for Fule to Vehicle Expense:Fuel' })
    );
    await user.click(await screen.findByRole('button', { name: 'Delete mapping' }));

    await waitFor(() => expect(deleteMapping).toHaveBeenCalledWith('map-stray'));
    await waitFor(() => expect(readiness).toHaveBeenCalledTimes(2));
  });

  it('leaves the mapping alone when the Treasurer keeps it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Delete the mapping for Fule to Vehicle Expense:Fuel' })
    );
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));

    expect(deleteMapping).not.toHaveBeenCalled();
  });
});

const exportLog = (overrides: Partial<ExportLog>): ExportLog => ({
  id: 'log-1',
  organizationId: 'org',
  exportType: 'transactions',
  dateRangeStart: '2026-09-01T00:00:00Z',
  dateRangeEnd: '2026-09-30T00:00:00Z',
  recordCount: 42,
  fileFormat: 'csv',
  exportedBy: 'u-t',
  exportedByName: 'Ann Lee',
  exportedAt: '2026-10-01T14:00:00Z',
  status: 'successful',
  ...overrides,
});

describe('QuickBooksExportSettingsPage export history', () => {
  it('lists each export with its period, rows, outcome and who ran it', async () => {
    listLogs.mockResolvedValue([
      exportLog({}),
      exportLog({
        id: 'log-2',
        status: 'partial',
        recordCount: 7,
        errorMessage: 'Export stream interrupted before completion',
      }),
    ]);
    renderPage();

    const history = await screen.findByRole('region', { name: 'Export history' });
    await within(history).findByText('Complete');
    expect(listLogs).toHaveBeenCalledWith({ skip: 0, limit: 25 });
    expect(within(history).getAllByText('Ann Lee')).toHaveLength(2);
    expect(within(history).getByText('42')).toBeInTheDocument();
    expect(within(history).getByText('Interrupted')).toBeInTheDocument();
    expect(within(history).getByText('Export stream interrupted before completion')).toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: 'Show older exports' })).not.toBeInTheDocument();
  });

  it('says when nothing has been exported', async () => {
    renderPage();

    const history = await screen.findByRole('region', { name: 'Export history' });
    expect(await within(history).findByText('No exports yet')).toBeInTheDocument();
  });

  it('pages back through older exports', async () => {
    const firstPage = Array.from({ length: 25 }, (_, i) => exportLog({ id: `log-${String(i)}` }));
    listLogs.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([exportLog({ id: 'log-old', recordCount: 3 })]);
    const user = userEvent.setup();
    renderPage();

    const history = await screen.findByRole('region', { name: 'Export history' });
    await user.click(await within(history).findByRole('button', { name: 'Show older exports' }));

    await waitFor(() => expect(listLogs).toHaveBeenLastCalledWith({ skip: 25, limit: 25 }));
    expect(await within(history).findByText('3')).toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: 'Show older exports' })).not.toBeInTheDocument();
  });

  it('keeps the mappings on screen when the history fails to load', async () => {
    listLogs.mockRejectedValue(new Error('History unavailable'));
    renderPage();

    const history = await screen.findByRole('region', { name: 'Export history' });
    expect(await within(history).findByText('History unavailable')).toBeInTheDocument();
    expect(await rowFor('Fuel')).toBeInTheDocument();
  });
});

describe('QuickBooksExportSettingsPage running an export', () => {
  const panel = () => screen.findByRole('region', { name: 'Run an export' });

  it("offers last month and sends it as the department's whole days", async () => {
    const user = userEvent.setup();
    renderPage();
    const section = await panel();

    expect(within(section).getByLabelText('First day')).toHaveValue('2026-09-01');
    expect(within(section).getByLabelText('Last day')).toHaveValue('2026-09-30');
    listLogs.mockClear();
    await user.click(within(section).getByRole('button', { name: /Download QuickBooks file/ }));

    await waitFor(() =>
      expect(runExport).toHaveBeenCalledWith({
        dateRangeStart: '2026-09-01T04:00:00.000Z',
        dateRangeEnd: '2026-10-01T03:59:59.999Z',
        includeExported: false,
      })
    );
    expect(mockSaveFile).toHaveBeenCalledWith({
      blob: expect.any(Blob) as Blob,
      filename: 'quickbooks-journal_2026-09-01_2026-09-30.csv',
    });
    expect(toastSuccess).toHaveBeenCalledWith('QuickBooks file downloaded');
    // The history reloads, so the run just made is listed.
    await waitFor(() => expect(listLogs).toHaveBeenCalled());
  });

  it("shows the server's refusal, which names what to fix", async () => {
    runExport.mockRejectedValue(new Error("Set QuickBooks accounts before exporting: 'Diesel' has no account"));
    const user = userEvent.setup();
    renderPage();
    const section = await panel();

    await user.click(within(section).getByRole('button', { name: /Download QuickBooks file/ }));

    expect(await within(section).findByRole('alert')).toHaveTextContent("'Diesel' has no account");
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it('confirms before sending payments again, and stops when declined', async () => {
    const user = userEvent.setup();
    renderPage();
    const section = await panel();

    await user.click(within(section).getByLabelText('Include payments already sent to QuickBooks'));
    await user.click(within(section).getByRole('button', { name: /Download QuickBooks file/ }));
    await user.click(await screen.findByRole('button', { name: 'Leave them out' }));

    expect(runExport).not.toHaveBeenCalled();

    await user.click(within(section).getByRole('button', { name: /Download QuickBooks file/ }));
    await user.click(await screen.findByRole('button', { name: 'Include them' }));

    await waitFor(() => expect(runExport).toHaveBeenCalledWith(expect.objectContaining({ includeExported: true })));
  });

  it('refuses a period that ends before it starts, or runs past a year', async () => {
    const user = userEvent.setup();
    renderPage();
    const section = await panel();
    const button = within(section).getByRole('button', { name: /Download QuickBooks file/ });

    const last = within(section).getByLabelText('Last day');
    await user.clear(last);
    await user.type(last, '2026-08-01');
    expect(within(section).getByText('The last day must be on or after the first.')).toBeInTheDocument();
    expect(button).toBeDisabled();

    await user.clear(last);
    await user.type(last, '2027-09-30');
    expect(within(section).getByText(/at most 366 days/)).toBeInTheDocument();
    expect(button).toBeDisabled();
  });
});

describe('QuickBooksExportSettingsPage dues', () => {
  const section = () => screen.findByRole('region', { name: 'Dues' });

  it("shows each schedule's accounts, where they come from, and whether it exports", async () => {
    renderPage();
    const dues = await section();

    const annual = within(dues).getByRole('row', { name: /Annual dues/ });
    expect(within(annual).getByText('Department default')).toBeInTheDocument();
    expect(within(annual).getByText('No deposit account')).toBeInTheDocument();
    const fines = within(dues).getByRole('row', { name: /Fines/ });
    expect(within(fines).getAllByText('Set on the schedule')).toHaveLength(2);
    expect(within(fines).getByText('Ready')).toBeInTheDocument();
    expect(within(dues).getByLabelText('Default income account')).toHaveValue('Dues Income');
  });

  it('saves the defaults, a blank one as null, and shows the new reading', async () => {
    setDuesDefaults.mockResolvedValue({
      defaultIncomeAccount: 'Dues Income',
      defaultDepositAccount: 'Operating Checking',
      schedules: [
        {
          scheduleId: 'sch-annual',
          name: 'Annual dues',
          isActive: true,
          status: 'ready',
          incomeAccount: 'Dues Income',
          incomeSource: 'default',
          depositAccount: 'Operating Checking',
          depositSource: 'default',
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    const dues = await section();

    await user.type(within(dues).getByLabelText('Default deposited to'), ' Operating Checking ');
    await user.click(within(dues).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setDuesDefaults).toHaveBeenCalledWith({
        incomeAccount: 'Dues Income',
        depositAccount: 'Operating Checking',
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Dues accounts saved');
    expect(await within(dues).findByText('Ready')).toBeInTheDocument();
  });

  it('says dues are not exported until an account is set', async () => {
    readiness.mockResolvedValue({
      ...report,
      dues: { enabled: false, defaultIncomeAccount: null, defaultDepositAccount: null, schedules: [] },
    });
    renderPage();
    const dues = await section();

    expect(within(dues).getByText(/Dues are not exported yet/)).toBeInTheDocument();
  });

  it("shows the server's refusal", async () => {
    setDuesDefaults.mockRejectedValue(new Error("Accounts Payable and Accounts Receivable can't be used"));
    const user = userEvent.setup();
    renderPage();
    const dues = await section();

    await user.clear(within(dues).getByLabelText('Default income account'));
    await user.click(within(dues).getByRole('button', { name: 'Save' }));

    expect(await within(dues).findByRole('alert')).toHaveTextContent("can't be used");
    expect(setDuesDefaults).toHaveBeenCalledWith({ incomeAccount: null, depositAccount: null });
  });
});

describe('QuickBooksExportSettingsPage cash advances', () => {
  const section = () => screen.findByRole('region', { name: /Cash advances/ });

  it("shows the server's reading of the accounts", async () => {
    renderPage();
    const advances = await section();

    expect(within(advances).getByText('No bank account')).toBeInTheDocument();
    expect(within(advances).getByLabelText('Advances account')).toHaveValue('Employee Advances');
    expect(within(advances).getByLabelText('Paid from and returned to')).toHaveValue('');
  });

  it('saves both accounts, a blank one as null, and shows the new reading', async () => {
    setAdvanceAccounts.mockResolvedValue({
      status: 'ready',
      advancesAccount: 'Employee Advances',
      cashAccount: 'Operating Checking',
    });
    const user = userEvent.setup();
    renderPage();
    const advances = await section();

    await user.type(within(advances).getByLabelText('Paid from and returned to'), ' Operating Checking ');
    await user.click(within(advances).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setAdvanceAccounts).toHaveBeenCalledWith({
        advancesAccount: 'Employee Advances',
        cashAccount: 'Operating Checking',
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Cash advance accounts saved');
    expect(await within(advances).findByText('Ready')).toBeInTheDocument();
  });

  it("shows the server's refusal", async () => {
    setAdvanceAccounts.mockRejectedValue(new Error("Accounts Payable and Accounts Receivable can't be used"));
    const user = userEvent.setup();
    renderPage();
    const advances = await section();

    await user.clear(within(advances).getByLabelText('Advances account'));
    await user.click(within(advances).getByRole('button', { name: 'Save' }));

    expect(await within(advances).findByRole('alert')).toHaveTextContent("can't be used");
    expect(setAdvanceAccounts).toHaveBeenCalledWith({ advancesAccount: null, cashAccount: null });
  });
});
