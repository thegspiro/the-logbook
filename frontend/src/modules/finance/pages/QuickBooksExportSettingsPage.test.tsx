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
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../services/api', () => ({
  exportMappingService: {
    list: (...args: unknown[]) => listMappings(...args) as unknown,
    readiness: (...args: unknown[]) => readiness(...args) as unknown,
    create: (...args: unknown[]) => createMapping(...args) as unknown,
    update: (...args: unknown[]) => updateMapping(...args) as unknown,
    delete: (...args: unknown[]) => deleteMapping(...args) as unknown,
    logs: (...args: unknown[]) => listLogs(...args) as unknown,
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
  for (const mock of [listMappings, readiness, createMapping, updateMapping, deleteMapping, listLogs]) {
    mock.mockReset();
  }
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
